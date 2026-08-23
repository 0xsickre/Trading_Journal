-- =============================================================================
-- BAZNA MIGRACIJA — ono što je postojalo pre nego što je repo počeo da broji
-- =============================================================================
--
-- Do ovog fajla `supabase/migrations/` nije mogao da podigne bazu ni iz čega.
-- Najstarija migracija u njemu bila je DROP (`20260719120000`), a deset tabela
-- koje ona zatiče napravljeno je ručno nad živim projektom pre nego što je
-- folder uopšte postojao. Fresh baza je zato tražila kloniranje Supabase
-- brancha; od ovog fajla ne traži ništa osim `supabase/migrations/` po redu.
--
-- ŠTA JE OVDE, A ŠTA NIJE
--
-- Ovde je stanje šeme TAČNO PRE `20260719120000_drop_analysis_module.sql`, a
-- ne stanje kakvo je danas. Razlika nije akademska — ona je ceo razlog zašto
-- se `supabase/schema/production_base_tables.sql` nije mogao samo preimenovati
-- u migraciju:
--
--   * `tj_executions.import_row_id` i `tj_trade_images.storage_path` danas ne
--     postoje, ali ih `20260802121000` i `20260720150000` brišu BEZ `IF EXISTS`.
--     Baza bez njih pukne na tom koraku.
--   * `20260727121000` dodaje `breakeven_from` i još sedam kolona BEZ
--     `IF NOT EXISTS`. Baza koja ih već ima pukne na tom koraku.
--
-- Drugim rečima: kasnije migracije očekuju da zateknu istoriju, ne rezultat.
-- Zato su ovde `trade_type`, `vix_regime`, `confluences`, `result` i ostalih
-- dvadesetak kolona koje danas nema — svaka od njih ima migraciju koja je
-- briše, i svaka od tih migracija je ovde ulaz, a ne višak.
--
-- IZVOR
--
-- Nije rekonstruisano po sećanju. Doslovno je preuzeto iz
-- `supabase_migrations.schema_migrations` produkcije (`hjwvhzcszhjhpocfjatm`),
-- iz pet migracija koje su prethodile repou i dodirivale ove tabele:
--
--   20260620102333  tj_core_config           — accounts, instruments, liste
--   20260620102413  tj_positions_executions  — positions, executions, images
--   20260620102439  tj_import_and_storage    — import batch/rows/mappings
--   20260620102516  tj_harden_updated_at_fn  — search_path na okidaču
--   20260620152103  tj_positions_chart_url   — chart_url
--   20260708090743  trade_form_tag_arrays    — tag nizovi umesto skalara
--
-- Sažeto je u jedan `CREATE TABLE` po tabeli umesto ponavljanja add/drop plesa:
-- rezultat je isti, a fajl se može pročitati.
--
-- Analitički modul (`tj_bias_analyses`, `tj_pair_cot`, `tj_cot_legs`,
-- `tj_market_context`) NIJE ovde, iako je tada postojao. Migracija koja ga
-- briše radi to sa `DROP TABLE IF EXISTS`, pa bi ga ovaj fajl pravio samo da
-- bi ga sledeći korak obrisao.
--
-- `tj_column_mappings` JESTE ovde, iako je `20260816140000` briše kao mrtvu
-- šemu. Bez nje `20260720160000` pukne: `DROP POLICY IF EXISTS ... ON
-- public.tj_column_mappings` toleriše polisu koje nema, ali ne i tabelu.
--
-- Legacy `trade-images` bucket i njegove storage polise nisu ovde iz istog
-- razloga kao analitički modul: `20260720160000` ih skida, a `DROP POLICY IF
-- EXISTS` na `storage.objects` prolazi i kad polise nema.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Ekstenzije
--
-- `gen_random_uuid()` je od PG13 u jezgru, pa ovo nije uslov da DEFAULT-i rade.
-- Uključuje se jer je uključeno u produkciji (`extensions` šema, verzija 1.3),
-- a poenta ovog fajla je da nova baza bude ista, ne samo da proradi.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- rls_auto_enable — mreža ispod svakog budućeg CREATE TABLE
--
-- Event okidač koji pali RLS na svakoj novoj tabeli u `public`. Nikad nije bio
-- u repou, a `20260720160000` mu oduzima EXECUTE — što na praznoj bazi pukne
-- ako funkcije nema.
--
-- Nije kozmetika: tabela bez RLS-a u Supabase projektu je čitljiva svakome sa
-- anon ključem. Ovo je jedino što stoji između zaboravljenog `ENABLE ROW LEVEL
-- SECURITY` u nekoj od stotinu migracija ispod i tuđeg žurnala na internetu.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- tj_set_updated_at — `updated_at` na svakom UPDATE-u
--
-- `SET search_path = ''` je iz 20260620102516: funkcija sa SECURITY-relevantnim
-- pravima ne sme da razrešava imena preko putanje koju pozivalac kontroliše.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tj_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;


-- -----------------------------------------------------------------------------
-- tj_accounts — nalog i njegova podrazumevanja
--
-- Bez ijedne FTMO kolone i bez ijednog troškovnog podrazumevanja: sve to
-- dodaju 20260721150000, 20260727121000, 20260820080000 i 20260821120000.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_accounts (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL DEFAULT auth.uid(),
  name                text        NOT NULL,
  broker              text,
  currency            text        NOT NULL DEFAULT 'USD',
  starting_balance    numeric     NOT NULL DEFAULT 0,
  default_asset_class text,
  timezone            text        NOT NULL DEFAULT 'America/New_York',
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT tj_accounts_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tj_accounts_user_idx
  ON public.tj_accounts USING btree (user_id);


-- -----------------------------------------------------------------------------
-- tj_instruments — ugovorna specifikacija
--
-- `currency`, ne `quote_currency`: preimenovanje je 20260815130000, koje uz to
-- dodaje i tri CHECK-a za pozitivne specifikacije.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_instruments (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid(),
  symbol      text        NOT NULL,
  name        text,
  asset_class text,
  tick_size   numeric,
  tick_value  numeric,
  point_value numeric     NOT NULL DEFAULT 1,
  currency    text        NOT NULL DEFAULT 'USD',
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_instruments_pkey PRIMARY KEY (id),
  CONSTRAINT tj_instruments_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_instruments_user_id_symbol_key UNIQUE (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS tj_instruments_user_idx
  ON public.tj_instruments USING btree (user_id);


-- -----------------------------------------------------------------------------
-- tj_option_lists / tj_option_items — korisničke padajuće liste
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_option_lists (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL DEFAULT auth.uid(),
  key        text        NOT NULL,
  label      text        NOT NULL,
  category   text,
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_option_lists_pkey PRIMARY KEY (id),
  CONSTRAINT tj_option_lists_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_option_lists_user_id_key_key UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS tj_option_lists_user_idx
  ON public.tj_option_lists USING btree (user_id);

CREATE TABLE IF NOT EXISTS public.tj_option_items (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL DEFAULT auth.uid(),
  list_id    uuid        NOT NULL,
  value      text        NOT NULL,
  label      text        NOT NULL,
  color      text,
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_option_items_pkey PRIMARY KEY (id),
  CONSTRAINT tj_option_items_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_option_items_list_id_fkey FOREIGN KEY (list_id)
    REFERENCES public.tj_option_lists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tj_option_items_user_idx
  ON public.tj_option_items USING btree (user_id);
CREATE INDEX IF NOT EXISTS tj_option_items_list_idx
  ON public.tj_option_items USING btree (list_id);


-- -----------------------------------------------------------------------------
-- tj_positions — trejd kao roditeljski red
--
-- Kolone koje danas ne postoje su NAMERNO ovde. Svaka ima svoju migraciju koja
-- je briše, i bez ulaza taj DROP nema šta da uhvati:
--
--   trade_type, bias_tf, entry_trigger, discipline, market_condition  → 20260721120000
--   premium_discount, draw_on_liquidity, ipda_range, smt_divergence,
--     stop_logic, target_logic, notes, lesson_learned, conviction,
--     confluences, setup_tags                                          → 20260720120000
--   vix_regime, news_nearby                                            → 20260720140000
--   chart_url                                                          → 20260720150000
--   htf_bias, entry_tf, ict_entry_model                                → 20260729120000
--   result                                                             → 20260801190000
--
-- `status` i `source` nose inline CHECK bez imena, pa im Postgres daje
-- `tj_positions_status_check` i `tj_positions_source_check` — tačno imena koja
-- 20260728122000 i 20260821120000 kasnije traže po imenu da bi ih zamenili.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_positions (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL DEFAULT auth.uid(),
  account_id        uuid,
  trade_no          integer,
  -- Kontekst
  instrument        text,
  direction         text,
  trade_type        text,
  htf_bias          text,
  bias_tf           text,
  entry_tf          text,
  -- ICT setap i analiza
  premium_discount  text,
  draw_on_liquidity text,
  ipda_range        text,
  ict_entry_model   text,
  entry_trigger     text,
  smt_divergence    text,
  setup_grade       text,
  conviction        text,
  -- Rizik i izvršenje (planirano; ostvareno se izvodi iz fill-ova)
  entry_price       numeric,
  stop_price        numeric,
  stop_logic        text,
  target_price      numeric,
  target_logic      text,
  risk_pct          text,
  planned_rr        text,
  position_size     numeric,
  result            text,
  exit_reason       text,
  -- Psihologija i pregled
  discipline        text,
  mistake           text,
  market_condition  text,
  vix_regime        text,
  news_nearby       text,
  notes             text,
  lesson_learned    text,
  chart_url         text,
  -- Tag nizovi iz 20260708090743, koji je zamenio skalarna polja iznad
  confluences       text[]      NOT NULL DEFAULT '{}',
  psychology_tags   text[]      NOT NULL DEFAULT '{}',
  setup_tags        text[]      NOT NULL DEFAULT '{}',
  -- Meta
  status            text        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'partial', 'closed')),
  source            text        NOT NULL DEFAULT 'manual'
                                CHECK (source IN ('manual', 'import')),
  -- Namerno BEZ stranog ključa na tj_import_batches: undo koji promaši poziciju
  -- ostavlja je da pokazuje na obrisan batch, bez ičega da to uhvati.
  import_batch_id   uuid,
  needs_review      boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_positions_pkey PRIMARY KEY (id),
  CONSTRAINT tj_positions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_positions_account_id_fkey FOREIGN KEY (account_id)
    REFERENCES public.tj_accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS tj_positions_user_idx
  ON public.tj_positions USING btree (user_id);
CREATE INDEX IF NOT EXISTS tj_positions_account_idx
  ON public.tj_positions USING btree (account_id);

DROP TRIGGER IF EXISTS tj_positions_set_updated_at ON public.tj_positions;
CREATE TRIGGER tj_positions_set_updated_at
  BEFORE UPDATE ON public.tj_positions
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();


-- -----------------------------------------------------------------------------
-- tj_executions — fill-ovi. Svaki ulaz i izlaz je red; ovde se rađa novac.
--
-- `import_row_id` je ovde jer ga 20260802121000 briše bez `IF EXISTS`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_executions (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL DEFAULT auth.uid(),
  position_id   uuid        NOT NULL,
  side          text        NOT NULL CHECK (side IN ('entry', 'exit')),
  price         numeric     NOT NULL,
  qty           numeric     NOT NULL CHECK (qty > 0),
  executed_at   timestamptz NOT NULL,
  fee           numeric     NOT NULL DEFAULT 0,
  swap_funding  numeric     NOT NULL DEFAULT 0,
  source        text        NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual', 'import')),
  import_row_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_executions_pkey PRIMARY KEY (id),
  CONSTRAINT tj_executions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_executions_position_id_fkey FOREIGN KEY (position_id)
    REFERENCES public.tj_positions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tj_executions_position_idx
  ON public.tj_executions USING btree (position_id);
CREATE INDEX IF NOT EXISTS tj_executions_user_idx
  ON public.tj_executions USING btree (user_id);


-- -----------------------------------------------------------------------------
-- tj_trade_images — tada Supabase Storage putanje, danas TradingView URL-ovi
--
-- `storage_path` je ovde jer ga 20260720150000 briše bez `IF EXISTS`; ista
-- migracija uvodi `image_url` i menja dozvoljene `kind` vrednosti.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_trade_images (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL DEFAULT auth.uid(),
  position_id  uuid        NOT NULL,
  storage_path text        NOT NULL,
  kind         text        NOT NULL DEFAULT 'other'
                           CHECK (kind IN ('before', 'after', 'other')),
  caption      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_trade_images_pkey PRIMARY KEY (id),
  CONSTRAINT tj_trade_images_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_trade_images_position_id_fkey FOREIGN KEY (position_id)
    REFERENCES public.tj_positions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tj_trade_images_position_idx
  ON public.tj_trade_images USING btree (position_id);


-- -----------------------------------------------------------------------------
-- Uvoz: batch, redovi, i mapiranje kolona
--
-- `tj_column_mappings` je mrtva šema koju 20260816140000 briše. Ovde je zato
-- što je 20260720160000 dodiruje pre toga, a `DROP POLICY IF EXISTS` ne
-- toleriše tabelu koje nema.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_import_batches (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL DEFAULT auth.uid(),
  account_id    uuid,
  filename      text,
  broker_preset text,
  summary       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_import_batches_pkey PRIMARY KEY (id),
  CONSTRAINT tj_import_batches_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_import_batches_account_id_fkey FOREIGN KEY (account_id)
    REFERENCES public.tj_accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS tj_import_batches_user_idx
  ON public.tj_import_batches USING btree (user_id);

CREATE TABLE IF NOT EXISTS public.tj_import_rows (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL DEFAULT auth.uid(),
  batch_id            uuid        NOT NULL,
  raw                 jsonb,
  parsed              jsonb,
  match_status        text        NOT NULL DEFAULT 'new'
                                  CHECK (match_status IN ('new', 'match', 'ambiguous', 'duplicate')),
  matched_position_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT tj_import_rows_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_import_rows_batch_id_fkey FOREIGN KEY (batch_id)
    REFERENCES public.tj_import_batches(id) ON DELETE CASCADE,
  CONSTRAINT tj_import_rows_matched_position_id_fkey FOREIGN KEY (matched_position_id)
    REFERENCES public.tj_positions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS tj_import_rows_batch_idx
  ON public.tj_import_rows USING btree (batch_id);

CREATE TABLE IF NOT EXISTS public.tj_column_mappings (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid(),
  broker_name text        NOT NULL,
  mapping     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_column_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT tj_column_mappings_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_column_mappings_user_id_broker_name_key UNIQUE (user_id, broker_name)
);


-- -----------------------------------------------------------------------------
-- RLS — vlasnik i niko drugi
--
-- `(SELECT auth.uid())` umesto golog `auth.uid()`: bez podupita Postgres
-- pozove funkciju po REDU umesto jednom po upitu. Original je bio go, a
-- 20260720160000 ga je popravio nad živom bazom; ovde stoji već popravljen,
-- pa taj korak zatekne isto ono što bi i napisao.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tj_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_instruments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_option_lists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_option_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_positions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_executions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_trade_images    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_import_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_import_rows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_column_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tj_accounts_owner ON public.tj_accounts;
CREATE POLICY tj_accounts_owner ON public.tj_accounts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_instruments_owner ON public.tj_instruments;
CREATE POLICY tj_instruments_owner ON public.tj_instruments
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_lists_owner ON public.tj_option_lists;
CREATE POLICY tj_lists_owner ON public.tj_option_lists
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_items_owner ON public.tj_option_items;
CREATE POLICY tj_items_owner ON public.tj_option_items
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_positions_owner ON public.tj_positions;
CREATE POLICY tj_positions_owner ON public.tj_positions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_executions_owner ON public.tj_executions;
CREATE POLICY tj_executions_owner ON public.tj_executions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_images_owner ON public.tj_trade_images;
CREATE POLICY tj_images_owner ON public.tj_trade_images
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_batches_owner ON public.tj_import_batches;
CREATE POLICY tj_batches_owner ON public.tj_import_batches
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_rows_owner ON public.tj_import_rows;
CREATE POLICY tj_rows_owner ON public.tj_import_rows
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS tj_mappings_owner ON public.tj_column_mappings;
CREATE POLICY tj_mappings_owner ON public.tj_column_mappings
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
