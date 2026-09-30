-- Undo uvoza briše i razlog izlaska koji je uvoz upisao (30.09.2026).
--
-- Trejd upisan kroz Log Trade dok je još trajao nema izlaz, pa ni razlog izlaska.
-- Uvoz koji ga zatvori upisuje razlog (`exitReasonAfterMerge`) i to beleži u
-- `parsed.prev.exit_reason_written`; undo tada vraća prazno, kao za target i MAE/MFE.
-- Novi ključ `clear_exit_reason` je opcion: poziv bez njega radi kao pre.

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
      clear_exit_reason  boolean
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
           END
     WHERE id = r.position_id;
  END LOOP;

  IF array_length(p_delete_ids, 1) IS NOT NULL THEN
    DELETE FROM public.tj_positions WHERE id = ANY (p_delete_ids);
  END IF;

  DELETE FROM public.tj_import_batches WHERE id = p_batch_id;
END;
$function$;
