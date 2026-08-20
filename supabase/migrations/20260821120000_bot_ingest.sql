-- =============================================================================
-- Bot ingest: cTrader pending order -> planned trade -> open trade.
--
-- WHAT WAS WRONG
-- Every trade was typed by hand, including the parts the broker had already
-- established: the symbol, the direction, the limit price, the stop, and the
-- price a fill actually happened at. Transcription is not judgement, and the
-- journal was paying full attention for it. Worse, the two facts most useful
-- for reviewing execution -- the limit price versus the fill price -- were the
-- two most likely to be rounded or remembered wrong, because they were read off
-- a chart minutes or hours later.
--
-- WHAT BREAKS WITHOUT THIS
-- Nothing breaks; this is additive. But without it `computeEntrySlippage`
-- (src/lib/journal/entry-slippage.ts) has almost no real data to work on, and
-- the planned -> open lifecycle that `tj_positions_status_check` has modelled
-- since 20260721130000 stays a thing the trader maintains by hand.
--
-- SCOPE, DELIBERATELY NARROW
-- The bot writes ONLY what the broker did: instrument, direction, prices,
-- volume, fills. It never writes plan, thesis, psychology, setup grade,
-- playbook, risk_pct or planned_rr. The README's position -- "Rucni unos je
-- izbor i prednost" -- survives intact for everything that is a judgement.
-- Out of scope here, and the design must not close them off: cancelled -> missed,
-- close -> closed, MAE/MFE.
--
-- -----------------------------------------------------------------------------
-- WHY A SECOND WRITER INTO tj_positions IS NOT A "JEDAN ODGOVOR PO PITANJU"
-- VIOLATION
--
-- A reader will flag this, so: the README's own answer is "Baza je cuvar, ne
-- akcija". The rules that must never diverge live in CHECK constraints and
-- triggers, not in the caller. Both writers -- `tj_save_trade` for the human,
-- `tj_bot_ingest` for the bot -- pass through the same
-- `tj_positions_prices_positive`, `tj_positions_status_check`,
-- `tj_execution_guard`, `tj_position_missed_guard` and `tj_assign_trade_no`.
-- One implementation of a RULE, not one caller.
--
-- WHY THIS FUNCTION DOES NOT CALL tj_save_trade
-- Three independent blockers, and the third is the one that would have bitten
-- silently:
--   1. `tj_save_trade` is SECURITY INVOKER and inserts `user_id = auth.uid()`
--      (20260816120000_write_path_integrity.sql:118). Called with the anon key
--      auth.uid() is NULL and the insert violates NOT NULL. It simply fails.
--   2. The only way to force it is `set_config('request.jwt.claims', ...)` to
--      forge a session. Rejected: the README names SECURITY DEFINER + a uuid
--      argument as the canonical hole in this schema and six functions had
--      EXECUTE revoked over it. Forging a claim is a strictly stronger version
--      of the same shape, reachable by `anon`. It would be the least defensible
--      line in the database.
--   3. Its execution handling is FULL REPLACE -- DELETE then insert
--      (20260816120000:171). The bot's feed is incremental. Today that is
--      invisible because step 1 writes one entry fill onto a position that has
--      none; at step 3 the exit event would silently delete the entry fill.
--
-- WHY THIS FUNCTION DOES NOT COMPUTE STATUS
-- `computeStatus` (src/lib/journal/trade-lifecycle.ts:63-84) is the single
-- definition of status-from-fills and it lives in TypeScript, unreachable from
-- SQL, with no DB test harness in this repo to hold a SQL twin to parity.
-- So this function does not compute status -- it ASSERTS it from the event
-- kind, inside a hard two-value set: order_placed -> 'planned',
-- order_filled -> 'open'. That is checkable rather than duplicated: for zero
-- fills with the 'open' hint, and for entry-only-with-no-exit, `computeStatus`
-- returns exactly these, unconditionally. There is no branch to diverge on.
-- The v_status CHECK below exists so a later edit cannot quietly widen it.
--
-- OBLIGATION FOR STEP 3, WRITTEN DOWN NOW SO IT IS NOT DESIGNED INTO A CORNER:
-- 'partial' and 'closed' ARE fill-counting, and the moment exit events arrive
-- the counting rule must exist in exactly one place. Add
-- `tj_status_from_executions(uuid)` in SQL, make BOTH writers call it, and
-- demote the TS `computeStatus` to the form's live preview -- the same shape as
-- the existing `tj_position_stats` / `position-stats.ts` pair the README
-- already justifies.
--
-- WHY THE FTMO FREEZE IS NOT ENFORCED ON THIS PATH
-- `isFtmoAccountFrozen` (src/lib/journal/ftmo-status.ts) guards the two server
-- actions, and deliberately does not guard this one. The freeze is a discipline
-- gate on the HUMAN's write path. The broker has already executed the order;
-- a journal that refuses to record a trade that happened is a wrong book, which
-- is the worse failure by this repo's own prime directive. Bot rows on a frozen
-- account land with needs_review = true and the existing banner still reports
-- the breach.
--
-- COORDINATION NOTE FOR FAZA 8B
-- FAZA_8B_PLAN.md proposes `tj_ctrader_connections.linked_tj_account_id` for
-- the same question this migration answers with `tj_accounts.broker_account_id`:
-- "which tj_account is cTrader 5100123?". Two columns answering one question
-- WILL diverge. When 8B lands, that column must derive from this one or not
-- exist. This note is duplicated in FAZA_8B_PLAN.md on purpose.
-- =============================================================================


-- 1) Provenance ---------------------------------------------------------------
--
-- 'bot', not 'ctrader': WHICH broker is a separate question and gets its own
-- column below. Two columns answering one question each.
--
-- Widening only -- ('manual','import') is a strict subset of the new set -- so
-- no existing row can fail the new constraint.

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'import'::text, 'bot'::text]));

ALTER TABLE public.tj_executions DROP CONSTRAINT IF EXISTS tj_executions_source_check;
ALTER TABLE public.tj_executions ADD CONSTRAINT tj_executions_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'import'::text, 'bot'::text]));


-- 2) Broker correlation --------------------------------------------------------
--
-- All `text`: these are opaque broker handles, never arithmetic.
--
-- `broker_account` is part of the key because order ids are only unique WITHIN
-- an account, and demo and live run side by side on the same journal.
--
-- Deliberately NOT on tj_executions. `updateTrade` deletes and re-inserts every
-- fill from the form payload (trades/actions.ts:353-372) and `cleanExecs`
-- hardcodes source 'manual' (:154-166) -- so the first time a human opens a bot
-- trade and saves, any key stored on the fill is destroyed, and a later replay
-- would then insert a duplicate. Idempotency lives on tj_bot_events.event_key
-- and nowhere else.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS broker             text,
  ADD COLUMN IF NOT EXISTS broker_account     text,
  ADD COLUMN IF NOT EXISTS broker_order_id    text,
  ADD COLUMN IF NOT EXISTS broker_position_id text;

COMMENT ON COLUMN public.tj_positions.broker IS
  'Broker family that produced this row, e.g. ''ctrader''. NULL for hand-typed trades.';
COMMENT ON COLUMN public.tj_positions.broker_account IS
  'Broker-side account number as text. Part of the correlation key: order ids repeat across accounts.';
COMMENT ON COLUMN public.tj_positions.broker_order_id IS
  'cTrader PendingOrder.Id. Set when the order was seen at placement; NULL when the bot only saw the fill.';
COMMENT ON COLUMN public.tj_positions.broker_position_id IS
  'cTrader Position.Id. Set at fill. Not equal to broker_order_id -- cTrader numbers them separately.';

-- Partial indexes: thousands of hand-typed rows carry NULL here and must not
-- collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS tj_positions_broker_order_key
  ON public.tj_positions (user_id, broker, broker_account, broker_order_id)
  WHERE broker_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tj_positions_broker_position_key
  ON public.tj_positions (user_id, broker, broker_account, broker_position_id)
  WHERE broker_position_id IS NOT NULL;


-- 3) Account mapping -----------------------------------------------------------
--
-- On tj_accounts rather than in a mapping table: `tj_accounts.broker` is
-- already a free-text label with nothing machine-readable beside it. This is
-- the missing half of that column.
--
-- An unmapped account number quarantines. It NEVER falls back to accounts[0] --
-- filing a live trade under the wrong account is a wrong number presented as
-- fact, in the account currency of somewhere it did not happen.

ALTER TABLE public.tj_accounts
  ADD COLUMN IF NOT EXISTS broker_account_id text;

COMMENT ON COLUMN public.tj_accounts.broker_account_id IS
  'Broker-side account number this journal account maps to (cTrader Account.Number). '
  'Set from Settings. See the Faza 8B coordination note in 20260821120000_bot_ingest.sql.';

CREATE UNIQUE INDEX IF NOT EXISTS tj_accounts_broker_account_key
  ON public.tj_accounts (user_id, broker_account_id)
  WHERE broker_account_id IS NOT NULL;


-- 4) Symbol + volume resolution ------------------------------------------------
--
-- WHY NOT normalizeInstrumentSymbol (src/lib/journal/instrument-aliases.ts:52-71)
-- It passes UNKNOWN symbols through as a cleaned key, and 20260728120000
-- names exactly that as a failure mode: "EUR/USD.pro" -> "EURUSDPRO" matches no
-- instrument and the trade prices at point_value = null. For a CSV a human is
-- reading, pass-through is forgiving. For a machine feed it is a guess. This
-- path RESOLVES or refuses. The TS alias table stays where it is, doing what it
-- does for import, and in Settings it only SUGGESTS a mapping -- a suggestion is
-- not a second answer; the stored row is the answer.
--
-- units_per_qty: the journal counts qty in lots/contracts (see the header of
-- src/lib/journal/default-instruments.ts -- point_value is money per 1.00 price
-- move per ONE unit of qty, hence EURUSD 100000, XAUUSD 100, NAS100 1), while
-- cTrader reports VolumeInUnits in base units. qty = volume_in_units /
-- units_per_qty. For FX and metals that divisor is Symbol.LotSize; for FTMO's
-- own index CFDs it is NOT verifiable from here, because FTMO runs its own
-- cTrader server instance with its own symbol list. So the bot sends lot_size as
-- a raw platform fact, Settings proposes it, and a HUMAN confirms once per
-- symbol. Until confirmed the event quarantines. A wrong divisor on NAS100 is a
-- P&L wrong by orders of magnitude, shown as fact.

CREATE TABLE IF NOT EXISTS public.tj_broker_symbol_map (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL DEFAULT auth.uid(),
  broker        text        NOT NULL,
  broker_symbol text        NOT NULL,
  instrument    text        NOT NULL,
  units_per_qty numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_broker_symbol_map_pkey PRIMARY KEY (id),
  CONSTRAINT tj_broker_symbol_map_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_broker_symbol_map_instrument_fkey FOREIGN KEY (user_id, instrument)
    REFERENCES public.tj_instruments (user_id, symbol) ON DELETE CASCADE,
  CONSTRAINT tj_broker_symbol_map_unique UNIQUE (user_id, broker, broker_symbol),
  CONSTRAINT tj_broker_symbol_map_units_positive CHECK (units_per_qty > 0)
);

COMMENT ON COLUMN public.tj_broker_symbol_map.broker_symbol IS
  'Broker symbol, cleaned to [A-Z0-9] uppercase before storing and before lookup.';
COMMENT ON COLUMN public.tj_broker_symbol_map.units_per_qty IS
  'Divisor turning cTrader VolumeInUnits into journal qty (lots/contracts). Human-confirmed, never inferred.';


-- 5) Bot credentials and the event log -----------------------------------------
--
-- The token is the real credential; the anon key in front of it is public by
-- design (README). Plaintext is generated in the BROWSER and only its SHA-256
-- ever reaches the server, so a server log cannot leak a working token.
-- sha256() and convert_to() are pg_catalog, hence safe under search_path ''.

CREATE TABLE IF NOT EXISTS public.tj_bot_tokens (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL DEFAULT auth.uid(),
  label        text        NOT NULL,
  token_hash   bytea       NOT NULL,
  token_prefix text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  CONSTRAINT tj_bot_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT tj_bot_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_bot_tokens_hash_unique UNIQUE (token_hash)
);

-- Append-only audit AND the idempotency boundary. One UNIQUE constraint makes
-- retries, a second attached cBot instance, and an outbox re-drain after a crash
-- all harmless -- in the database, not in the bot's memory. It also answers
-- "what did the bot actually send", in the spirit of tj_import_rows.
CREATE TABLE IF NOT EXISTS public.tj_bot_events (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL,
  token_id       uuid,
  broker         text        NOT NULL,
  broker_account text        NOT NULL,
  event_key      text        NOT NULL,
  kind           text        NOT NULL,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL,
  reason         text,
  position_id    uuid,
  received_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_bot_events_pkey PRIMARY KEY (id),
  CONSTRAINT tj_bot_events_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_bot_events_token_id_fkey FOREIGN KEY (token_id)
    REFERENCES public.tj_bot_tokens(id) ON DELETE SET NULL,
  CONSTRAINT tj_bot_events_position_id_fkey FOREIGN KEY (position_id)
    REFERENCES public.tj_positions(id) ON DELETE SET NULL,
  CONSTRAINT tj_bot_events_key_unique UNIQUE (user_id, event_key),
  CONSTRAINT tj_bot_events_status_check CHECK (status = ANY (ARRAY['applied'::text, 'quarantined'::text]))
);

CREATE INDEX IF NOT EXISTS tj_bot_events_token_recent_idx
  ON public.tj_bot_events (token_id, received_at DESC);
CREATE INDEX IF NOT EXISTS tj_bot_events_quarantine_idx
  ON public.tj_bot_events (user_id, received_at DESC) WHERE status = 'quarantined';


-- 6) RLS -----------------------------------------------------------------------
-- Same ownership pattern as the other 25 tables.

ALTER TABLE public.tj_broker_symbol_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_bot_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_bot_events        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tj_broker_symbol_map_owner ON public.tj_broker_symbol_map;
CREATE POLICY tj_broker_symbol_map_owner ON public.tj_broker_symbol_map
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_bot_tokens_owner ON public.tj_bot_tokens;
CREATE POLICY tj_bot_tokens_owner ON public.tj_bot_tokens
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Read/delete only for the human. Rows are written by tj_bot_ingest, which is
-- SECURITY DEFINER and bypasses this; there is no legitimate reason for a
-- browser session to forge an event row.
DROP POLICY IF EXISTS tj_bot_events_owner ON public.tj_bot_events;
CREATE POLICY tj_bot_events_owner ON public.tj_bot_events
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_bot_events_owner_delete ON public.tj_bot_events;
CREATE POLICY tj_bot_events_owner_delete ON public.tj_bot_events
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));


-- 7) The ingest function --------------------------------------------------------
--
-- Reachable by `anon` ON PURPOSE: the bot has no Supabase session and must not
-- carry the user's password or a service-role key. The token is the credential.
--
-- Returns jsonb rather than raising, for every rejection. A RAISE would give an
-- unauthenticated caller a distinguishable error surface to enumerate; one
-- opaque shape does not. `retryable` is what stops a bot from hammering a
-- revoked token forever.

CREATE OR REPLACE FUNCTION public.tj_bot_ingest(p_token text, p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_token       public.tj_bot_tokens%ROWTYPE;
  v_uid         uuid;
  v_kind        text;
  v_key         text;
  v_broker      text;
  v_bacct       text;
  v_recent      integer;
  v_event_id    uuid;
  v_account_id  uuid;
  v_acct_ccy    text;
  v_sym_raw     text;
  v_sym_clean   text;
  v_instrument  text;
  v_units       numeric;
  v_pos         public.tj_positions%ROWTYPE;
  v_pos_id      uuid;
  v_status      text;
  v_direction   text;
  v_qty         numeric;
  v_entry       numeric;
  v_stop        numeric;
  v_target      numeric;
  v_fill_price  numeric;
  v_filled_at   timestamptz;
  v_pv          numeric;
  v_ts          numeric;
  v_ccy         text;
  v_fx          numeric;
  v_fill_count  integer;
  -- Force needs_review back on, rather than "this trade needs review". A bot
  -- trade is created with needs_review = true and normally KEEPS whatever the
  -- human has since set — re-raising the flag on every fill would undo a review
  -- that was already done. Only the missed -> open flip is surprising enough to
  -- demand a second look.
  v_force_review boolean := false;
  v_reason      text;
BEGIN
  -- 7.1 Authenticate -----------------------------------------------------------
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_token
    FROM public.tj_bot_tokens
   WHERE token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
     AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'unauthorized');
  END IF;

  v_uid := v_token.user_id;

  -- 7.2 Rate limit -------------------------------------------------------------
  -- The endpoint is world-reachable. The threat is not brute force against a
  -- 256-bit token, it is unbounded CPU. One index scan buys the ceiling.
  SELECT count(*) INTO v_recent
    FROM public.tj_bot_events
   WHERE token_id = v_token.id
     AND received_at > now() - interval '60 seconds';

  IF v_recent > 120 THEN
    RETURN jsonb_build_object('ok', false, 'retryable', true, 'error', 'rate_limited');
  END IF;

  -- 7.3 Envelope ---------------------------------------------------------------
  v_kind   := p_event ->> 'kind';
  v_key    := p_event ->> 'event_key';
  v_broker := p_event ->> 'broker';
  v_bacct  := p_event ->> 'broker_account';

  -- Heartbeat carries no trade data and writes no event row: its whole purpose
  -- is to make a silently-dead bot visible from the journal, which last_used_at
  -- already answers. cTrader Cloud sends no HTTP AND SAYS NOTHING when it does
  -- not, so "the bot looks fine but nothing arrives" is a real, documented
  -- failure mode that needs a detector on this side.
  IF v_kind = 'heartbeat' THEN
    UPDATE public.tj_bot_tokens SET last_used_at = now() WHERE id = v_token.id;
    RETURN jsonb_build_object('ok', true, 'result', 'heartbeat');
  END IF;

  IF v_kind IS NULL OR v_key IS NULL OR v_broker IS NULL OR v_bacct IS NULL
     OR v_kind NOT IN ('order_placed', 'order_filled') THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
  END IF;

  -- broker_order_id is the correlation key for the whole design. Without it a
  -- fill cannot be matched to its placement and a re-send cannot be recognised
  -- as the same order, so refuse rather than write a row that can never be
  -- joined to anything.
  IF NULLIF(p_event ->> 'broker_order_id', '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
  END IF;

  UPDATE public.tj_bot_tokens SET last_used_at = now() WHERE id = v_token.id;

  -- 7.4 Idempotency boundary ---------------------------------------------------
  -- Everything below this line runs at most once per event_key, forever.
  INSERT INTO public.tj_bot_events
    (user_id, token_id, broker, broker_account, event_key, kind, payload, status)
  VALUES
    (v_uid, v_token.id, v_broker, v_bacct, v_key, v_kind, p_event, 'quarantined')
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate');
  END IF;

  -- 7.5 Resolve account --------------------------------------------------------
  SELECT id, currency INTO v_account_id, v_acct_ccy
    FROM public.tj_accounts
   WHERE user_id = v_uid AND broker_account_id = v_bacct;

  IF v_account_id IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'unmapped_account' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unmapped_account');
  END IF;

  -- 7.6 Resolve symbol and the volume divisor ----------------------------------
  v_sym_raw   := p_event ->> 'symbol';
  v_sym_clean := pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(v_sym_raw, ''), '[^A-Za-z0-9]', '', 'g'));

  IF v_sym_clean = '' THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_symbol' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_symbol');
  END IF;

  -- Explicit human mapping wins. It is the only place units_per_qty can come
  -- from, so a symbol that needs a divisor different from its own name implies
  -- a mapping row exists.
  SELECT m.instrument, m.units_per_qty INTO v_instrument, v_units
    FROM public.tj_broker_symbol_map m
   WHERE m.user_id = v_uid AND m.broker = v_broker AND m.broker_symbol = v_sym_clean;

  IF v_instrument IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'unmapped_symbol' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unmapped_symbol');
  END IF;

  -- 7.7 Direction and quantity -------------------------------------------------
  v_direction := CASE lower(COALESCE(p_event ->> 'trade_type', ''))
                   WHEN 'buy'  THEN 'Long'
                   WHEN 'sell' THEN 'Short'
                   ELSE NULL
                 END;

  IF v_direction IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_direction' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_direction');
  END IF;

  -- Numbers are read through jsonb_typeof rather than cast blindly.
  --
  -- This endpoint is reachable by `anon`, so the payload is untrusted input, and
  -- a bare `(p_event->>'x')::numeric` on the string "abc" raises. A raise here
  -- would abort the whole transaction INCLUDING the tj_bot_events insert above —
  -- so the event would vanish, the bot would get an error, and it would retry
  -- the same bad payload forever. Reading the type first turns that into a
  -- quarantined row that says what was wrong.
  v_qty    := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'volume_in_units') = 'number'
                   THEN (p_event ->> 'volume_in_units')::numeric END;
  v_entry  := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'target_price') = 'number'
                   THEN (p_event ->> 'target_price')::numeric END;
  v_stop   := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'stop_loss') = 'number'
                   THEN (p_event ->> 'stop_loss')::numeric END;
  v_target := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'take_profit') = 'number'
                   THEN (p_event ->> 'take_profit')::numeric END;

  v_qty := CASE WHEN v_qty IS NOT NULL THEN v_qty / v_units END;

  IF v_qty IS NULL OR v_qty <= 0 THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_volume' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_volume');
  END IF;

  -- The limit price is the trade's entry and must be a real price.
  IF v_entry IS NULL OR v_entry <= 0 THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_price' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_price');
  END IF;

  -- Stop and target are optional. cTrader reports "not set" as null, but a 0
  -- would violate tj_positions_prices_positive and abort the transaction, so a
  -- non-positive value is read as absent rather than allowed to raise.
  IF v_stop IS NOT NULL AND v_stop <= 0 THEN v_stop := NULL; END IF;
  IF v_target IS NOT NULL AND v_target <= 0 THEN v_target := NULL; END IF;

  -- 7.8 Freeze the contract spec ------------------------------------------------
  -- Mirrors instrumentSnapshot + resolveFxRate. fx_rate is 1 only when the quote
  -- currency IS the account currency, and NULL otherwise -- never 1 as a
  -- convenience, which would silently price a cross-currency trade as if no
  -- conversion existed. The view already reports the NULL as 'missing'.
  SELECT i.point_value, i.tick_size, i.currency
    INTO v_pv, v_ts, v_ccy
    FROM public.tj_instruments i
   WHERE i.user_id = v_uid AND i.symbol = v_instrument;

  v_fx := CASE WHEN v_ccy IS NOT NULL AND v_ccy = v_acct_ccy THEN 1 ELSE NULL END;

  -- 7.9 Apply -------------------------------------------------------------------
  SELECT * INTO v_pos
    FROM public.tj_positions
   WHERE user_id = v_uid AND broker = v_broker AND broker_account = v_bacct
     AND broker_order_id = p_event ->> 'broker_order_id';

  -- Deliberately NOT `IF FOUND`: FOUND is reset by later statements, and the
  -- order_filled branch runs several before it needs this answer. A plain NULL
  -- test on the row variable cannot drift.
  IF v_kind = 'order_placed' THEN
    IF v_pos.id IS NOT NULL THEN
      -- The order is already on the books. A re-send with a fresh event_key
      -- (LocalStorage wiped, Reconcile after a restart) must not create a second
      -- row and must not overwrite a row the human has since edited.
      UPDATE public.tj_bot_events
         SET status = 'applied', reason = 'already_present', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'already_present',
                                'position_id', v_pos.id);
    END IF;

    v_status := 'planned';

    -- The two-value assertion the header promises. Status here is asserted from
    -- the event kind, not computed, and this is what stops a later edit from
    -- quietly widening it into a second implementation of `computeStatus`.
    IF v_status NOT IN ('planned', 'open') THEN
      RAISE EXCEPTION 'tj_bot_ingest may only assert planned or open, got %', v_status
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.tj_positions (
      user_id, account_id, status, source, needs_review,
      instrument, direction,
      entry_price, stop_price, target_price, position_size,
      point_value_at_trade, tick_size_at_trade, quote_currency_at_trade, fx_rate_at_trade,
      broker, broker_account, broker_order_id
    ) VALUES (
      v_uid, v_account_id, v_status, 'bot', true,
      v_instrument, v_direction,
      v_entry, v_stop, v_target,
      v_qty,
      v_pv, v_ts, v_ccy, v_fx,
      v_broker, v_bacct, p_event ->> 'broker_order_id'
    )
    RETURNING id INTO v_pos_id;

    UPDATE public.tj_bot_events
       SET status = 'applied', position_id = v_pos_id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'result', 'created', 'position_id', v_pos_id);
  END IF;

  -- order_filled ---------------------------------------------------------------
  v_fill_price := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'fill_price') = 'number'
                       THEN (p_event ->> 'fill_price')::numeric END;

  -- The timestamp is the one value that cannot be type-checked into safety: a
  -- JSON string is a valid string and still not a valid time. Caught narrowly
  -- rather than with `others`, so a real defect in this function still surfaces
  -- as a failure instead of being filed as a bad payload.
  BEGIN
    v_filled_at := NULLIF(p_event ->> 'filled_at', '')::timestamptz;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      v_filled_at := NULL;
  END;

  IF v_fill_price IS NULL OR v_fill_price <= 0 OR v_filled_at IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_fill' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_fill');
  END IF;

  IF v_pos.id IS NULL THEN
    -- The bot was down when the order was placed. One row, straight to open.
    INSERT INTO public.tj_positions (
      user_id, account_id, status, source, needs_review,
      instrument, direction,
      entry_price, stop_price, target_price, position_size,
      point_value_at_trade, tick_size_at_trade, quote_currency_at_trade, fx_rate_at_trade,
      broker, broker_account, broker_order_id, broker_position_id
    ) VALUES (
      v_uid, v_account_id, 'open', 'bot', true,
      v_instrument, v_direction,
      v_entry, v_stop, v_target,
      v_qty,
      v_pv, v_ts, v_ccy, v_fx,
      v_broker, v_bacct, p_event ->> 'broker_order_id', p_event ->> 'broker_position_id'
    )
    RETURNING id INTO v_pos_id;

    v_reason := 'fill_without_placement';
  ELSE
    v_pos_id := v_pos.id;

    IF v_pos.status NOT IN ('planned', 'missed') THEN
      UPDATE public.tj_bot_events
         SET reason = 'unexpected_status', position_id = v_pos_id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                                'reason', 'unexpected_status', 'position_id', v_pos_id);
    END IF;

    IF v_pos.status = 'missed' THEN
      -- The human wrote it off; the market disagreed. Keep miss_reason -- that
      -- judgement was real and is worth reading later -- but the trade happened,
      -- and a write-off that traded is worth looking at again.
      v_reason := 'was_missed';
      v_force_review := true;
    END IF;

    -- Status FIRST, fill second: tj_execution_guard / tj_position_missed_guard
    -- refuse a fill on a 'missed' position, and 20260730140000 ends with a note
    -- about exactly this ordering.
    UPDATE public.tj_positions
       SET status             = 'open',
           broker_position_id = COALESCE(p_event ->> 'broker_position_id', broker_position_id),
           needs_review       = CASE WHEN v_force_review THEN true ELSE needs_review END
     WHERE id = v_pos_id;
  END IF;

  -- Never a second entry fill on the same position.
  SELECT count(*) INTO v_fill_count
    FROM public.tj_executions
   WHERE position_id = v_pos_id AND side = 'entry';

  IF v_fill_count > 0 THEN
    UPDATE public.tj_bot_events
       SET reason = 'already_has_fills', position_id = v_pos_id
     WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                              'reason', 'already_has_fills', 'position_id', v_pos_id);
  END IF;

  -- fee and swap are 0 ON PURPOSE. Position.Commission has an unverified sign
  -- and round-turn convention across brokers, and step 1 has no exit fill, so no
  -- money is computed from this row yet either way. The raw values ride along in
  -- tj_bot_events.payload so nothing is lost. Resolving them is an explicit
  -- obligation of step 3, before exits land and net P&L starts being read.
  INSERT INTO public.tj_executions
    (user_id, position_id, side, price, qty, executed_at, fee, swap_funding, source)
  VALUES
    (v_uid, v_pos_id, 'entry', v_fill_price, v_qty, v_filled_at, 0, 0, 'bot');

  UPDATE public.tj_bot_events
     SET status = 'applied', reason = v_reason, position_id = v_pos_id
   WHERE id = v_event_id;

  RETURN jsonb_build_object('ok', true, 'result', 'filled',
                            'reason', v_reason, 'position_id', v_pos_id);
END;
$$;

-- `authenticated` is revoked BY NAME, not only via PUBLIC: Supabase's default
-- privileges grant EXECUTE on every new function in `public` to anon AND
-- authenticated at creation time, and REVOKE ... FROM PUBLIC does not remove an
-- explicit role grant. Same lesson as 20260730130000.
--
-- A signed-in browser session has no business calling this: it already has
-- tj_save_trade, and leaving the grant would mean two doors onto the same write
-- with only one of them carrying the form's validation.
REVOKE ALL ON FUNCTION public.tj_bot_ingest(text, jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.tj_bot_ingest(text, jsonb) TO anon;


-- 8) Keep the sweep functions honest -------------------------------------------
--
-- tj_reset_my_data and tj_delete_account enumerate tables BY HAND (20260817120000)
-- precisely so that a table added later is a visible omission rather than a
-- silent survivor. Three tables were added above; this is that visibility being
-- paid for.
--
-- tj_bot_events.position_id is ON DELETE SET NULL, so deleting an account's
-- trades leaves its events behind as an audit trail with a dangling reference --
-- correct for a log, wrong for "reset everything", hence the explicit delete in
-- the reset path only.

CREATE OR REPLACE FUNCTION public.tj_reset_my_data()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.tj_bot_events          WHERE user_id = v_uid;
  DELETE FROM public.tj_bot_tokens          WHERE user_id = v_uid;
  DELETE FROM public.tj_broker_symbol_map   WHERE user_id = v_uid;
  DELETE FROM public.tj_position_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_position_checkins   WHERE user_id = v_uid;
  DELETE FROM public.tj_trade_images        WHERE user_id = v_uid;
  DELETE FROM public.tj_executions          WHERE user_id = v_uid;
  DELETE FROM public.tj_import_rows         WHERE user_id = v_uid;
  DELETE FROM public.tj_positions           WHERE user_id = v_uid;
  DELETE FROM public.tj_import_batches      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rule_links WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbooks           WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_checkins    WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_rules       WHERE user_id = v_uid;
  DELETE FROM public.tj_daily_reports       WHERE user_id = v_uid;
  DELETE FROM public.tj_weekly_reviews      WHERE user_id = v_uid;
  DELETE FROM public.tj_focus_goals         WHERE user_id = v_uid;
  DELETE FROM public.tj_notes               WHERE user_id = v_uid;
  DELETE FROM public.tj_note_folders        WHERE user_id = v_uid;
  DELETE FROM public.tj_note_tags           WHERE user_id = v_uid;
  DELETE FROM public.tj_cash_events         WHERE user_id = v_uid;
  DELETE FROM public.tj_accounts            WHERE user_id = v_uid;
  DELETE FROM public.tj_option_items        WHERE user_id = v_uid;
  DELETE FROM public.tj_option_lists        WHERE user_id = v_uid;
  DELETE FROM public.tj_field_defs          WHERE user_id = v_uid;
  DELETE FROM public.tj_instruments         WHERE user_id = v_uid;
  DELETE FROM public.tj_user_prefs          WHERE user_id = v_uid;

  PERFORM public.tj_seed_my_defaults();
END;
$$;

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_reset_my_data() TO authenticated;
