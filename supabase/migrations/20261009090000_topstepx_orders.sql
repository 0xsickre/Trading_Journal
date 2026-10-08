-- O1: TopstepX's orders export in the import (trader, 08.10.2026).
--
-- WHY. The trades export has no stop and no target, so an imported trade had no
-- R. The orders export has the bracket: the target, and the stop — but only its
-- LAST price (the trader's test, 08.10.2026: a stop moved to breakeven leaves one
-- row, at the entry). The import writes that last price here, and into
-- `stop_price` only when it cannot have been moved; `stop-moved.ts` then reads it
-- against the entry and the MAE to say when the original must come from the
-- recording. How the entry was placed is kept beside it.
--
-- Undo: a merge that wrote the stop or these two columns records it in
-- `tj_import_rows.parsed.prev` (`stop_written`, `orders_written`), like
-- `exit_reason_written`, and `tj_undo_import_batch` empties them again — two new
-- optional keys, a call without them works as before.

ALTER TABLE public.tj_positions ADD COLUMN IF NOT EXISTS final_stop_price numeric;
ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_final_stop_price_positive;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_final_stop_price_positive
  CHECK (final_stop_price IS NULL OR final_stop_price > 0);
COMMENT ON COLUMN public.tj_positions.final_stop_price IS
  'TopstepX orders export: the stop order''s LAST price. A moved stop keeps only this one; the original is stop_price.';

ALTER TABLE public.tj_positions ADD COLUMN IF NOT EXISTS entry_order_type text;
ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_entry_order_type_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_entry_order_type_check
  CHECK (entry_order_type IS NULL OR entry_order_type IN ('market', 'limit', 'stop'));
COMMENT ON COLUMN public.tj_positions.entry_order_type IS
  'TopstepX orders export: how the entry was placed — market, limit or stop.';

CREATE OR REPLACE FUNCTION public.tj_undo_import_batch(p_batch_id uuid, p_restore jsonb DEFAULT '[]'::jsonb, p_delete_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  r         record;
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id
    FROM public.tj_import_batches
   WHERE id = p_batch_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Import batch not found.'
      USING ERRCODE = 'no_data_found';
  END IF;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p_restore, '[]'::jsonb)) AS x(
      position_id        uuid,
      executions         jsonb,
      status             text,
      needs_review       boolean,
      restore_override   boolean,
      gross_pnl_override numeric,
      clear_target       boolean,
      clear_excursion    boolean,
      clear_exit_reason  boolean,
      clear_stop         boolean,
      clear_orders       boolean
    )
  LOOP
    DELETE FROM public.tj_executions WHERE position_id = r.position_id;

    INSERT INTO public.tj_executions (
      user_id, position_id, side, price, qty, executed_at, fee, source
    )
    SELECT
      v_user_id, r.position_id, e.side, e.price, e.qty, e.executed_at,
      COALESCE(e.fee, 0), COALESCE(e.source, 'manual')
    FROM jsonb_to_recordset(COALESCE(r.executions, '[]'::jsonb)) AS e(
      side text, price numeric, qty numeric, executed_at timestamptz,
      fee numeric, source text
    )
    WHERE e.side IN ('entry', 'exit')
      AND e.price IS NOT NULL
      AND e.qty > 0
      AND e.executed_at IS NOT NULL;

    UPDATE public.tj_positions
       SET status       = COALESCE(r.status, status),
           needs_review = COALESCE(r.needs_review, needs_review),
           gross_pnl_override = CASE
             WHEN COALESCE(r.restore_override, false) THEN r.gross_pnl_override
             ELSE gross_pnl_override
           END,
           target_price = CASE
             WHEN COALESCE(r.clear_target, false) THEN NULL
             ELSE target_price
           END,
           max_drawdown_price = CASE
             WHEN COALESCE(r.clear_excursion, false) THEN NULL
             ELSE max_drawdown_price
           END,
           max_profit_price = CASE
             WHEN COALESCE(r.clear_excursion, false) THEN NULL
             ELSE max_profit_price
           END,
           excursion_source = CASE
             WHEN COALESCE(r.clear_excursion, false) THEN NULL
             ELSE excursion_source
           END,
           exit_reason = CASE
             WHEN COALESCE(r.clear_exit_reason, false) THEN NULL
             ELSE exit_reason
           END,
           stop_price = CASE
             WHEN COALESCE(r.clear_stop, false) THEN NULL
             ELSE stop_price
           END,
           final_stop_price = CASE
             WHEN COALESCE(r.clear_orders, false) THEN NULL
             ELSE final_stop_price
           END,
           entry_order_type = CASE
             WHEN COALESCE(r.clear_orders, false) THEN NULL
             ELSE entry_order_type
           END
     WHERE id = r.position_id;
  END LOOP;

  IF array_length(p_delete_ids, 1) IS NOT NULL THEN
    DELETE FROM public.tj_positions WHERE id = ANY (p_delete_ids);
  END IF;

  DELETE FROM public.tj_import_batches WHERE id = p_batch_id;
END;
$function$;
