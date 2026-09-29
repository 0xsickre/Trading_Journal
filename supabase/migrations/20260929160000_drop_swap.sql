-- H2.3: swap leaves the book (decision 29.09.2026, I3).
--
-- WHY. Swap is the overnight financing a CFD position pays; a CME future pays
-- none, and the book has been futures-only since 20260928140000. On 29.09.2026
-- no fill, no instrument and no account carried a non-zero swap. The trader:
-- "ništa od ovog mi ne treba".
--
-- WHAT CHANGES IN THE MONEY. `net_pl` becomes gross - fees (was gross - fees -
-- swap) and `realized_r_net` the same. With every swap at 0 this moves no
-- figure; it removes a term that could only ever be 0. The TypeScript twin
-- (`src/lib/journal/position-stats.ts`) changes in the same commit and the
-- parity test holds the two together.
--
-- ORDER. The view reads `tj_executions.swap_funding`, so it is dropped and
-- recreated first (as in 20260921120000 with the swap removed, then
-- `security_invoker = on` and the grants — forgetting either silently changes
-- whose RLS filters it). The four functions that write or restore the column
-- are restated without it: `tj_replace_executions` from its LIVE definition
-- (it had been changed outside the migrations), `tj_save_trade` from
-- 20260816120000, `tj_undo_import_batch` from 20260919160000 and
-- `tj_seed_instruments_defaults` from 20260928140000. `CREATE OR REPLACE` keeps
-- their grants. Then the columns go.

DROP VIEW IF EXISTS public.tj_position_stats;

CREATE VIEW public.tj_position_stats AS
WITH ex AS (
  SELECT
    e.position_id,
    sum(e.qty)            FILTER (WHERE e.side = 'entry') AS entry_qty,
    sum(e.price * e.qty)  FILTER (WHERE e.side = 'entry') AS entry_notional,
    sum(e.qty)            FILTER (WHERE e.side = 'exit')  AS exit_qty,
    sum(e.price * e.qty)  FILTER (WHERE e.side = 'exit')  AS exit_notional,
    sum(COALESCE(e.fee, 0::numeric))          AS total_fees,
    min(e.executed_at) FILTER (WHERE e.side = 'entry') AS opened_at,
    max(e.executed_at) FILTER (WHERE e.side = 'exit')  AS closed_at
  FROM public.tj_executions e
  GROUP BY e.position_id
),
base AS (
  SELECT
    p.id AS position_id, p.user_id, p.account_id, p.instrument, p.direction, p.status,
    -- THE ONE CHANGE in this restatement (20260921120000). `risk_pts` below is
    -- the denominator of `realized_r` and `realized_r_net`, i.e. of every R in
    -- the application. Read from the live columns it was falsifiable: widening
    -- a stop after the close shrank every loss measured against it. It now
    -- reads the SEALED plan, and falls back to the live column for a trade
    -- that has no seal. Nothing else in the view moves; the final SELECT never
    -- exposed these two columns, so only R changes.
    public.tj_sealed_num(p.plan_snapshot, 'entry_price', p.entry_price) AS entry_price,
    public.tj_sealed_num(p.plan_snapshot, 'stop_price',  p.stop_price)  AS stop_price,
    p.gross_pnl_override,
    ex.entry_qty, ex.exit_qty, ex.entry_notional, ex.exit_notional,
    COALESCE(ex.total_fees, 0::numeric) AS total_fees,
    ex.opened_at, ex.closed_at,
    CASE WHEN lower(COALESCE(p.direction, ''::text)) LIKE 'short%' THEN -1 ELSE 1 END AS dir_mult,
    COALESCE(p.point_value_at_trade, i.point_value) AS point_value,
    COALESCE(p.tick_size_at_trade,   i.tick_size)   AS tick_size,
    CASE
      WHEN p.point_value_at_trade IS NOT NULL THEN 'snapshot'
      WHEN i.point_value          IS NOT NULL THEN 'instrument'
      ELSE 'missing'
    END AS point_value_source,
    COALESCE(p.quote_currency_at_trade, i.quote_currency) AS quote_currency,
    a.currency AS account_currency,
    COALESCE(
      p.fx_rate_at_trade,
      CASE WHEN COALESCE(p.quote_currency_at_trade, i.quote_currency) = a.currency THEN 1 END
    ) AS fx_rate,
    CASE
      WHEN p.fx_rate_at_trade IS NOT NULL THEN 'snapshot'
      WHEN a.currency IS NULL THEN 'no_account'
      WHEN COALESCE(p.quote_currency_at_trade, i.quote_currency) = a.currency THEN 'same_currency'
      ELSE 'missing'
    END AS fx_rate_source
  FROM public.tj_positions p
  LEFT JOIN ex ON ex.position_id = p.id
  LEFT JOIN public.tj_instruments i ON i.user_id = p.user_id AND i.symbol = p.instrument
  LEFT JOIN public.tj_accounts a ON a.id = p.account_id
),
derived AS (
  SELECT b.*,
    CASE WHEN b.entry_qty > 0::numeric THEN b.entry_notional / b.entry_qty END AS avg_entry,
    CASE WHEN b.exit_qty  > 0::numeric THEN b.exit_notional  / b.exit_qty  END AS avg_exit,
    CASE WHEN b.entry_qty > 0::numeric AND b.exit_qty > 0::numeric
      THEN (b.exit_notional - b.entry_notional / b.entry_qty * b.exit_qty) * b.dir_mult::numeric
    END AS gross_points
  FROM base b
),
risk AS (
  SELECT d.*,
    NULLIF(abs(COALESCE(d.entry_price, d.avg_entry) - d.stop_price), 0::numeric) AS risk_pts
  FROM derived d
),
money AS (
  SELECT r.*,
    -- Override pobeđuje kad postoji. gross_points i dalje se računa iznad —
    -- ostaje vidljiv za MAE/MFE i za dijagnostiku, samo ne ulazi u gross_pl.
    COALESCE(r.gross_pnl_override, r.gross_points * r.point_value * r.fx_rate) AS gross_pl_acct
  FROM risk r
)
SELECT
  m.position_id, m.user_id, m.account_id, m.instrument, m.direction, m.status,
  m.entry_qty, m.exit_qty, m.avg_entry, m.avg_exit, m.total_fees,
  m.opened_at, m.closed_at,
  CASE WHEN m.closed_at IS NOT NULL AND m.opened_at IS NOT NULL
    THEN EXTRACT(epoch FROM m.closed_at - m.opened_at) END AS duration_seconds,
  m.point_value, m.tick_size, m.point_value_source,
  m.quote_currency, m.account_currency, m.fx_rate, m.fx_rate_source,
  (m.gross_pnl_override IS NOT NULL) AS money_overridden,
  m.dir_mult, m.gross_points,
  m.gross_pl_acct AS gross_pl,
  m.gross_pl_acct - m.total_fees AS net_pl,
  -- R je odnos u prostoru cena, nezavisan od override-a.
  m.gross_points / (m.risk_pts * m.entry_qty) AS realized_r,
  -- Neto R u novcu i dalje traži point_value i kurs za imenilac, čak i kad je
  -- gross_pl poznat preko override-a. Ostaje null dok kurs nije poznat — to je
  -- razmak, ne bag: dolarski profit se može znati bez dolarskog rizika.
  (m.gross_pl_acct - m.total_fees)
    / (m.risk_pts * m.entry_qty * m.point_value * m.fx_rate) AS realized_r_net
FROM money m;

ALTER VIEW public.tj_position_stats SET (security_invoker = on);

GRANT SELECT ON public.tj_position_stats TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tj_replace_executions(p_position_id uuid, p_executions jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id  uuid;
  v_inserted integer;
BEGIN
  SELECT user_id INTO v_user_id
    FROM public.tj_positions
   WHERE id = p_position_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Position % not found', p_position_id
      USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM public.tj_executions WHERE position_id = p_position_id;

  INSERT INTO public.tj_executions (
    user_id, position_id, side, price, qty, executed_at, fee, source
  )
  SELECT
    v_user_id,
    p_position_id,
    e.side,
    e.price,
    e.qty,
    e.executed_at,
    COALESCE(e.fee, 0),
    COALESCE(e.source, 'manual')
  FROM jsonb_to_recordset(COALESCE(p_executions, '[]'::jsonb)) AS e(
    side         text,
    price        numeric,
    qty          numeric,
    executed_at  timestamptz,
    fee          numeric,
    source       text
  )
  WHERE e.side IN ('entry', 'exit')
    AND e.price IS NOT NULL
    AND e.qty > 0
    AND e.executed_at IS NOT NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

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

create or replace function public.tj_seed_instruments_defaults(target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Only ever for an empty book. Re-running this must not resurrect a symbol
  -- the trader deleted, which is what `20260920001500` was written to stop.
  if exists (select 1 from public.tj_instruments where user_id = target) then
    return;
  end if;

  insert into public.tj_instruments (
    user_id, symbol, name, asset_class,
    point_value, tick_size, tick_value, quote_currency,
    commission_per_lot, commission_pct, commission_currency,
    is_active, sort_order
  )
  select target, v.symbol, v.name, 'Futures',
         v.point_value, v.tick_size, null::numeric, 'USD',
         v.commission_per_lot, 0, 'USD',
         true, v.ord
  from (values
    ('NQ','E-mini Nasdaq 100',20::numeric,0.25::numeric,1.89::numeric,30),
    ('MNQ','Micro E-mini Nasdaq 100',2,0.25,0.61,31),
    ('ES','E-mini S&P 500',50,0.25,1.89,32),
    ('MES','Micro E-mini S&P 500',5,0.25,0.61,33),
    ('6E','Euro FX',125000,0.00005,2.11,34),
    ('M6E','Micro EUR/USD',12500,0.0001,0.5,35)
  ) as v(symbol, name, point_value, tick_size, commission_per_lot, ord);
end;
$function$;

ALTER TABLE public.tj_executions  DROP COLUMN IF EXISTS swap_funding;
ALTER TABLE public.tj_instruments DROP CONSTRAINT IF EXISTS tj_instruments_swap_triple_day_check;
ALTER TABLE public.tj_instruments
  DROP COLUMN IF EXISTS swap_long,
  DROP COLUMN IF EXISTS swap_short,
  DROP COLUMN IF EXISTS swap_triple_day;
ALTER TABLE public.tj_accounts    DROP COLUMN IF EXISTS default_swap_per_day;
