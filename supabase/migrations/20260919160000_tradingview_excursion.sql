-- A TradingView import now writes the trade's MAE/MFE, read off TradingView's
-- own favorable and adverse excursion (`tradingViewExcursion`). Those were
-- typed by hand from the same export until now, to the cent.
--
-- 1) `excursion_source = 'tradingview'` — who wrote the two prices. Typed still
--    wins: an import writes them only onto a trade that has none, or whose
--    prices an earlier TradingView import wrote.
--
-- 2) `tj_import_rows.excursion_written` — whether THIS row wrote them onto a
--    trade that had none. Undo empties them again, and only then, exactly as
--    `target_written` does for the target: a value the trader typed since is
--    theirs, and an undo that erased it would be a second edit.

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_excursion_source_check;
ALTER TABLE public.tj_positions ADD CONSTRAINT tj_positions_excursion_source_check
  CHECK (excursion_source IS NULL OR excursion_source = ANY (ARRAY[
    'manual'::text, 'mt5'::text, 'tradingview'::text]));

COMMENT ON COLUMN public.tj_positions.excursion_source IS
  'Who wrote max_drawdown_price / max_profit_price: manual (typed — never '
  'overwritten), mt5 (trading accounts, scripts/mt5_excursion.py) or tradingview '
  '(the TradingView import, from its favorable/adverse excursion).';

ALTER TABLE public.tj_import_rows
  ADD COLUMN IF NOT EXISTS excursion_written boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tj_import_rows.excursion_written IS
  'True when this import row wrote MAE/MFE onto a position that had none. Undo '
  'sets them back to NULL; prices the trader typed are never touched.';

-- Undo learns one more field ---------------------------------------------------
--
-- Restated whole, as 20260918140000 did: the function is the record of what an
-- undo restores. Only `clear_excursion` and its three SET lines are new.

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
      clear_target       boolean,
      clear_excursion    boolean
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
           END,
           -- MAE/MFE koje je uvoz upisao na trejd koji ih nije imao — isto
           -- pravilo kao za target.
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
