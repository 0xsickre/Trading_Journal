-- Slike trejda kao lista, bez tri fiksna slota (30.09.2026, trejder: „jedan plus, koliko hoću“).
--
-- Bilo je: najviše jedna slika po (trejd, kind) za kind ∈ htf_pre / ltf_pre / ltf_post
-- (jedinstveni indeks), i forme sa tri polja. Sada: koliko god slika, redom kojim su dodate.
--   * `sort_order` čuva redosled;
--   * novi `kind` = 'chart' (lista); stare vrednosti ostaju dozvoljene, pa se nijedan red ne menja;
--   * jedinstveni indeks (position_id, kind) se briše;
--   * `tj_save_trade` upisuje slike redom (WITH ORDINALITY);
--   * `tj_merge_positions` prenosi SVE slike iz spojenog trejda, posle slika onog koji ostaje.
-- Na dan migracije u tabeli nema nijedne slike.

ALTER TABLE public.tj_trade_images ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS public.tj_trade_images_position_kind_uidx;

ALTER TABLE public.tj_trade_images DROP CONSTRAINT IF EXISTS tj_trade_images_kind_check;
ALTER TABLE public.tj_trade_images ADD CONSTRAINT tj_trade_images_kind_check
  CHECK (kind = ANY (ARRAY['chart'::text, 'htf_pre'::text, 'ltf_pre'::text, 'ltf_post'::text]));
ALTER TABLE public.tj_trade_images ALTER COLUMN kind SET DEFAULT 'chart';

CREATE OR REPLACE FUNCTION public.tj_save_trade(p_id uuid DEFAULT NULL::uuid, p_position jsonb DEFAULT '{}'::jsonb, p_executions jsonb DEFAULT '[]'::jsonb, p_rules jsonb DEFAULT '[]'::jsonb, p_images jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_id      uuid;
  v_user_id uuid;
  v_cols    text;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.tj_positions (user_id, account_id, trade_no, status, source)
    VALUES (
      auth.uid(),
      NULLIF(p_position->>'account_id', '')::uuid,
      NULLIF(p_position->>'trade_no', '')::int,
      COALESCE(p_position->>'status', 'planned'),
      COALESCE(p_position->>'source', 'manual')
    )
    RETURNING id, user_id INTO v_id, v_user_id;
  ELSE
    SELECT id, user_id INTO v_id, v_user_id
      FROM public.tj_positions
     WHERE id = p_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Trade not found'
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name   = 'tj_positions'
     AND c.column_name IN (SELECT jsonb_object_keys(p_position))
     AND c.column_name NOT IN ('id', 'user_id', 'created_at', 'import_batch_id')
     AND NOT (c.column_name = 'trade_no' AND p_position->'trade_no' = 'null'::jsonb);

  IF v_cols IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.tj_positions SET (%s) = '
      '(SELECT %s FROM jsonb_populate_record(NULL::public.tj_positions, $1)) '
      'WHERE id = $2',
      v_cols, v_cols
    ) USING p_position, v_id;
  END IF;

  DELETE FROM public.tj_executions WHERE position_id = v_id;

  INSERT INTO public.tj_executions (
    user_id, position_id, side, price, qty, executed_at, fee, source
  )
  SELECT
    v_user_id, v_id, e.side, e.price, e.qty, e.executed_at,
    COALESCE(e.fee, 0), COALESCE(e.source, 'manual')
  FROM jsonb_to_recordset(COALESCE(p_executions, '[]'::jsonb)) AS e(
    side text, price numeric, qty numeric, executed_at timestamptz,
    fee numeric, source text
  )
  WHERE e.side IN ('entry', 'exit')
    AND e.price IS NOT NULL
    AND e.qty > 0
    AND e.executed_at IS NOT NULL;

  DELETE FROM public.tj_position_rules WHERE position_id = v_id;

  INSERT INTO public.tj_position_rules (user_id, position_id, rule_id, followed)
  SELECT v_user_id, v_id, r.rule_id, r.followed
  FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS r(
    rule_id uuid, followed boolean
  )
  WHERE r.rule_id IS NOT NULL
    AND r.followed IS NOT NULL;

  -- Images, in the order they were given: a new trade's list.
  IF p_id IS NULL AND jsonb_array_length(COALESCE(p_images, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.tj_trade_images (user_id, position_id, kind, image_url, sort_order)
    SELECT v_user_id, v_id, COALESCE(i.value->>'kind', 'chart'), i.value->>'image_url', (i.ord - 1)::int
    FROM jsonb_array_elements(p_images) WITH ORDINALITY AS i(value, ord)
    WHERE i.value->>'image_url' IS NOT NULL;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tj_merge_positions(p_keep uuid, p_fills_from uuid)
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

  DELETE FROM public.tj_executions WHERE position_id = p_keep;
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

  DELETE FROM public.tj_positions WHERE id = p_fills_from;
END;
$function$;
