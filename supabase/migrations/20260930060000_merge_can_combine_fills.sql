-- Spajanje trejdova može da SABERE fill-ove (30.09.2026).
--
-- Merge je bio za jedan slučaj: isti trejd upisan dvaput (ručno + uvoz), pa fill-ovi
-- jednog ZAMENE fill-ove drugog. Trejder je otvorio dve pozicije u istom trenutku
-- (TopstepX: 2 + 2 MNQ, dva reda izvoza) kao jedan trejd — spajanje je ostavilo 2
-- ugovora umesto 4. Novi parametar `p_combine`: fill-ovi oba ostaju na trejdu koji
-- ostaje, a status, veličina i ručno upisan rezultat se računaju iz zbira.
-- Podrazumevano `false`: poziv sa dva argumenta radi kao pre.

DROP FUNCTION IF EXISTS public.tj_merge_positions(uuid, uuid);

CREATE OR REPLACE FUNCTION public.tj_merge_positions(p_keep uuid, p_fills_from uuid, p_combine boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_keep  record;
  v_other record;
  v_next  integer;
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

  -- The same trade twice: the other side's fills replace these. Two positions of
  -- one trade: both sets stay.
  IF NOT p_combine THEN
    DELETE FROM public.tj_executions WHERE position_id = p_keep;
  END IF;
  UPDATE public.tj_executions SET position_id = p_keep WHERE position_id = p_fills_from;

  -- Every picture of both, the kept trade's first: a list has no slot to collide in.
  SELECT COALESCE(max(sort_order) + 1, 0) INTO v_next
    FROM public.tj_trade_images WHERE position_id = p_keep;
  UPDATE public.tj_trade_images
     SET position_id = p_keep,
         sort_order  = sort_order + v_next
   WHERE position_id = p_fills_from;

  UPDATE public.tj_position_rules r
     SET position_id = p_keep
   WHERE r.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_rules k
        WHERE k.position_id = p_keep AND k.rule_id = r.rule_id
     );

  UPDATE public.tj_notes       SET position_id = p_keep WHERE position_id = p_fills_from;
  UPDATE public.tj_import_rows SET matched_position_id = p_keep WHERE matched_position_id = p_fills_from;

  UPDATE public.tj_positions k SET
    status                  = v_other.status,
    needs_review            = v_other.needs_review,
    gross_pnl_override      = v_other.gross_pnl_override,
    point_value_at_trade    = COALESCE(v_other.point_value_at_trade, k.point_value_at_trade),
    tick_size_at_trade      = COALESCE(v_other.tick_size_at_trade, k.tick_size_at_trade),
    quote_currency_at_trade = COALESCE(v_other.quote_currency_at_trade, k.quote_currency_at_trade),
    fx_rate_at_trade        = COALESCE(v_other.fx_rate_at_trade, k.fx_rate_at_trade),

    entry_price         = COALESCE(k.entry_price, v_other.entry_price),
    stop_price          = COALESCE(k.stop_price, v_other.stop_price),
    target_price        = COALESCE(k.target_price, v_other.target_price),
    planned_rr          = COALESCE(k.planned_rr, v_other.planned_rr),
    position_size       = COALESCE(k.position_size, v_other.position_size),
    execution_rating    = COALESCE(k.execution_rating, v_other.execution_rating),
    exit_reason         = COALESCE(k.exit_reason, v_other.exit_reason),
    thesis              = COALESCE(k.thesis, v_other.thesis),
    invalidation        = COALESCE(k.invalidation, v_other.invalidation),
    time_stop           = COALESCE(k.time_stop, v_other.time_stop),
    scale_out_plan      = COALESCE(k.scale_out_plan, v_other.scale_out_plan),
    trade_journal_notes = COALESCE(k.trade_journal_notes, v_other.trade_journal_notes),
    playbook_id         = COALESCE(k.playbook_id, v_other.playbook_id),
    miss_reason         = COALESCE(k.miss_reason, v_other.miss_reason),
    missed_at           = COALESCE(k.missed_at, v_other.missed_at),
    max_drawdown_price  = COALESCE(k.max_drawdown_price, v_other.max_drawdown_price),
    max_profit_price    = COALESCE(k.max_profit_price, v_other.max_profit_price),
    equity_at_entry     = COALESCE(k.equity_at_entry, v_other.equity_at_entry),

    plan_snapshot       = k.plan_snapshot,
    plan_sealed_at      = k.plan_sealed_at,
    plan_amended_at     = k.plan_amended_at,

    mistake = ARRAY(
      SELECT DISTINCT t FROM unnest(k.mistake || v_other.mistake) AS t WHERE t <> ''
    ),
    technical_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.technical_tags || v_other.technical_tags) AS t WHERE t <> ''
    ),
    psychology_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.psychology_tags || v_other.psychology_tags) AS t WHERE t <> ''
    ),

    custom = v_other.custom || k.custom,
    scale_out_levels = CASE
      WHEN jsonb_array_length(COALESCE(k.scale_out_levels, '[]'::jsonb)) > 0
        THEN k.scale_out_levels
      ELSE COALESCE(v_other.scale_out_levels, '[]'::jsonb)
    END,
    updated_at = now()
  WHERE k.id = p_keep;

  -- Combined, the trade is the sum of both: its status from all the fills (as
  -- computeStatus), its size and a typed-in result added — a result on one side
  -- only no longer describes the fills, so it goes and the fills price the trade.
  IF p_combine THEN
    UPDATE public.tj_positions k SET
      status = (
        SELECT CASE
          WHEN COALESCE(sum(qty) FILTER (WHERE side = 'exit'), 0) <= 0 THEN 'open'
          WHEN sum(qty) FILTER (WHERE side = 'exit') < COALESCE(sum(qty) FILTER (WHERE side = 'entry'), 0) THEN 'partial'
          ELSE 'closed'
        END
        FROM public.tj_executions WHERE position_id = p_keep
      ),
      needs_review = v_keep.needs_review OR v_other.needs_review,
      gross_pnl_override = CASE
        WHEN v_keep.gross_pnl_override IS NOT NULL AND v_other.gross_pnl_override IS NOT NULL
          THEN v_keep.gross_pnl_override + v_other.gross_pnl_override
        ELSE NULL
      END,
      position_size = CASE
        WHEN v_keep.position_size IS NOT NULL AND v_other.position_size IS NOT NULL
          THEN v_keep.position_size + v_other.position_size
        ELSE k.position_size
      END
    WHERE k.id = p_keep;
  END IF;

  DELETE FROM public.tj_positions WHERE id = p_fills_from;
END;
$function$;

-- DROP + CREATE resets the grants: the same as tj_save_trade — signed-in users only.
REVOKE EXECUTE ON FUNCTION public.tj_merge_positions(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_merge_positions(uuid, uuid, boolean) TO authenticated;
