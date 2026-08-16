-- Put upisa trejda: opseg, referenca i atomičnost.
--
-- Tri odvojena kvara koja dele jedno mesto — trenutak u kojem trejd ulazi u
-- bazu. Do sada je taj trenutak bio najslabije branjen deo sistema, iako je
-- jedini kroz koji svaki broj mora da prođe.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CENA NIJE IMALA NIJEDNO OGRANIČENJE
--
-- `tj_positions` je nosila CHECK samo na `conviction`, `time_stop_days`,
-- `status`, `source`, `fx_rate_at_trade` i format valute. Cene — `entry_price`,
-- `stop_price`, `target_price`, `max_drawdown_price`, `max_profit_price` — i
-- `position_size` nisu imale nijedno. `tj_executions.price` takođe ne (samo
-- `qty > 0`).
--
-- Izmereno na ovoj bazi pre izmene:
--
--   insert ES, entry_price −5000, stop −5010, point_value 50, fx 1
--   fill entry −5000 ×1, fill exit −4990 ×1
--   → tj_position_stats: gross_pl = 500, net_pl = 500, realized_r = 1.00
--
-- Dakle omašen znak ne pada i ne označava se — ispisuje se kao uredan dobitak
-- od 500 $ na ES-u i ulazi u profit factor, expectancy i Sickre Score kao da je
-- zarađen. To je najgori mogući ishod: ne greška, nego siguran pogrešan broj.
--
-- Zašto strogo `> 0`, kad je WTI 20.04.2020. namiren na −37,63 $: to je bila
-- cena namirenja fjučersa u jednom danu u istoriji, ne popunjenje koje retail
-- nalog vidi. Naspram nje stoji svaki omašen znak i svaki minus zalepljen iz
-- izvoda. Odbijanje sa porukom je bolje od tihog prihvatanja, a pravilo se
-- menja na jednom mestu ako ikad zatreba.
--
-- `gross_pnl_override` NEMA ovo ograničenje i ne sme da ga dobije — gubitak je
-- negativan broj i to je njegova ispravna vrednost.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `import_batch_id` NIJE IMAO STRANI KLJUČ
--
-- Kolona je `uuid` bez reference. `undoImportBatch` na kraju briše batch, a
-- pozicija koja iz bilo kog razloga nije obrisana ostaje da pokazuje na red koji
-- više ne postoji — i nijedan budući undo je ne može naći, jer se traži preko
-- `batch_id` koji je nestao. Komentar u `import/actions.ts` je taj scenario
-- opisivao rečima „there is no FK on that column to cascade or to refuse".
--
-- `ON DELETE SET NULL`, ne `CASCADE`: trejdovi koje je uvoz napravio su
-- trejdovi. Brisanje batch-a sme da izgubi trag o poreklu, ali ne i knjigu.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UPIS TREJDA NIJE BIO JEDNA TRANSAKCIJA
--
-- `createTrade` je bio četiri odvojena poziva (pozicija, fill-ovi, odgovori na
-- pravila, slike) sa ručnim kompenzacionim `delete`-om posle svakog. Kompenzacija
-- je i sama mrežni poziv koji može da padne, i tada ostaje pozicija bez fill-ova
-- — trejd koji u knjizi stoji kao planiran, sa praznim novcem.
--
-- `updateTrade` je gori: `UPDATE` pozicije je COMMIT-ovan pre nego što
-- `tj_replace_executions` i `saveRuleAnswers` uopšte krenu. Kad drugi padne,
-- vraćanje nije moguće ni u principu — akcija vrati grešku, a izmena polja je
-- već u bazi. Korisnik vidi „nije sačuvano", a pola izmene stoji.
--
-- `tj_save_trade` radi sve u jednom telu funkcije, a telo funkcije je jedna
-- transakcija: ili ceo trejd, ili ništa.

-- ── 1. opseg ────────────────────────────────────────────────────────────────

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_prices_positive CHECK (
    (entry_price        IS NULL OR entry_price        > 0) AND
    (stop_price         IS NULL OR stop_price         > 0) AND
    (target_price       IS NULL OR target_price       > 0) AND
    (max_drawdown_price IS NULL OR max_drawdown_price > 0) AND
    (max_profit_price   IS NULL OR max_profit_price   > 0) AND
    (position_size      IS NULL OR position_size      > 0)
  );

ALTER TABLE public.tj_executions
  ADD CONSTRAINT tj_executions_price_positive CHECK (price > 0);

-- ── 2. referenca ────────────────────────────────────────────────────────────

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_import_batch_id_fkey
  FOREIGN KEY (import_batch_id) REFERENCES public.tj_import_batches(id)
  ON DELETE SET NULL;

-- ── 3. atomičnost ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tj_save_trade(
  p_id         uuid    DEFAULT NULL,
  p_position   jsonb   DEFAULT '{}'::jsonb,
  p_executions jsonb   DEFAULT '[]'::jsonb,
  p_rules      jsonb   DEFAULT '[]'::jsonb,
  p_images     jsonb   DEFAULT '[]'::jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
DECLARE
  v_id      uuid;
  v_user_id uuid;
  v_cols    text;
BEGIN
  -- SECURITY INVOKER (podrazumevano): RLS važi za pozivaoca, isto kao kod
  -- `tj_replace_executions`. Red koji RLS skriva je nerazlučiv od nepostojećeg,
  -- i oba su odbijanje.
  IF p_id IS NULL THEN
    -- Minimalan INSERT pa ista putanja izmene za sve ostalo — jedan kod za oba
    -- slučaja umesto dva koja mogu da se raziđu.
    --
    -- `account_id` i `trade_no` MORAJU ovde: `tj_assign_trade_no` je BEFORE
    -- INSERT trigger koji broji po nalogu, pa bi pozicija ubačena bez naloga
    -- dobila broj iz pogrešnog niza, a kasniji UPDATE ga ne prenumeriše.
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

  -- Skup kolona se čita iz kataloga i preseca sa ključevima koje je poslao
  -- pozivalac. Dve posledice, obe namerne:
  --
  --   • identifikatori NIKAD ne dolaze iz payload-a — `information_schema` je
  --     jedini izvor imena, pa dinamički SQL ovde nema površinu za injekciju;
  --   • kolona koje u patch-u NEMA se ne dira. Izmena jednog polja ne sme da
  --     obriše ostala, a `jsonb_populate_record` za odsutan ključ daje NULL.
  --
  -- `id`, `user_id`, `created_at` i `import_batch_id` se izuzimaju: vlasništvo i
  -- poreklo nisu polja formulara.
  SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name   = 'tj_positions'
     AND c.column_name IN (SELECT jsonb_object_keys(p_position))
     AND c.column_name NOT IN ('id', 'user_id', 'created_at', 'import_batch_id')
     -- `trade_no` = null NE briše dodeljen broj.
     --
     -- Uhvaćeno merenjem, ne čitanjem: prvi pun payload kroz ovu funkciju vratio
     -- se sa `trade_no = null`. Trigger `tj_assign_trade_no` ga dodeli na INSERT
     -- (BEFORE INSERT, po nalogu), a onda ga je UPDATE ispod vraćao na NULL —
     -- jer formular baš tako i šalje: `trade_no: initial?.trade_no ?? null`, gde
     -- null znači „prepusti bazi", ne „obriši".
     --
     -- Redni broj nije polje koje korisnik prazni. Kad ga payload nosi kao null,
     -- to je odsustvo vrednosti a ne zahtev za brisanjem.
     AND NOT (c.column_name = 'trade_no' AND p_position->'trade_no' = 'null'::jsonb);

  IF v_cols IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.tj_positions SET (%s) = '
      '(SELECT %s FROM jsonb_populate_record(NULL::public.tj_positions, $1)) '
      'WHERE id = $2',
      v_cols, v_cols
    ) USING p_position, v_id;
  END IF;

  -- Fill-ovi. Isti WHERE kao `tj_replace_executions`, uz `price > 0` koji je
  -- sada i CHECK — red koji ne prođe se odbija, ne ispada tiho.
  DELETE FROM public.tj_executions WHERE position_id = v_id;

  INSERT INTO public.tj_executions (
    user_id, position_id, side, price, qty, executed_at, fee, swap_funding, source
  )
  SELECT
    v_user_id, v_id, e.side, e.price, e.qty, e.executed_at,
    COALESCE(e.fee, 0), COALESCE(e.swap_funding, 0), COALESCE(e.source, 'manual')
  FROM jsonb_to_recordset(COALESCE(p_executions, '[]'::jsonb)) AS e(
    side text, price numeric, qty numeric, executed_at timestamptz,
    fee numeric, swap_funding numeric, source text
  )
  WHERE e.side IN ('entry', 'exit')
    AND e.price IS NOT NULL
    AND e.qty > 0
    AND e.executed_at IS NOT NULL;

  -- Odgovori na pravila. Brisanje pa upis, ne upsert: pravilo na koje je odgovor
  -- POVUČEN nema ključ u payload-u, a upsert bi ostavio staru ocenu da i dalje
  -- ulazi u follow rate.
  DELETE FROM public.tj_position_rules WHERE position_id = v_id;

  INSERT INTO public.tj_position_rules (user_id, position_id, rule_id, followed)
  SELECT v_user_id, v_id, r.rule_id, r.followed
  FROM jsonb_to_recordset(COALESCE(p_rules, '[]'::jsonb)) AS r(
    rule_id uuid, followed boolean
  )
  WHERE r.rule_id IS NOT NULL
    AND r.followed IS NOT NULL;

  -- Slike samo pri nastanku. Postojećem trejdu ih piše `TradeImages` sopstvenim
  -- putem, pa bi prihvatanje i ovde dalo jednom redu dva pisca bez pravila ko
  -- pobeđuje. Prazan niz na izmeni znači „ne diraj", ne „obriši".
  IF p_id IS NULL AND jsonb_array_length(COALESCE(p_images, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.tj_trade_images (user_id, position_id, kind, image_url)
    SELECT v_user_id, v_id, i.kind, i.image_url
    FROM jsonb_to_recordset(p_images) AS i(kind text, image_url text)
    WHERE i.kind IS NOT NULL AND i.image_url IS NOT NULL;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.tj_save_trade(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_save_trade(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;
