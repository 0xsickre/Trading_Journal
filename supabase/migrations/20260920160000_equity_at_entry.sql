-- The denominator of risk: what the account was worth on the day the trade was
-- entered.
--
-- WHY A COLUMN AT ALL, WHEN THIS JOURNAL DERIVES MONEY RATHER THAN STORING IT.
-- Everything else needed to say how much a trade risked is already frozen on
-- the trade: the stop distance comes from `entry_price` / `stop_price`,
-- `entry_qty` from the fills, and `point_value` / `fx_rate` from
-- `tj_position_stats`, which COALESCEs the trade's own snapshot over the live
-- instrument. Multiply those and you have the risk in account currency — and
-- `position-stats.ts` already computes exactly that expression internally, for
-- `realized_r_net`.
--
-- The equity is the one factor that is NOT recoverable. It moves with every
-- later trade, every deposit and every correction, so a percentage recomputed
-- next month would silently re-base a March trade against June's account. A
-- risk of 1 % that becomes 0.8 % because the book grew is not a correction, it
-- is a different claim about a decision that was already made.
--
-- WHICH EQUITY. The balance the day OPENED with, in the account's own
-- timezone. Not the live figure: a denominator that shrinks with every loss
-- inside the day allows less risk after each one, so "2 % of equity" can never
-- quite be breached — the argument `tracker/equity-ladder.ts` makes at length,
-- and the convention `ftmo.ts` already implements as `prev_close`.
--
-- PER ACCOUNT, deliberately diverging from the tracker's ladder, which sums the
-- whole book because its limits are about the trader's capital. A single trade
-- risks the account it sits on; measuring a €5,000 account's trade against a
-- book that also holds $100,000 would describe nothing.
--
-- NULL IS AN ANSWER. An unpriced instrument makes the realized total unknown
-- from that trade onward, and an unknown denominator cannot produce an honest
-- percentage. The backfill leaves those rows NULL rather than writing a number
-- that is missing a trade — the same refusal `buildEquityLadder` makes with
-- `brokenFrom`, and `equity-at-entry.ts` makes on the write path.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS equity_at_entry numeric;

COMMENT ON COLUMN public.tj_positions.equity_at_entry IS
  'Account equity at the START of the entry day, in the account timezone, '
  'frozen when the trade first got an entry fill. The denominator of every risk '
  'percentage. NULL when the trade was never entered, or when an unpriced trade '
  'earlier in the account makes the figure unknowable. Written by '
  'lib/journal/equity-at-entry.ts; never overwritten on a later edit.';

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_equity_at_entry_positive;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_equity_at_entry_positive
  CHECK (equity_at_entry IS NULL OR equity_at_entry > 0);

-- Backfill ------------------------------------------------------------------
--
-- One-off, and written in SQL rather than as a script so it is auditable next
-- to the column it fills. Runs as the migration role, which bypasses RLS, so
-- the security-invoker view is read across every user's rows — correct here,
-- and the reason each sum is scoped by `account_id` rather than by `user_id`.
--
-- Trades already carrying a value are skipped, so re-running is a no-op.

WITH entry_day AS (
  SELECT
    p.id,
    p.account_id,
    a.starting_balance,
    (date_trunc('day', s.opened_at AT TIME ZONE a.timezone) AT TIME ZONE a.timezone)
      AS day_start
  FROM public.tj_positions p
  JOIN public.tj_accounts a ON a.id = p.account_id
  JOIN public.tj_position_stats s ON s.position_id = p.id
  WHERE p.equity_at_entry IS NULL
    AND s.opened_at IS NOT NULL
),
knowable AS (
  SELECT
    d.id,
    d.starting_balance
      + COALESCE((
          SELECT sum(s2.net_pl)
          FROM public.tj_position_stats s2
          WHERE s2.account_id = d.account_id
            AND s2.closed_at < d.day_start
        ), 0)
      + COALESCE((
          SELECT sum(c.amount)
          FROM public.tj_cash_events c
          WHERE c.account_id = d.account_id
            AND c.occurred_at < d.day_start
        ), 0) AS equity
  FROM entry_day d
  -- One unpriced trade before this day and the total is a guess, not a balance.
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.tj_position_stats s3
    WHERE s3.account_id = d.account_id
      AND s3.closed_at < d.day_start
      AND s3.net_pl IS NULL
  )
)
UPDATE public.tj_positions p
SET equity_at_entry = k.equity
FROM knowable k
WHERE p.id = k.id
  AND k.equity > 0;


-- The merge carries the denominator ------------------------------------------
--
-- `tj_merge_positions` moves one trade's fills onto another and deletes the
-- donor. `equity_at_entry` joins the COMPLETED-NEVER-OVERWRITTEN group rather
-- than the instrument snapshot, which follows the fills: the keep row's own
-- denominator is the one its own entry was measured against, and a merge must
-- not re-base a trade that was already open. Only a keep row that never had one
-- — a plan absorbing the fills that filled it — takes the donor's.
--
-- Restated whole rather than patched, per the convention for functions here.
-- `merge-positions.test.ts` now reads THIS file: it asserts that the column list
-- in `merge-positions.ts` matches the SQL, and pointing it at the superseded
-- copy would have it guard a function that no longer runs.

CREATE OR REPLACE FUNCTION public.tj_merge_positions(
  p_keep       uuid,
  p_fills_from uuid
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
DECLARE
  v_keep  record;
  v_other record;
BEGIN
  IF p_keep = p_fills_from THEN
    RAISE EXCEPTION 'A trade cannot be merged into itself.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_keep  FROM public.tj_positions WHERE id = p_keep;
  SELECT * INTO v_other FROM public.tj_positions WHERE id = p_fills_from;

  IF v_keep.id IS NULL OR v_other.id IS NULL THEN
    RAISE EXCEPTION 'Trade not found.' USING ERRCODE = 'no_data_found';
  END IF;

  -- The same three refusals `mergeRefusal` makes in the dialog, restated where
  -- they are enforced. A client that skipped the dialog is not a reason to
  -- destroy a trade.
  IF v_keep.instrument IS DISTINCT FROM v_other.instrument THEN
    RAISE EXCEPTION 'Different instruments are not one trade.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF lower(COALESCE(v_keep.direction, '')) IS DISTINCT FROM lower(COALESCE(v_other.direction, '')) THEN
    RAISE EXCEPTION 'A long and a short are not one trade.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_keep.account_id IS DISTINCT FROM v_other.account_id THEN
    RAISE EXCEPTION 'These trades are on two different accounts.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1) Fills, whole ------------------------------------------------------------
  DELETE FROM public.tj_executions WHERE position_id = p_keep;
  UPDATE public.tj_executions SET position_id = p_keep WHERE position_id = p_fills_from;

  -- 2) Children with a unique key per position ---------------------------------
  --
  -- Each of these three has a UNIQUE (position_id, <something>), so a row can
  -- only move across when the survivor has nothing under that key. The rest go
  -- with the delete at the end — the survivor's own answer wins, because it is
  -- the one whose judgement is being kept.
  UPDATE public.tj_trade_images i
     SET position_id = p_keep
   WHERE i.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_trade_images k
        WHERE k.position_id = p_keep AND k.kind = i.kind
     );

  UPDATE public.tj_position_rules r
     SET position_id = p_keep
   WHERE r.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_rules k
        WHERE k.position_id = p_keep AND k.rule_id = r.rule_id
     );

  -- A check-in on a LOCKED day cannot move, and its guard raises rather than
  -- skipping. That is the right answer: a locked day is a day the trader
  -- declared finished, and this transaction stops instead of half-merging.
  UPDATE public.tj_position_checkins c
     SET position_id = p_keep
   WHERE c.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_checkins k
        WHERE k.position_id = p_keep AND k.report_date = c.report_date
     );

  UPDATE public.tj_notes       SET position_id = p_keep WHERE position_id = p_fills_from;
  UPDATE public.tj_import_rows SET matched_position_id = p_keep WHERE matched_position_id = p_fills_from;

  -- 3) The surviving row -------------------------------------------------------
  --
  -- Money follows the fills, including to NULL: an override describing fills
  -- that are no longer here is a wrong number presented as fact. The instrument
  -- snapshot travels with it for the same reason — it is what those fills were
  -- priced with.
  UPDATE public.tj_positions k SET
    status                  = v_other.status,
    needs_review            = v_other.needs_review,
    gross_pnl_override      = v_other.gross_pnl_override,
    point_value_at_trade    = COALESCE(v_other.point_value_at_trade, k.point_value_at_trade),
    tick_size_at_trade      = COALESCE(v_other.tick_size_at_trade, k.tick_size_at_trade),
    quote_currency_at_trade = COALESCE(v_other.quote_currency_at_trade, k.quote_currency_at_trade),
    fx_rate_at_trade        = COALESCE(v_other.fx_rate_at_trade, k.fx_rate_at_trade),

    -- Plan and judgement: completed, never overwritten.
    entry_price         = COALESCE(k.entry_price, v_other.entry_price),
    stop_price          = COALESCE(k.stop_price, v_other.stop_price),
    target_price        = COALESCE(k.target_price, v_other.target_price),
    risk_pct            = COALESCE(k.risk_pct, v_other.risk_pct),
    planned_rr          = COALESCE(k.planned_rr, v_other.planned_rr),
    position_size       = COALESCE(k.position_size, v_other.position_size),
    setup_grade         = COALESCE(k.setup_grade, v_other.setup_grade),
    conviction          = COALESCE(k.conviction, v_other.conviction),
    execution_rating    = COALESCE(k.execution_rating, v_other.execution_rating),
    exit_reason         = COALESCE(k.exit_reason, v_other.exit_reason),
    thesis              = COALESCE(k.thesis, v_other.thesis),
    invalidation        = COALESCE(k.invalidation, v_other.invalidation),
    time_stop_days      = COALESCE(k.time_stop_days, v_other.time_stop_days),
    scale_out_plan      = COALESCE(k.scale_out_plan, v_other.scale_out_plan),
    trade_journal_notes = COALESCE(k.trade_journal_notes, v_other.trade_journal_notes),
    playbook_id         = COALESCE(k.playbook_id, v_other.playbook_id),
    miss_reason         = COALESCE(k.miss_reason, v_other.miss_reason),
    missed_at           = COALESCE(k.missed_at, v_other.missed_at),
    max_drawdown_price  = COALESCE(k.max_drawdown_price, v_other.max_drawdown_price),
    max_profit_price    = COALESCE(k.max_profit_price, v_other.max_profit_price),
    equity_at_entry     = COALESCE(k.equity_at_entry, v_other.equity_at_entry),

    -- Tags: two lists about one trade are one list, deduped and without empties.
    mistake = ARRAY(
      SELECT DISTINCT t FROM unnest(k.mistake || v_other.mistake) AS t WHERE t <> ''
    ),
    technical_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.technical_tags || v_other.technical_tags) AS t WHERE t <> ''
    ),
    psychology_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.psychology_tags || v_other.psychology_tags) AS t WHERE t <> ''
    ),

    -- User-defined fields: the survivor's answers win key by key.
    custom = v_other.custom || k.custom,
    -- A ladder is a plan, so it is completed rather than merged: two ladders for
    -- one trade would add up to more than the trade.
    scale_out_levels = CASE
      WHEN jsonb_array_length(COALESCE(k.scale_out_levels, '[]'::jsonb)) > 0
        THEN k.scale_out_levels
      ELSE COALESCE(v_other.scale_out_levels, '[]'::jsonb)
    END,
    updated_at = now()
  WHERE k.id = p_keep;

  -- 4) And the other one is gone -----------------------------------------------
  DELETE FROM public.tj_positions WHERE id = p_fills_from;
END;
$function$;

REVOKE ALL ON FUNCTION public.tj_merge_positions(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_merge_positions(uuid, uuid) TO authenticated;
