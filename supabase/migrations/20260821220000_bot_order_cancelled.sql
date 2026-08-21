-- Cancelled pending order -> 'missed'.
--
-- Step 2, deferred at the time and asked for now: a limit deleted in the
-- platform left its trade sitting at 'planned' forever, so the journal's record
-- of what was planned and not taken stayed empty -- which is exactly the record
-- the weekly review is for.
--
-- miss_reason is NOT filled in. cTrader's cancellation reason says HOW the order
-- ended (cancelled, expired); the journal's list asks WHY the trade was not
-- taken. Those are different questions, and only a person can answer the second.
-- The broker's word travels in the event payload, where it is evidence rather
-- than an answer. needs_review is raised instead, so the empty field reads as a
-- prompt.
--
-- A filled trade is refused rather than raised on: tj_position_missed_guard
-- (20260730140000) already blocks 'missed' on a position with fills, and an
-- exception here would abort the tj_bot_events insert with it, hiding the event
-- that explains itself.

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
  v_levels      jsonb;
  v_mae         numeric;
  v_mfe         numeric;
  v_src         text;
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

  SELECT count(*) INTO v_recent
    FROM public.tj_bot_events
   WHERE token_id = v_token.id
     AND received_at > now() - interval '60 seconds';

  IF v_recent > 120 THEN
    RETURN jsonb_build_object('ok', false, 'retryable', true, 'error', 'rate_limited');
  END IF;

  v_kind   := p_event ->> 'kind';
  v_key    := p_event ->> 'event_key';
  v_broker := p_event ->> 'broker';
  v_bacct  := p_event ->> 'broker_account';

  IF v_kind = 'heartbeat' THEN
    UPDATE public.tj_bot_tokens SET last_used_at = now() WHERE id = v_token.id;
    RETURN jsonb_build_object('ok', true, 'result', 'heartbeat');
  END IF;

  IF v_kind IS NULL OR v_key IS NULL OR v_broker IS NULL OR v_bacct IS NULL
     OR v_kind NOT IN ('order_placed', 'order_filled', 'order_modified',
                       'position_modified', 'position_excursion',
                       'order_cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
  END IF;

  -- Each kind names the thing it is about. One rule covering both would have to
  -- accept an event carrying neither.
  IF v_kind IN ('position_modified', 'position_excursion') THEN
    IF NULLIF(p_event ->> 'broker_position_id', '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
    END IF;
  ELSE
    IF NULLIF(p_event ->> 'broker_order_id', '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
    END IF;
  END IF;

  UPDATE public.tj_bot_tokens SET last_used_at = now() WHERE id = v_token.id;

  INSERT INTO public.tj_bot_events
    (user_id, token_id, broker, broker_account, event_key, kind, payload, status)
  VALUES
    (v_uid, v_token.id, v_broker, v_bacct, v_key, v_kind, p_event, 'quarantined')
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'result', 'duplicate');
  END IF;

  SELECT id, currency INTO v_account_id, v_acct_ccy
    FROM public.tj_accounts
   WHERE user_id = v_uid AND broker_account_id = v_bacct;

  IF v_account_id IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'unmapped_account' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unmapped_account');
  END IF;

  -- Target and rungs are read before the branch because both paths need them and
  -- neither needs the symbol to work them out.
  v_target := CASE
                WHEN pg_catalog.jsonb_typeof(p_event -> 'take_profit_final') = 'number'
                  THEN (p_event ->> 'take_profit_final')::numeric
                WHEN pg_catalog.jsonb_typeof(p_event -> 'take_profit') = 'number'
                  THEN (p_event ->> 'take_profit')::numeric
              END;

  IF v_target IS NOT NULL AND v_target <= 0 THEN v_target := NULL; END IF;

  v_levels := NULL;
  IF pg_catalog.jsonb_typeof(p_event -> 'take_profit_levels') = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object('pct',   (x ->> 'pct')::numeric,
                                        'price', (x ->> 'price')::numeric)
                     ORDER BY (x ->> 'price')::numeric)
      INTO v_levels
      FROM pg_catalog.jsonb_array_elements(p_event -> 'take_profit_levels') AS x
     WHERE pg_catalog.jsonb_typeof(x -> 'price') = 'number'
       AND pg_catalog.jsonb_typeof(x -> 'pct') = 'number'
       AND (x ->> 'price')::numeric > 0
       AND (x ->> 'pct')::numeric > 0;
  END IF;

  -- position_modified: take profit only. See the header for why the stop is not
  -- here, and why that is the substance of this branch rather than an omission.
  IF v_kind = 'position_modified' THEN
    SELECT * INTO v_pos
      FROM public.tj_positions
     WHERE user_id = v_uid AND broker = v_broker AND broker_account = v_bacct
       AND broker_position_id = p_event ->> 'broker_position_id';

    IF v_pos.id IS NULL THEN
      UPDATE public.tj_bot_events SET reason = 'unknown_position' WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unknown_position');
    END IF;

    IF v_pos.status NOT IN ('open', 'partial') THEN
      UPDATE public.tj_bot_events
         SET reason = 'not_open', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                                'reason', 'not_open', 'position_id', v_pos.id);
    END IF;

    -- stop_price is absent from this statement on purpose. It is the risk that
    -- was taken at the fill, and nothing after the fill may move it.
    UPDATE public.tj_positions
       SET target_price     = COALESCE(v_target, target_price),
           scale_out_levels = COALESCE(v_levels, scale_out_levels)
     WHERE id = v_pos.id;

    UPDATE public.tj_bot_events
       SET status = 'applied', position_id = v_pos.id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'result', 'target_moved', 'position_id', v_pos.id);
  END IF;

  -- position_excursion: how far price ran against the trade and how far for it.
  IF v_kind = 'position_excursion' THEN
    SELECT * INTO v_pos
      FROM public.tj_positions
     WHERE user_id = v_uid AND broker = v_broker AND broker_account = v_bacct
       AND broker_position_id = p_event ->> 'broker_position_id';

    IF v_pos.id IS NULL THEN
      UPDATE public.tj_bot_events SET reason = 'unknown_position' WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unknown_position');
    END IF;

    -- A trade that never filled has no excursion to have. Closed is fine and is
    -- in fact the normal case: the final, exact pair arrives with the close.
    IF v_pos.status IN ('planned', 'missed') THEN
      UPDATE public.tj_bot_events
         SET reason = 'not_open', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                                'reason', 'not_open', 'position_id', v_pos.id);
    END IF;

    v_mae := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'mae_price') = 'number'
                  THEN (p_event ->> 'mae_price')::numeric END;
    v_mfe := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'mfe_price') = 'number'
                  THEN (p_event ->> 'mfe_price')::numeric END;

    IF v_mae IS NOT NULL AND v_mae <= 0 THEN v_mae := NULL; END IF;
    IF v_mfe IS NOT NULL AND v_mfe <= 0 THEN v_mfe := NULL; END IF;

    IF v_mae IS NULL AND v_mfe IS NULL THEN
      UPDATE public.tj_bot_events
         SET reason = 'malformed_excursion', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                                'reason', 'malformed_excursion', 'position_id', v_pos.id);
    END IF;

    -- The flag is raised for exactly one statement and lowered again.
    --
    -- It was first set once at the top of this function, which was wrong in a way
    -- a test caught: `is_local` scopes a GUC to the TRANSACTION, not to the
    -- function call, so it stayed raised for everything that followed. Today one
    -- RPC is one transaction and nothing else runs inside it -- but that is
    -- PostgREST's behaviour, not this function's promise, and correctness should
    -- not rest on a caller's transaction boundaries. Narrow is provable.
    PERFORM pg_catalog.set_config('tj.bot_write', '1', true);

    UPDATE public.tj_positions
       SET max_drawdown_price = COALESCE(v_mae, max_drawdown_price),
           max_profit_price   = COALESCE(v_mfe, max_profit_price)
     WHERE id = v_pos.id;

    PERFORM pg_catalog.set_config('tj.bot_write', '', true);

    -- Read back what the guard decided. When a person owns these numbers the
    -- update above was silently reverted, and the log should say so rather than
    -- report a success that changed nothing.
    SELECT excursion_source INTO v_src FROM public.tj_positions WHERE id = v_pos.id;

    UPDATE public.tj_bot_events
       SET status = 'applied',
           reason = CASE WHEN v_src = 'manual' THEN 'manual_kept' END,
           position_id = v_pos.id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true,
                              'result', CASE WHEN v_src = 'manual' THEN 'manual_kept' ELSE 'excursion' END,
                              'position_id', v_pos.id);
  END IF;

  -- order_cancelled: the order went away without filling. Planned, not taken.
  IF v_kind = 'order_cancelled' THEN
    SELECT * INTO v_pos
      FROM public.tj_positions
     WHERE user_id = v_uid AND broker = v_broker AND broker_account = v_bacct
       AND broker_order_id = p_event ->> 'broker_order_id';

    IF v_pos.id IS NULL THEN
      UPDATE public.tj_bot_events SET reason = 'unknown_order' WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'unknown_order');
    END IF;

    IF v_pos.status = 'missed' THEN
      UPDATE public.tj_bot_events
         SET status = 'applied', reason = 'already_missed', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'already_missed', 'position_id', v_pos.id);
    END IF;

    -- A trade that filled cannot be missed, and tj_position_missed_guard would
    -- refuse it anyway. Quarantining here says so with a reason instead of
    -- raising an exception that would take the event row down with it.
    IF v_pos.status <> 'planned' THEN
      UPDATE public.tj_bot_events
         SET reason = 'not_pending', position_id = v_pos.id
       WHERE id = v_event_id;
      RETURN jsonb_build_object('ok', true, 'result', 'quarantined',
                                'reason', 'not_pending', 'position_id', v_pos.id);
    END IF;

    -- miss_reason is left NULL ON PURPOSE. The broker's reason says HOW the
    -- order ended; the journal's list asks WHY the trade was not taken
    -- ("Setup invalidated", "Price ran away", "Discretion"). Only a person knows
    -- the second, and filling it from the first would put an answer nobody gave
    -- into a field the weekly review reads as judgement. needs_review is raised
    -- so the blank is a prompt rather than a hole.
    UPDATE public.tj_positions
       SET status       = 'missed',
           missed_at    = now(),
           needs_review = true
     WHERE id = v_pos.id;

    UPDATE public.tj_bot_events
       SET status = 'applied', position_id = v_pos.id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'result', 'missed', 'position_id', v_pos.id);
  END IF;

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

  v_direction := CASE lower(COALESCE(p_event ->> 'trade_type', ''))
                   WHEN 'buy'  THEN 'Long'
                   WHEN 'sell' THEN 'Short'
                   ELSE NULL
                 END;

  IF v_direction IS NULL THEN
    UPDATE public.tj_bot_events SET reason = 'malformed_direction' WHERE id = v_event_id;
    RETURN jsonb_build_object('ok', true, 'result', 'quarantined', 'reason', 'malformed_direction');
  END IF;

  v_qty   := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'volume_in_units') = 'number'
                  THEN (p_event ->> 'volume_in_units')::numeric END;
  v_entry := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'target_price') = 'number'
                  THEN (p_event ->> 'target_price')::numeric END;
  v_stop  := CASE WHEN pg_catalog.jsonb_typeof(p_event -> 'stop_loss') = 'number'
                  THEN (p_event ->> 'stop_loss')::numeric END;

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

  SELECT i.point_value, i.tick_size, i.quote_currency
    INTO v_pv, v_ts, v_ccy
    FROM public.tj_instruments i
   WHERE i.user_id = v_uid AND i.symbol = v_instrument;

  v_fx := CASE WHEN v_ccy IS NOT NULL AND v_ccy = v_acct_ccy THEN 1 ELSE NULL END;

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
      entry_price, stop_price, target_price, position_size, scale_out_levels,
      point_value_at_trade, tick_size_at_trade, quote_currency_at_trade, fx_rate_at_trade,
      broker, broker_account, broker_order_id
    ) VALUES (
      v_uid, v_account_id, v_status, 'bot', true,
      v_instrument, v_direction,
      v_entry, v_stop, v_target,
      v_qty, COALESCE(v_levels, '[]'::jsonb),
      v_pv, v_ts, v_ccy, v_fx,
      v_broker, v_bacct, p_event ->> 'broker_order_id'
    )
    RETURNING id INTO v_pos_id;

    UPDATE public.tj_bot_events
       SET status = 'applied', position_id = v_pos_id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'result', 'created', 'position_id', v_pos_id);
  END IF;

  IF v_kind = 'order_modified' THEN
    IF v_pos.id IS NULL THEN
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

    UPDATE public.tj_positions
       SET entry_price      = v_entry,
           stop_price       = COALESCE(v_stop, stop_price),
           target_price     = COALESCE(v_target, target_price),
           position_size    = v_qty,
           scale_out_levels = COALESCE(v_levels, scale_out_levels)
     WHERE id = v_pos.id;

    UPDATE public.tj_bot_events
       SET status = 'applied', position_id = v_pos.id
     WHERE id = v_event_id;

    RETURN jsonb_build_object('ok', true, 'result', 'modified', 'position_id', v_pos.id);
  END IF;

  -- order_filled
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
      entry_price, stop_price, target_price, position_size, scale_out_levels,
      point_value_at_trade, tick_size_at_trade, quote_currency_at_trade, fx_rate_at_trade,
      broker, broker_account, broker_order_id, broker_position_id
    ) VALUES (
      v_uid, v_account_id, 'open', 'bot', true,
      v_instrument, v_direction,
      v_entry, v_stop, v_target,
      v_qty, COALESCE(v_levels, '[]'::jsonb),
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

    -- The fill is the last moment the order was pending, so this is the last
    -- write that may touch stop_price. Everything after it is trade management.
    UPDATE public.tj_positions
       SET status             = 'open',
           entry_price        = v_entry,
           stop_price         = COALESCE(v_stop, stop_price),
           target_price       = COALESCE(v_target, target_price),
           scale_out_levels   = COALESCE(v_levels, scale_out_levels),
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
