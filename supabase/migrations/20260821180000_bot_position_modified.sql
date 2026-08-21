-- Bot bridge: follow the take profit after the fill, and NEVER the stop.
--
-- THE RULE, in the owner's words: once a trade is active the stop must stop
-- moving in the journal, while the take profit may still follow.
--
-- WHY THE STOP IS FROZEN. Before the fill, moving a stop changes the plan --
-- the trade has not started and the risk about to be taken is now different.
-- After the fill the identical action means something else entirely: pulling to
-- breakeven does not mean nothing was risked, it means you stopped risking what
-- was already committed. `stop_price` is the denominator of R, so if a breakeven
-- pull reached it, R would divide by something approaching zero on exactly the
-- trades that were managed best. Expectancy, target attainment, MAE/MFE in R,
-- planned-vs-realized and every Sickre Score component built on R would then
-- reward moving stops -- silently, and in the direction that flatters. The stop
-- at the moment of the fill is the risk that was actually taken, and that is the
-- number the journal keeps.
--
-- WHY THE TAKE PROFIT IS NOT. Moving it says where the trade is now meant to
-- END. That is still a statement about the plan and nothing in R depends on it,
-- so it is carried, along with the partial rungs behind it.
--
-- The bot leaves the stop out of the position fingerprint as well, so a
-- breakeven pull sends no event at all rather than one this function has to
-- decide to discard. It does send `stop_loss_not_applied` on events it raises
-- for other reasons: the log is allowed to record what the stop was, because
-- keeping a fact and acting on it are different things.
--
-- CORRELATED BY POSITION ID. A position knows nothing about the pending order
-- it came from -- cTrader numbers them separately and carries no link -- which
-- is why `broker_position_id` is written at the fill. Consequently
-- `broker_order_id` is required for the order_* kinds and `broker_position_id`
-- for this one, rather than one rule pretending to cover both.
--
-- Only 'open' and 'partial' are accepted. A closed trade is finished, and a
-- planned one has no position to modify.

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
     OR v_kind NOT IN ('order_placed', 'order_filled', 'order_modified', 'position_modified') THEN
    RETURN jsonb_build_object('ok', false, 'retryable', false, 'error', 'malformed');
  END IF;

  -- Each kind names the thing it is about. One rule covering both would have to
  -- accept an event carrying neither.
  IF v_kind = 'position_modified' THEN
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
