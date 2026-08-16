-- Uvoz: mrtva šema van, poništavanje uvoza u jednu transakciju.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `tj_column_mappings` JE MRTVA ŠEMA
--
-- Tabela, RLS politika i indeks postoje od početka. Nijedan red koda je ne čita
-- ni ne piše — provereno grep-om po celom `src/`, jedini pogodak je generisani
-- `types.ts`. U bazi: 0 redova, 0 trigera, 0 stranih ključeva koji je
-- referišu.
--
-- Zamisao je bila da uvoz pamti mapiranje kolona po brokeru. Čarobnjak umesto
-- toga svaki put pogađa iz zaglavlja (`autoMap`), što radi i bez pamćenja. Dok
-- tabela stoji, ona je obećanje koje šema daje a kod ne ispunjava — sledeći
-- čitalac mora da utvrdi da li je nešto pokvareno ili nikad nije ni bilo
-- povezano. Ako pamćenje mapiranja ikad zatreba, tabela se dodaje uz kod koji
-- je koristi.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PONIŠTAVANJE UVOZA NIJE BILO JEDNA TRANSAKCIJA
--
-- `undoImportBatch` je radio pet odvojenih grupa brisanja preko PostgREST-a:
-- fill-ovi, slike, pozicije (sve troje u komadima), pa `tj_import_rows`, pa
-- batch. Svaki je mrežni poziv koji može da padne, i poništavanje koje stane
-- na pola ostavlja knjigu u stanju koje niko nije birao.
--
-- Uz to — IZMERENO, a ne pretpostavljeno: nijedan strani ključ ka
-- `tj_positions` ni ka `tj_import_batches` nije restriktivan. Svi su CASCADE
-- ili SET NULL:
--
--   tj_executions.position_id        → CASCADE
--   tj_trade_images.position_id      → CASCADE
--   tj_position_rules.position_id    → CASCADE
--   tj_position_checkins.position_id → CASCADE
--   tj_notes.position_id             → SET NULL
--   tj_import_rows.matched_position_id → SET NULL
--   tj_import_rows.batch_id          → CASCADE
--   tj_positions.import_batch_id     → SET NULL  (dodat u 20260816120000)
--
-- Komentar u `undoImportBatch` je taj ručni redosled opravdavao rečenicom
-- „removing them in any other order fails on a restrictive constraint — and the
-- base schema is not versioned in this repo, so that is not something to
-- assume". Šema je versionisana od Koraka 1, a tvrdnja je netačna: baza sama
-- radi svako od tih brisanja, tačnije i u jednom potezu.
--
-- `planUndo` OSTAJE u TypeScript-u. Ona je čista funkcija sa sopstvenim testom
-- i odlučuje ŠTA se vraća; ova funkcija samo izvršava tu odluku. Prepisivanje
-- odluke u SQL bi napravilo drugi odgovor na isto pitanje — tačno klasu koju je
-- Korak 5 uklanjao.

DROP TABLE IF EXISTS public.tj_column_mappings;

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
      gross_pnl_override numeric
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
