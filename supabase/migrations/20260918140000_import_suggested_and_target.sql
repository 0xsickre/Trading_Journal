-- An import can now recognise a trade that was typed by hand, and can fill in a
-- target the trade never had. Two columns' worth of consequence, and one of
-- them is an undo that has to be able to take the target back.
--
-- 1) `match_status = 'suggested'`
--
-- The audit row records HOW a row was matched, and that vocabulary is a CHECK.
-- The new answer is "everything agreed except the time" — a trade typed while
-- reading a backtest carries the moment it was typed, the file carries the
-- moment it was traded, and `import-match.ts` matches the two on prices, size
-- and money instead. Without this the audit insert fails and the row reports as
-- a failure after its fills have already been written.
--
-- 2) `target_written`
--
-- A merge may fill in `target_price` when the trade has none. Undo has to empty
-- it again, and "empty it if it is set" would erase a target the trader typed
-- themselves in the meantime. So the import records whether IT was the one that
-- wrote, exactly as `prev_gross_pnl_override` records what it displaced.
--
-- A boolean rather than a `prev_target_price`: the import only ever writes into
-- an empty one, so the previous value is NULL whenever this flag is true, and a
-- column that can only hold one value is a column that will eventually hold
-- something else by accident.
--
-- There is deliberately no stop loss anywhere in this: a statement states the
-- levels as they stood AT THE END, and a stop moved to breakeven mid-trade would
-- overwrite the stop the risk was actually taken with — every R on that trade
-- recomputed against a stop nobody ever risked.

ALTER TABLE public.tj_import_rows
  ADD COLUMN IF NOT EXISTS target_written boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tj_import_rows.target_written IS
  'True when this import row filled in a target the position did not have. Undo '
  'sets that target back to NULL; a target the trader typed is never touched.';

ALTER TABLE public.tj_import_rows DROP CONSTRAINT IF EXISTS tj_import_rows_match_status_check;
ALTER TABLE public.tj_import_rows ADD CONSTRAINT tj_import_rows_match_status_check
  CHECK (match_status = ANY (ARRAY[
    'new'::text, 'match'::text, 'suggested'::text, 'ambiguous'::text, 'duplicate'::text]));

-- 3) Undo learns one more field ------------------------------------------------
--
-- Restated whole rather than patched: the function is the record of what an undo
-- restores, and a reader must be able to read that in one piece. Only the
-- `clear_target` field and its UPDATE are new; every other line is
-- 20260816140000 unchanged.

CREATE OR REPLACE FUNCTION public.tj_undo_import_batch(
  p_batch_id   uuid,
  p_restore    jsonb DEFAULT '[]'::jsonb,
  p_delete_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
DECLARE
  r         record;
  v_user_id uuid;
BEGIN
  -- RLS važi (SECURITY INVOKER): batch koji pozivalac ne vidi je nerazlučiv od
  -- nepostojećeg, i oba su odbijanje.
  SELECT user_id INTO v_user_id
    FROM public.tj_import_batches
   WHERE id = p_batch_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Import batch not found.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Vraćanje fill-ova koje je spajanje potisnulo. `source` se nosi nazad kroz
  -- payload: snimak ga sadrži, a poništavanje mora da vrati ono što je
  -- potisnulo, polje po polje, ili reč ne znači ništa.
  FOR r IN
    SELECT * FROM jsonb_to_recordset(COALESCE(p_restore, '[]'::jsonb)) AS x(
      position_id        uuid,
      executions         jsonb,
      status             text,
      needs_review       boolean,
      restore_override   boolean,
      gross_pnl_override numeric,
      clear_target       boolean
    )
  LOOP
    DELETE FROM public.tj_executions WHERE position_id = r.position_id;

    INSERT INTO public.tj_executions (
      user_id, position_id, side, price, qty, executed_at, fee, swap_funding, source
    )
    SELECT
      v_user_id, r.position_id, e.side, e.price, e.qty, e.executed_at,
      COALESCE(e.fee, 0), COALESCE(e.swap_funding, 0), COALESCE(e.source, 'manual')
    FROM jsonb_to_recordset(COALESCE(r.executions, '[]'::jsonb)) AS e(
      side text, price numeric, qty numeric, executed_at timestamptz,
      fee numeric, swap_funding numeric, source text
    )
    WHERE e.side IN ('entry', 'exit')
      AND e.price IS NOT NULL
      AND e.qty > 0
      AND e.executed_at IS NOT NULL;

    UPDATE public.tj_positions
       SET status       = COALESCE(r.status, status),
           needs_review = COALESCE(r.needs_review, needs_review),
           -- Vraća se i kad je bio NULL. Poništavanje koje ostavi rezultat sa
           -- izvoda na trejdu koji ga pre uvoza nije imao nije povratak nego
           -- pola izmene — zato `restore_override` postoji odvojeno od same
           -- vrednosti: null je ovde stvarna vrednost, ne odsustvo.
           gross_pnl_override = CASE
             WHEN COALESCE(r.restore_override, false) THEN r.gross_pnl_override
             ELSE gross_pnl_override
           END,
           -- Target koji je uvoz upisao na trejd koji ga nije imao. Briše se
           -- samo kad ga je uvoz upisao; onaj koji je trejder sam uneo se ne
           -- dira, jer uvoz preko njega nikad nije ni pisao.
           target_price = CASE
             WHEN COALESCE(r.clear_target, false) THEN NULL
             ELSE target_price
           END
     WHERE id = r.position_id;
  END LOOP;

  -- Pozicije koje je uvoz napravio. Kaskade brišu fill-ove, slike, odgovore na
  -- pravila i dnevne provere; beleške i redovi uvoza gube pokazivač umesto da
  -- padnu. Sve to radi baza — ovde nema ni komada ni redosleda za pamćenje.
  IF array_length(p_delete_ids, 1) IS NOT NULL THEN
    DELETE FROM public.tj_positions WHERE id = ANY (p_delete_ids);
  END IF;

  -- Batch poslednji. `tj_import_rows.batch_id` je CASCADE, pa audit redovi
  -- odlaze sa njim; `tj_positions.import_batch_id` je SET NULL, pa pozicija
  -- koja je iz bilo kog razloga ostala više ne pokazuje na red kojeg nema.
  DELETE FROM public.tj_import_batches WHERE id = p_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.tj_undo_import_batch(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_undo_import_batch(uuid, jsonb, uuid[]) TO authenticated;
