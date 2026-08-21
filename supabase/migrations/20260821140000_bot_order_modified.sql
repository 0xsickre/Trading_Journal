-- Bot bridge, step 1b: carry a CHANGE to a pending order, not just its birth.
--
-- WHAT WAS MISSING. 20260821120000 recorded an order once, at placement. The
-- owner placed a limit and attached SL and TP a minute later, in the platform.
-- The journal kept the first version: stop_price and target_price NULL. Every
-- R-derived number -- planned R:R, expectancy, target attainment, the Sickre
-- Score components built on R -- silently skipped that trade, because R needs a
-- stop and there was none. Not a wrong number; an absent one, which the journal
-- reports honestly as "-". Still worth fixing: the stop existed, we just never
-- asked again.
--
-- ONLY WHILE PENDING, AND THIS IS THE WHOLE POINT.
--
-- `order_modified` refuses any position that is not still 'planned'. That is not
-- caution, it is the difference between two things that look identical in the
-- API and are opposites in a journal:
--
--   Before the fill, moving the stop CHANGES THE PLAN. The trade has not
--   started; the risk you are about to take is now different. stop_price must
--   follow, or planned R:R describes an order you never placed.
--
--   After the fill, moving the stop IS TRADE MANAGEMENT. Pulling to breakeven
--   does not mean you risked nothing -- it means you stopped risking what you
--   had already committed. If that flowed into stop_price, R would collapse
--   toward zero or infinity on exactly the trades that were managed best, and
--   every R metric in the book would quietly reward moving stops.
--
-- src/lib/journal/excursion.ts already states the journal's R convention: one R
-- is the PLANNED risk distance. This function is where a machine could most
-- easily break it, so the refusal is explicit rather than assumed. A pending
-- order cannot be modified after it fills anyway -- cTrader would reject it --
-- so the branch should be unreachable. It is written down because "should be
-- unreachable" is how the reachable ones start.
--
-- IDEMPOTENCY. The bot fingerprints the mutable fields and puts that
-- fingerprint in event_key, so one edit is one event forever: resending the
-- same values is a duplicate and costs nothing, while a second, different edit
-- is a new key and applies. UNIQUE (user_id, event_key) from 20260821120000
-- still does the enforcing; the bot only decides what to call each change.
--
-- BOT WINS ON FOUR FIELDS, by the owner's explicit decision, WITH ONE LIMIT.
-- entry_price, stop_price, target_price and position_size are what the broker
-- holds, and a human's memory of them is not evidence. But a null stop or
-- target is not a value the bot is reporting -- it is the bot having nothing to
-- report -- so those two are COALESCEd rather than assigned. The full reasoning
-- sits on the UPDATE itself. Nothing subjective is touched at all: thesis,
-- conviction, playbook, tags, notes and grade survive every event, because the
-- bot never knew them.
--
-- NOT COVERED, MEASURED FIRST: multiple take-profit levels. cTrader's advanced
-- protection allows up to five TP levels on one order, each closing a portion.
-- PendingOrder.TakeProfit in the Algo API is a single double?, and no array of
-- levels is documented, so which of the five it reports -- first, last, or
-- nothing -- is not knowable from here. The bot logs what the API returns for
-- such an order; the shape gets built once that log exists. tj_positions
-- already has scale_out_levels ([{"pct","price"}], 20260819160000) waiting for
-- it, so the destination is not in question, only the source.
--
-- APPLY BEFORE DEPLOYING THE BOT. An unknown `kind` is refused as non-retryable
-- and the bot files it in rejected.jsonl instead of retrying, so a bot that
-- runs first loses those edits.

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
  v_force_review boolean := false;
  v_reason      text;
BEGIN
  -- 7.1 Authenticate
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_token
    FROM public.tj_bot_tokens
   WHERE token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
     AND revoked_at IS NULL;

  IF v_token.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'unauthorized');
  END IF;

  v_uid := v_token.user_id;

  -- 7.2 Rate limit
  SELECT count(*) INTO v_recent
    FROM public.tj_bot_events
   WHERE token_id = v_token.id
     AND received_at > now() - interval '60 seconds';

  IF v_recent > 120 THEN
    RETURN jsonb_build_object('ok', false, 'retryable', true, 'error', 'rate_limited');
  END IF;

  -- 7.3 Envelope
  v_kind   := p_event ->> 'kind';
  v_key    := p_event ->> 'event_key';
  v_broker := p_event ->> 'broker';
  v_bacct  := p_event ->> 'broker_account';

  IF v_kind = 'heartbeat' THEN
    UPDATE public.tj_bot_tokens SET last_used_at = now() WHERE id = v_token.id;
    RETURN jsonb_build_object('ok', true, 'result', 'heartbeat');
  END IF;

  IF v_kind IS NULL OR v_key IS NULL OR v_broker IS NULL OR v_bacct IS NULL
     OR v_kind NOT IN ('order_placed', 'order_filled', 'order_modified') THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
  END IF;

  IF NULLIF(p_event ->> 'broker_order_id', '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
  END IF;

  UPDATE public.tj_bot_tokens SET last_used_at = now() WHERE id = v_token.id;

  -- 7.4 Idempotency boundary
  INSERT INTO public.tj_bot_events
    (user_id, token_id, broker, broker_account, event_key, kind, payload, status)
  VALUES
    (v_uid, v_token.id, v_broker, v_bacct, v_key, v_kind, p_event, 'quarantined')
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate');
  END IF;

  -- 7.5 Resolve account
  SELECT id, currency INTO v_account_id, v_acct_ccy
    FROM public.tj_accounts
   WHERE user_id = v_uid AND broker_account_id = v_bacct;

  IF v_account_id IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'unmapped_account' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unmapped_account');
  END IF;

  -- 7.6 Resolve symbol and the volume divisor
  v_sym_raw   := p_event ->> 'symbol';
  v_sym_clean := pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(v_sym_raw, ''), '[^A-Za-z0-9]', '', 'g'));

  IF v_sym_clean = '' THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_symbol' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_symbol');
  END IF;

  SELECT m.instrument, m.units_per_qty INTO v_instrument, v_units
    FROM public.tj_broker_symbol_map m
   WHERE m.user_id = v_uid AND m.broker = v_broker AND m.broker_symbol = v_sym_clean;

  IF v_instrument IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'unmapped_symbol' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unmapped_symbol');
  END IF;

  -- 7.7 Direction and quantity
  v_direction := CASE lower(COALESCE(p_event ->> 'trade_type', ''))
                   WHEN 'buy'  THEN 'Long'
                   WHEN 'sell' THEN 'Short'
                   ELSE NULL
                 END;

  IF v_direction IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_direction' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_direction');
  END IF;

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

  IF v_entry IS NULL OR v_entry <= 0 THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_price' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_price');
  END IF;

  IF v_stop IS NOT NULL AND v_stop <= 0 THEN v_stop := NULL; END IF;
  IF v_target IS NOT NULL AND v_target <= 0 THEN v_target := NULL; END IF;

  -- 7.8 Freeze the contract spec
  SELECT i.point_value, i.tick_size, i.quote_currency
    INTO v_pv, v_ts, v_ccy
    FROM public.tj_instruments i
   WHERE i.user_id = v_uid AND i.symbol = v_instrument;

  v_fx := CASE WHEN v_ccy IS NOT NULL AND v_ccy = v_acct_ccy THEN 1 ELSE NULL END;

  -- 7.9 Apply
  SELECT * INTO v_pos
    FROM public.tj_positions
   WHERE user_id = v_uid AND broker = v_broker AND broker_account = v_bacct
     AND broker_order_id = p_event ->> 'broker_order_id';

  IF v_kind = 'order_placed' THEN
    IF v_pos.id IS NOT NULL THEN
      UPDATE public.tj_bot_events
         SET status = 'applied', reason = 'already_present', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'already_present',
                                'position_id', v_pos.id);
    END IF;

    v_status := 'planned';

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

  -- order_modified -------------------------------------------------------------
  -- The plan changed while the order was still waiting. See the header for why
  -- this is refused the moment the order is no longer pending.
  IF v_kind = 'order_modified' THEN
    IF v_pos.id IS NULL THEN
      -- Reconcile sends a placement before any edit, so this needs the bot to
      -- have seen an edit for an order it never reported. Recorded, not guessed
      -- into existence from an edit payload.
      UPDATE public.tj_bot_events SET reason = 'unknown_order' WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unknown_order');
    END IF;

    IF v_pos.status <> 'planned' THEN
      UPDATE public.tj_bot_events
         SET reason = 'not_pending', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                                'reason', 'not_pending', 'position_id', v_pos.id);
    END IF;

    -- The broker's values win -- but COALESCE, not assignment, and the
    -- difference matters more than it looks.
    --
    -- entry_price and position_size are always present on a pending order, so
    -- they are asserted outright. stop_loss and take_profit are not: cTrader
    -- reports "no protection attached" as null, and null here means THE BOT HAS
    -- NOTHING TO SAY, not "the stop is nothing". Assigning it would erase a stop
    -- the owner typed into the journal by hand -- which is the likely case
    -- precisely when the platform has none, since that is when a person fills it
    -- in themselves. Same rule the README states for statistics: null is not
    -- zero, and absence of evidence is not evidence of absence.
    --
    -- THE PRICE OF THIS, admitted rather than hidden: DELETING protection in the
    -- platform does not clear it here. That direction has to be undone by hand.
    -- Accepted knowingly -- a stale stop is visible on the trade and one edit
    -- away, while a silently erased one is noticed only when some R metric has
    -- already been wrong for a month.
    UPDATE public.tj_positions
       SET entry_price   = v_entry,
           stop_price    = COALESCE(v_stop, stop_price),
           target_price  = COALESCE(v_target, target_price),
           position_size = v_qty
     WHERE id = v_pos.id;

    UPDATE public.tj_bot_events
       SET status = 'applied', position_id = v_pos.id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'result', 'modified', 'position_id', v_pos.id);
  END IF;

  -- order_filled ---------------------------------------------------------------
  v_fill_price := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'fill_price') = 'number'
                       THEN (p_event ->> 'fill_price')::numeric END;

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
      v_reason := 'was_missed';
      v_force_review := true;
    END IF;

    -- The fill is the last moment the order was still pending, so it is also the
    -- last chance to catch protection attached after the final edit the bot saw
    -- -- or every edit, if the Modified events never arrived. Same COALESCE rule
    -- and the same reason as the order_modified branch above.
    UPDATE public.tj_positions
       SET status             = 'open',
           entry_price        = v_entry,
           stop_price         = COALESCE(v_stop, stop_price),
           target_price       = COALESCE(v_target, target_price),
           broker_position_id = COALESCE(p_event ->> 'broker_position_id', broker_position_id),
           needs_review       = CASE WHEN v_force_review THEN true ELSE needs_review END
     WHERE id = v_pos_id;
  END IF;

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

REVOKE ALL ON FUNCTION public.tj_bot_ingest(text, jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.tj_bot_ingest(text, jsonb) TO anon;
