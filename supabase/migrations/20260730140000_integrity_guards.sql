-- Integrity guards: FK indexes, a balance floor, and two rules the database was
-- trusting the application to keep.
--
-- Everything here was found by auditing the live project rather than the repo.

-- 1) Foreign keys with no covering index --------------------------------------
--
-- Flagged by the performance advisor, and it matters more than "unindexed FK"
-- suggests: every RLS policy in this schema is `user_id = auth.uid()`, so
-- user_id sits in the WHERE clause of EVERY query against these tables. Without
-- an index that is a sequential scan each time.
--
-- tj_position_rules is the table that grows fastest — one row per rule per trade
-- — so it gets a composite that also serves the ordering getPositionRules() uses
-- (`order by position_id`), not just the FK.

CREATE INDEX IF NOT EXISTS tj_position_rules_user_position_idx
  ON public.tj_position_rules (user_id, position_id);

CREATE INDEX IF NOT EXISTS tj_playbook_rules_user_idx
  ON public.tj_playbook_rules (user_id);

CREATE INDEX IF NOT EXISTS tj_playbook_groups_user_idx
  ON public.tj_playbook_groups (user_id);

-- tj_cash_events already has (user_id, account_id, occurred_at DESC), but
-- account_id is not the leading column, so an account delete still seq-scans.
CREATE INDEX IF NOT EXISTS tj_cash_events_account_idx
  ON public.tj_cash_events (account_id);

-- 2) Starting balance floor ---------------------------------------------------
--
-- updateAccount already refuses a negative starting_balance, but only in
-- application code. It is the denominator of every drawdown percentage, every
-- FTMO threshold and the percentage breakeven band — a negative value inverts
-- all three silently, so the rule belongs where it cannot be bypassed.

ALTER TABLE public.tj_accounts
  ADD CONSTRAINT tj_accounts_starting_balance_non_negative
  CHECK (starting_balance >= 0);

-- 3) A fill must belong to whoever owns the trade -----------------------------
--
-- RLS on tj_executions checks `user_id = auth.uid()` and nothing else. Nothing
-- tied the fill to the OWNER OF THE POSITION it points at, and the foreign key
-- only requires that the position exists. So a direct PostgREST insert could
-- attach a fill to another user's position while passing RLS with the attacker's
-- own user_id — and tj_position_stats aggregates executions by position_id, so
-- the fill would land in the victim's average entry, P&L, R and drawdown.
--
-- The application never does this (tj_replace_executions takes user_id from the
-- parent position), which is exactly why nothing caught it.
--
-- 4) A missed trade cannot carry fills ----------------------------------------
--
-- Enforced until now only by check-then-update in markTradeMissed /
-- activateTrade / restoreTradeToPlanned, which is a race: two tabs, or a
-- concurrent import merge, can insert a fill between the check and the write.
-- This cannot be a CHECK constraint because it spans two tables, so it is a pair
-- of triggers.
--
-- `FOR UPDATE` below is what actually closes the race rather than narrowing it.
-- It takes the same row lock the position UPDATE already holds, so the two
-- statements serialise on the position row: whichever commits second sees the
-- other's work and refuses. Without it both could pass their checks against a
-- pre-change snapshot under READ COMMITTED.
--
-- SECURITY DEFINER so the guard reads the true parent row rather than the
-- caller's RLS-filtered view of it — a validation trigger that can be blinded by
-- RLS is not a validation trigger. It reads status and user_id only, and reports
-- neither.

CREATE OR REPLACE FUNCTION public.tj_execution_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_owner  uuid;
  v_status text;
BEGIN
  SELECT user_id, status INTO v_owner, v_status
    FROM public.tj_positions
   WHERE id = new.position_id
     FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Position % not found', new.position_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF new.user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION
      'A fill must belong to the owner of position %', new.position_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status = 'missed' THEN
    RAISE EXCEPTION
      'Position % is marked missed and cannot carry fills', new.position_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.tj_position_missed_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF new.status = 'missed'
     AND EXISTS (SELECT 1 FROM public.tj_executions WHERE position_id = new.id)
  THEN
    RAISE EXCEPTION
      'Position % has fills and cannot be marked missed', new.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS tj_executions_guard ON public.tj_executions;
CREATE TRIGGER tj_executions_guard
  BEFORE INSERT OR UPDATE OF position_id, user_id ON public.tj_executions
  FOR EACH ROW EXECUTE FUNCTION public.tj_execution_guard();

DROP TRIGGER IF EXISTS tj_positions_missed_guard ON public.tj_positions;
CREATE TRIGGER tj_positions_missed_guard
  BEFORE INSERT OR UPDATE OF status ON public.tj_positions
  FOR EACH ROW EXECUTE FUNCTION public.tj_position_missed_guard();

-- ORDERING NOTE for future writers: if you ever need to move a position to
-- 'missed' in the same transaction as removing its fills, delete the fills
-- FIRST. The guard reads committed state, so setting the status first raises on
-- rows you are about to delete. The current callers are all safe —
-- resolveStatus() only yields 'missed' for a submission with no fills, and a
-- trade that is already missed has none by construction.
