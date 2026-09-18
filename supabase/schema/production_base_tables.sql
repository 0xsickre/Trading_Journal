-- =============================================================================
-- BAZNE TABELE — zapis stanja, ne migracija koja se pušta
-- =============================================================================
--
-- Devet tabela ispod je napravljeno direktno nad živim projektom, pre nego što
-- je `supabase/migrations/` uopšte postojao. Repo ih od tada samo ALTER-uje:
-- najstarija migracija u njemu (`20260719120000_drop_analysis_module.sql`) je
-- DROP, ne CREATE. Posledica je da `CREATE TABLE public.tj_positions` do sada
-- nije postojalo nigde — ni u kodu, ni u dokumentaciji.
--
-- Šta to znači u praksi, i zašto je ovaj fajl morao da nastane:
--
--   1. Baza se nije mogla rekonstruisati iz repoa: tabele u produkciji koje
--      nemaju `CREATE TABLE` nigde u migracijama.
--   2. Ono što nije zapisano ne može se ni proveriti. Tačno tako je i nastao
--      bag koji je popravljen u istom koraku: `tj_on_auth_user_created` je
--      zvala `tj_seed_analysis_defaults`, a migracija koja je tu funkciju
--      obrisala nije mogla da vidi da je iko zove — funkcija okidača nije bila
--      u repou. Vidi `20260815120000_fix_auth_seed_trigger.sql`.
--
-- ZAŠTO NIJE U `migrations/`
--
-- Ovaj fajl opisuje tabele kakve su DANAS — sa svim kolonama koje su kasnije
-- migracije dodale. Postavljen kao prva migracija, sudarao bi se sa svakim
-- kasnijim `ADD COLUMN` pri svežem podizanju baze.
--
-- Ovde je ranije pisalo i da vraćanje unazad, do stanja pre prve migracije,
-- nije moguće pošteno — jer kolonama koje su usput obrisane nema traga. Ispalo
-- je da ima: produkcija čuva DDL svake migracije u
-- `supabase_migrations.schema_migrations`, uključujući i onih šest koje su
-- prethodile repou. Odatle je doslovno preuzet
-- `20260719100000_baseline_schema.sql`, pa nijedan tip nije pogođen.
--
-- Zato je ovo `schema/`, a ne `migrations/`: **merodavan zapis** onoga što
-- migracije ne pokrivaju, sinhronizovan sa produkcijom introspekcijom, a ne
-- korak koji se pušta.
--
-- Za podizanje nove baze Supabase branch VIŠE NIJE POTREBAN:
-- `20260719100000_baseline_schema.sql` sada pravi ovih deset tabela pre svih
-- ostalih migracija, pa `supabase/migrations/` po redu podiže praznu bazu do
-- današnje šeme. Taj fajl opisuje stanje PRE prve migracije u repou, a ovaj
-- opisuje stanje DANAS — zato oba postoje i zato se ne mogu zameniti jedan
-- drugim.
--
-- Izvučeno iz projekta `hjwvhzcszhjhpocfjatm` (Trading Journal), PostgreSQL 17.6.
-- Ako se bazna tabela ikad izmeni, izmeni se i ovde — i to više nije samo
-- molba: `npm run schema:check` poredi ovaj fajl sa `src/lib/supabase/types.ts`,
-- koji se generiše iz produkcije, i pada kad se raziđu. Prvi put pokrenut,
-- našao je šest kolona koje fale i jednu tabelu koje nema.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- tj_accounts — nalog, njegova podrazumevanja i prop-firm ograničenja
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_accounts (
  id                          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id                     uuid        NOT NULL DEFAULT auth.uid(),
  name                        text        NOT NULL,
  broker                      text,
  currency                    text        NOT NULL DEFAULT 'USD',
  starting_balance            numeric     NOT NULL DEFAULT 0,
  default_asset_class         text,
  timezone                    text        NOT NULL DEFAULT 'America/New_York',
  is_active                   boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- FTMO / prop-firm režim (20260721150000_ftmo_account_mode.sql)
  ftmo_mode                   boolean     NOT NULL DEFAULT false,
  ftmo_daily_loss_enabled     boolean     NOT NULL DEFAULT true,
  ftmo_daily_loss_pct         numeric     NOT NULL DEFAULT 5,
  ftmo_max_loss_enabled       boolean     NOT NULL DEFAULT true,
  ftmo_max_loss_pct           numeric     NOT NULL DEFAULT 10,
  ftmo_profit_target_enabled  boolean     NOT NULL DEFAULT true,
  ftmo_profit_target_pct      numeric     NOT NULL DEFAULT 10,
  ftmo_min_days_enabled       boolean     NOT NULL DEFAULT true,
  ftmo_min_days               integer     NOT NULL DEFAULT 4,
  ftmo_reset_at               timestamptz,
  -- Breakeven pojas i podrazumevani troškovi (20260727121000)
  breakeven_from              numeric     NOT NULL DEFAULT 0,
  breakeven_to                numeric     NOT NULL DEFAULT 0,
  breakeven_unit              text        NOT NULL DEFAULT 'currency',
  default_commission_per_unit numeric     NOT NULL DEFAULT 0,
  default_fee_fixed           numeric     NOT NULL DEFAULT 0,
  default_swap_per_day        numeric     NOT NULL DEFAULT 0,
  default_stop_pct            numeric,
  default_target_pct          numeric,
  -- Od čega se meri dnevni gubitak: od početnog stanja ili od equity-ja na
  -- početku dana (20260822144309).
  ftmo_daily_loss_basis       text        NOT NULL DEFAULT 'starting_balance',
  CONSTRAINT tj_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT tj_accounts_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_accounts_breakeven_range_ordered
    CHECK (breakeven_from <= breakeven_to),
  CONSTRAINT tj_accounts_breakeven_unit_check
    CHECK (breakeven_unit = ANY (ARRAY['currency'::text, 'pct'::text])),
  CONSTRAINT tj_accounts_starting_balance_non_negative
    CHECK (starting_balance >= 0::numeric)
);
CREATE INDEX IF NOT EXISTS tj_accounts_user_idx ON public.tj_accounts USING btree (user_id);


-- -----------------------------------------------------------------------------
-- tj_positions — trejd kao roditeljski red. Novac ne stoji ovde; izvodi ga
-- view tj_position_stats iz fill-ova. Vidi README §"Trejd nije jedan red".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_positions (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL DEFAULT auth.uid(),
  account_id           uuid,
  trade_no             integer,
  instrument           text,
  direction            text,
  setup_grade          text,
  entry_price          numeric,
  stop_price           numeric,
  target_price         numeric,
  -- risk_pct i planned_rr su TEXT: čuvaju "1%" i "2.45" kako ih forma nudi.
  -- Jedina validacija je parsePlannedRewardR / parseRiskPct u lib/.
  risk_pct             text,
  planned_rr           text,
  position_size        numeric,
  exit_reason          text,
  mistake              text[]      NOT NULL DEFAULT '{}'::text[],
  status               text        NOT NULL DEFAULT 'open',
  source               text        NOT NULL DEFAULT 'manual',
  -- Namerno BEZ strani ključ na tj_import_batches: undo koji promaši poziciju
  -- ostavlja je da pokazuje na obrisan batch, bez ičega da to uhvati.
  import_batch_id      uuid,
  needs_review         boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  psychology_tags      text[]      NOT NULL DEFAULT '{}'::text[],
  technical_tags       text[]      NOT NULL DEFAULT '{}'::text[],
  trade_journal_notes  text,
  max_drawdown_price   numeric,
  max_profit_price     numeric,
  miss_reason          text,
  missed_at            timestamptz,
  point_value_at_trade numeric,
  tick_size_at_trade   numeric,
  custom               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  playbook_id          uuid,
  conviction           smallint,
  execution_rating     smallint,
  thesis               text,
  invalidation         text,
  time_stop_days       smallint,
  scale_out_plan       text,
  scale_out_levels     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Valuta kotacije i kurs zamrznuti pri upisu, iz istog razloga kao
  -- `point_value_at_trade`: kasnija izmena instrumenta ne sme da pomeri
  -- istorijski P&L (20260815200219).
  quote_currency_at_trade text,
  fx_rate_at_trade     numeric,
  -- Bruto rezultat prepisan sa brokerovog izvoda umesto izvedenog iz cena
  -- (20260815210613). Vidi `money_overridden` u tj_position_stats.
  gross_pnl_override   numeric,
  CONSTRAINT tj_positions_pkey PRIMARY KEY (id),
  CONSTRAINT tj_positions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_positions_account_id_fkey FOREIGN KEY (account_id)
    REFERENCES public.tj_accounts(id) ON DELETE SET NULL,
  CONSTRAINT tj_positions_playbook_id_fkey FOREIGN KEY (playbook_id)
    REFERENCES public.tj_playbooks(id) ON DELETE SET NULL,
  CONSTRAINT tj_positions_status_check CHECK (status = ANY (ARRAY[
    'planned'::text, 'missed'::text, 'open'::text, 'partial'::text, 'closed'::text])),
  -- Bot most uklonjen u 20260918120000_remove_bot_bridge.sql: 'bot' više nije
  -- dozvoljen, a redovi koje je upisao prebačeni su na 'manual'.
  CONSTRAINT tj_positions_source_check CHECK (source = ANY (ARRAY[
    'manual'::text, 'import'::text])),
  CONSTRAINT tj_positions_conviction_check
    CHECK (conviction IS NULL OR (conviction >= 1 AND conviction <= 5)),
  CONSTRAINT tj_positions_execution_rating_check
    CHECK (execution_rating IS NULL OR (execution_rating >= 1 AND execution_rating <= 5)),
  CONSTRAINT tj_positions_scale_out_levels_check
    CHECK (jsonb_typeof(scale_out_levels) = 'array'),
  CONSTRAINT tj_positions_time_stop_days_positive
    CHECK (time_stop_days IS NULL OR time_stop_days > 0)
);
CREATE INDEX IF NOT EXISTS tj_positions_user_idx
  ON public.tj_positions USING btree (user_id);
CREATE INDEX IF NOT EXISTS tj_positions_account_idx
  ON public.tj_positions USING btree (account_id);
CREATE INDEX IF NOT EXISTS tj_positions_user_created_idx
  ON public.tj_positions USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tj_positions_account_created_idx
  ON public.tj_positions USING btree (account_id, created_at DESC)
  WHERE (account_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS tj_positions_playbook_idx
  ON public.tj_positions USING btree (playbook_id)
  WHERE (playbook_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS tj_positions_custom_idx
  ON public.tj_positions USING gin (custom jsonb_path_ops);

COMMENT ON COLUMN public.tj_positions.custom IS
  'Values for user-defined fields, keyed by tj_field_defs.key. Invariant: a key '
  'here must never also be a column on this table — lib/journal/field-values.ts '
  'reads columns first, so a duplicate key would be silently unreachable.';
COMMENT ON COLUMN public.tj_positions.max_drawdown_price IS
  'MAE: najnepovoljnija cena tokom trade-a (long=low, short=high)';
COMMENT ON COLUMN public.tj_positions.max_profit_price IS
  'MFE: najpovoljnija cena tokom trade-a (long=high, short=low)';
COMMENT ON COLUMN public.tj_positions.point_value_at_trade IS
  'Instrument point value captured when the trade was written. Immutable: later '
  'edits to tj_instruments must not move historical P&L.';
COMMENT ON COLUMN public.tj_positions.tick_size_at_trade IS
  'Instrument tick size captured when the trade was written.';
COMMENT ON COLUMN public.tj_positions.scale_out_plan IS
  'Planned scale-out, free text. Read against tj_position_checkins.touched = '
  '''partial_exit'' to tell a planned reduction from an early exit.';


-- -----------------------------------------------------------------------------
-- tj_executions — fill-ovi. Svaki ulaz i izlaz je red; ovde se rađa novac.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_executions (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL DEFAULT auth.uid(),
  position_id  uuid        NOT NULL,
  side         text        NOT NULL,
  price        numeric     NOT NULL,
  qty          numeric     NOT NULL,
  executed_at  timestamptz NOT NULL,
  fee          numeric     NOT NULL DEFAULT 0,
  swap_funding numeric     NOT NULL DEFAULT 0,
  source       text        NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_executions_pkey PRIMARY KEY (id),
  CONSTRAINT tj_executions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_executions_position_id_fkey FOREIGN KEY (position_id)
    REFERENCES public.tj_positions(id) ON DELETE CASCADE,
  CONSTRAINT tj_executions_side_check
    CHECK (side = ANY (ARRAY['entry'::text, 'exit'::text])),
  CONSTRAINT tj_executions_qty_check CHECK (qty > 0::numeric),
  CONSTRAINT tj_executions_source_check
    CHECK (source = ANY (ARRAY['manual'::text, 'import'::text]))
);
CREATE INDEX IF NOT EXISTS tj_executions_user_idx
  ON public.tj_executions USING btree (user_id);
CREATE INDEX IF NOT EXISTS tj_executions_position_idx
  ON public.tj_executions USING btree (position_id);


-- -----------------------------------------------------------------------------
-- tj_instruments — ugovorna specifikacija. point_value nema fallback na 1:
-- vidi 20260728120000_snapshot_instrument_spec.sql za razlog.
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
  -- Preimenovana iz `currency` u 20260815130000_quote_currency_and_fx.sql.
  -- Ovaj fajl je do 21.08. i dalje pisao staro ime — nađeno tek kad se
  -- 20260821120000_bot_ingest.sql oslonio na njega i pokušao da čita kolonu
  -- koje nema. Zapis koji zaostane za bazom je gori od nepostojećeg: veruje mu
  -- se.
  quote_currency text     NOT NULL DEFAULT 'USD',
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tj_instruments_pkey PRIMARY KEY (id),
  CONSTRAINT tj_instruments_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_instruments_user_id_symbol_key UNIQUE (user_id, symbol),
  CONSTRAINT tj_instruments_point_value_positive
    CHECK (point_value IS NULL OR point_value > 0::numeric),
  CONSTRAINT tj_instruments_tick_size_positive
    CHECK (tick_size IS NULL OR tick_size > 0::numeric),
  CONSTRAINT tj_instruments_tick_value_positive
    CHECK (tick_value IS NULL OR tick_value > 0::numeric),
  CONSTRAINT tj_instruments_quote_currency_format
    CHECK (quote_currency ~ '^[A-Z]{3}$')
);
CREATE INDEX IF NOT EXISTS tj_instruments_user_idx
  ON public.tj_instruments USING btree (user_id);


-- -----------------------------------------------------------------------------
-- tj_trade_images — TradingView snapshot-i, jedan po vrsti po trejdu
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tj_trade_images (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL DEFAULT auth.uid(),
  position_id uuid        NOT NULL,
  kind        text        NOT NULL DEFAULT 'ltf_pre',
  caption     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  image_url   text        NOT NULL,
  CONSTRAINT tj_trade_images_pkey PRIMARY KEY (id),
  CONSTRAINT tj_trade_images_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_trade_images_position_id_fkey FOREIGN KEY (position_id)
    REFERENCES public.tj_positions(id) ON DELETE CASCADE,
  CONSTRAINT tj_trade_images_kind_check CHECK (kind = ANY (ARRAY[
    'htf_pre'::text, 'ltf_pre'::text, 'ltf_post'::text])),
  CONSTRAINT tj_trade_images_url_check
    CHECK (image_url ~* '^https://www\.tradingview\.com/x/[a-z0-9]+/?$'::text)
);
CREATE INDEX IF NOT EXISTS tj_trade_images_user_idx
  ON public.tj_trade_images USING btree (user_id);
CREATE INDEX IF NOT EXISTS tj_trade_images_position_idx
  ON public.tj_trade_images USING btree (position_id);
CREATE UNIQUE INDEX IF NOT EXISTS tj_trade_images_position_kind_uidx
  ON public.tj_trade_images USING btree (position_id, kind);


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
  -- Boja kategorije; stavka bez svoje je nasleđuje (20260822154955).
  color      text,
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
  -- Rečenica uz stavku, koju korisnik piše sam (20260822220814).
  description text,
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
-- Uvoz: batch i redovi
--
-- `tj_column_mappings` je stajala ovde do 20260816140000, koja ju je obrisala
-- kao mrtvu šemu: RLS je bio na njoj, ali je nijedan red koda nije ni čitao ni
-- pisao. Ovaj fajl ju je opisivao još pet dana posle toga.
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
CREATE INDEX IF NOT EXISTS tj_import_batches_account_idx
  ON public.tj_import_batches USING btree (account_id);

CREATE TABLE IF NOT EXISTS public.tj_import_rows (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL DEFAULT auth.uid(),
  batch_id            uuid        NOT NULL,
  raw                 jsonb,
  parsed              jsonb,
  match_status        text        NOT NULL DEFAULT 'new',
  matched_position_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  prev_executions     jsonb,
  -- Bruto rezultat koji je merge zatekao, da ga `undoImportBatch` vrati
  -- zajedno sa `prev_executions`.
  prev_gross_pnl_override numeric,
  -- Da li je BAŠ OVAJ uvoz upisao target na trejd koji ga nije imao
  -- (20260918140000). Undo ga tada vraća na NULL; target koji je trejder uneo
  -- sam se ne dira, jer uvoz preko njega nikad ne piše.
  target_written      boolean     NOT NULL DEFAULT false,
  CONSTRAINT tj_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT tj_import_rows_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT tj_import_rows_batch_id_fkey FOREIGN KEY (batch_id)
    REFERENCES public.tj_import_batches(id) ON DELETE CASCADE,
  CONSTRAINT tj_import_rows_matched_position_id_fkey FOREIGN KEY (matched_position_id)
    REFERENCES public.tj_positions(id) ON DELETE SET NULL,
  -- 'suggested' dodat u 20260918140000: red je prepoznat kao trejd koji već
  -- postoji, ali bez vremena — v. `import-match.ts`.
  CONSTRAINT tj_import_rows_match_status_check CHECK (match_status = ANY (ARRAY[
    'new'::text, 'match'::text, 'suggested'::text, 'ambiguous'::text, 'duplicate'::text]))
);
CREATE INDEX IF NOT EXISTS tj_import_rows_user_idx
  ON public.tj_import_rows USING btree (user_id);
CREATE INDEX IF NOT EXISTS tj_import_rows_batch_idx
  ON public.tj_import_rows USING btree (batch_id);
CREATE INDEX IF NOT EXISTS tj_import_rows_matched_position_idx
  ON public.tj_import_rows USING btree (matched_position_id);

COMMENT ON COLUMN public.tj_import_rows.prev_executions IS
  'Executions replaced by a merge decision, captured so undo can restore them. '
  'NULL for create/skip rows and for batches predating this column.';


-- -----------------------------------------------------------------------------
-- Row-level security — isti vlasnički obrazac na svih devet
--
-- `(SELECT auth.uid())` a ne goli `auth.uid()`: potprogram u SELECT-u planer
-- izvršava jednom po upitu umesto jednom po redu (20260720160000).
-- -----------------------------------------------------------------------------
ALTER TABLE public.tj_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_positions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_executions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_instruments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_trade_images    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_option_lists    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_option_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_import_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_import_rows     ENABLE ROW LEVEL SECURITY;

-- tj_accounts        → tj_accounts_owner
-- tj_positions       → tj_positions_owner
-- tj_executions      → tj_executions_owner
-- tj_instruments     → tj_instruments_owner
-- tj_trade_images    → tj_images_owner
-- tj_option_lists    → tj_lists_owner
-- tj_option_items    → tj_items_owner
-- tj_import_batches  → tj_batches_owner
-- tj_import_rows     → tj_rows_owner
--
-- Svaka je istovetna:
--   CREATE POLICY <ime> ON public.<tabela>
--     FOR ALL TO authenticated
--     USING       (user_id = (SELECT auth.uid()))
--     WITH CHECK  (user_id = (SELECT auth.uid()));


-- -----------------------------------------------------------------------------
-- Okidači nad baznim tabelama
--
-- Telo funkcija je u migracijama (`20260730140000_integrity_guards.sql`), samo
-- vezivanje je ovde.
--
-- tj_execution_guard postoji jer RLS sam nije dovoljan: strani ključ proverava
-- samo da pozicija POSTOJI, pa je vlasnik svog fill-a mogao da ga zakači na
-- tuđu poziciju i time zagadi tuđ tj_position_stats.
-- -----------------------------------------------------------------------------
-- CREATE TRIGGER tj_positions_set_updated_at BEFORE UPDATE ON public.tj_positions
--   FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();
-- CREATE TRIGGER tj_positions_missed_guard BEFORE INSERT OR UPDATE OF status
--   ON public.tj_positions FOR EACH ROW EXECUTE FUNCTION public.tj_position_missed_guard();
-- CREATE TRIGGER tj_executions_guard BEFORE INSERT OR UPDATE OF position_id, user_id
--   ON public.tj_executions FOR EACH ROW EXECUTE FUNCTION public.tj_execution_guard();
