-- Novac je do sada bio u VALUTI KOTACIJE, i sabirao se kao da nije.
--
-- `tj_position_stats` računa `gross_pl = gross_points * point_value`. Taj
-- proizvod je izražen u valuti u kojoj je instrument KOTIRAN, ne u valuti naloga:
--
--   EURUSD, 1 lot, pomeraj 0.0100  →  0.01 × 100 000 =    1 000 USD
--   USDJPY, 1 lot, pomeraj 1.00    →  1.00 × 100 000 =  100 000 JPY   ← jeni
--   EURGBP, 1 lot, pomeraj 0.0100  →  0.01 × 100 000 =    1 000 GBP   ← funte
--
-- Sve troje je do sada ulazilo u isti `sum()` i ispisivalo se sa `$`, jer
-- `format.ts` uzima simbol iz `account.currency` a broj ne dira. Dashboard je
-- sabirao dolare sa jenima. Napomena o tome stoji u `default-instruments.ts:4-8`
-- od početka — znalo se, ali se nije rešavalo.
--
-- `tj_instruments.currency` je sve vreme postojala. Nijedan red koda je nije
-- čitao za račun: ni view, ni `position-stats.ts`, ni `units.ts`. Bila je polje
-- u tipu i ništa više.
--
-- ŠTA SE OVDE UVODI
--
-- 1. `tj_instruments.quote_currency` — preimenovana `currency`. Ime je bilo
--    dvosmisleno („valuta čega?"), a upravo ta dvosmislenost je i dozvolila da
--    kolona stoji neupotrebljena.
--
-- 2. `tj_positions.quote_currency_at_trade` i `fx_rate_at_trade` — SNIMLJENI pri
--    upisu, po istom pravilu kao `point_value_at_trade`. Bez snimanja, današnji
--    kurs bi menjao prošlogodišnji P&L pri svakom otvaranju stranice — to je bag
--    `C1` koji je snapshot ugovorne specifikacije već jednom rešio.
--
-- 3. View množi novac kursom, a kad kurs ne može da se utvrdi vraća NULL i
--    prijavljuje `fx_rate_source = 'missing'`. Ista politika kao za
--    `point_value`: bolje ništa nego samouveren pogrešan broj.
--
-- ŠTA SE NAMERNO NE KONVERTUJE
--
-- `total_fees` i `total_swap` se vode u VALUTI NALOGA i ostaju nedirnuti.
-- Brokeri knjiže proviziju i swap u valuti depozita, ne kotacije, a i podrazumevane
-- vrednosti iz kojih se popunjavaju (`tj_accounts.default_commission_per_unit`,
-- `default_fee_fixed`, `default_swap_per_day`) su po nalogu. Zato je
--
--     net = bruto_u_kotaciji × kurs − provizije − swap
--
-- a ne `(bruto − troškovi) × kurs`. Redosled je bitan i zato stoji zapisan.

-- -----------------------------------------------------------------------------
-- 1) Instrument dobija nedvosmislenu valutu kotacije
-- -----------------------------------------------------------------------------
ALTER TABLE public.tj_instruments RENAME COLUMN currency TO quote_currency;

ALTER TABLE public.tj_instruments
  ADD CONSTRAINT tj_instruments_quote_currency_format
    CHECK (quote_currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN public.tj_instruments.quote_currency IS
  'Currency the instrument is QUOTED in — the currency of point_value, and so of '
  'every price-derived figure before conversion. USD for EURUSD and XAUUSD, JPY '
  'for USDJPY, GBP for EURGBP, EUR for GER40.';

COMMENT ON COLUMN public.tj_instruments.point_value IS
  'Money in quote_currency per 1.00 of price movement, per 1 unit of executed '
  'qty. Fixes what a "unit" means: 1 standard FX lot (EURUSD 100000), 1 CFD '
  'contract (SP500 1), 1 futures contract (ES 50 = tick_value 12.50 / tick_size '
  '0.25). qty on tj_executions is counted in those same units.';

-- Ispravka podataka. Sve je stajalo na 'USD' jer je to bio DEFAULT kolone koju
-- niko nije popunjavao — za USDJPY i USDCAD to je bilo netačno.
UPDATE public.tj_instruments SET quote_currency = 'JPY' WHERE symbol LIKE '%JPY';
UPDATE public.tj_instruments SET quote_currency = 'CAD' WHERE symbol = 'USDCAD';
UPDATE public.tj_instruments SET quote_currency = 'CHF' WHERE symbol = 'USDCHF';

-- -----------------------------------------------------------------------------
-- 2) Trejd nosi svoj kurs, zauvek
-- -----------------------------------------------------------------------------
ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS quote_currency_at_trade text,
  ADD COLUMN IF NOT EXISTS fx_rate_at_trade        numeric;

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_fx_rate_positive
    CHECK (fx_rate_at_trade IS NULL OR fx_rate_at_trade > 0),
  ADD CONSTRAINT tj_positions_quote_currency_format
    CHECK (quote_currency_at_trade IS NULL OR quote_currency_at_trade ~ '^[A-Z]{3}$');

COMMENT ON COLUMN public.tj_positions.quote_currency_at_trade IS
  'Instrument quote currency captured when the trade was written. Immutable, for '
  'the same reason as point_value_at_trade.';
COMMENT ON COLUMN public.tj_positions.fx_rate_at_trade IS
  'Quote currency → account currency rate, captured when the trade was written. '
  '1 when they are the same currency. Immutable: without it, today''s rate would '
  'silently move last year''s P&L on every page load.';

-- Backfill: postojeći trejdovi čija se valuta kotacije poklapa sa valutom naloga
-- dobijaju kurs 1. Bez ovoga bi svaki već upisan trejd propao u 'missing' i
-- prikazao prazno umesto broja koji je i do sada bio tačan.
UPDATE public.tj_positions p
   SET quote_currency_at_trade = COALESCE(p.quote_currency_at_trade, i.quote_currency),
       fx_rate_at_trade = COALESCE(
         p.fx_rate_at_trade,
         CASE WHEN i.quote_currency = a.currency THEN 1 END
       )
  -- Dve stavke u FROM-u, ne JOIN: uslov spajanja u `UPDATE ... FROM` ne sme da
  -- referiše ciljnu tabelu, pa `a.id = p.account_id` mora u WHERE.
  FROM public.tj_instruments i, public.tj_accounts a
 WHERE i.user_id = p.user_id
   AND i.symbol  = p.instrument
   AND a.id      = p.account_id
   AND (p.fx_rate_at_trade IS NULL OR p.quote_currency_at_trade IS NULL);

-- -----------------------------------------------------------------------------
-- 3) View: novac se konvertuje, R ostaje odnos
-- -----------------------------------------------------------------------------
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
    sum(COALESCE(e.swap_funding, 0::numeric)) AS total_swap,
    min(e.executed_at) FILTER (WHERE e.side = 'entry') AS opened_at,
    max(e.executed_at) FILTER (WHERE e.side = 'exit')  AS closed_at
  FROM public.tj_executions e
  GROUP BY e.position_id
),
base AS (
  SELECT
    p.id AS position_id,
    p.user_id,
    p.account_id,
    p.instrument,
    p.direction,
    p.status,
    p.entry_price,
    p.stop_price,
    ex.entry_qty,
    ex.exit_qty,
    ex.entry_notional,
    ex.exit_notional,
    COALESCE(ex.total_fees, 0::numeric) AS total_fees,
    COALESCE(ex.total_swap, 0::numeric) AS total_swap,
    ex.opened_at,
    ex.closed_at,
    CASE
      WHEN lower(COALESCE(p.direction, ''::text)) LIKE 'short%' THEN -1
      ELSE 1
    END AS dir_mult,
    -- Snapshot first, live instrument only as a fallback for rows written before
    -- the snapshot column existed. No literal default: see 20260728120000.
    COALESCE(p.point_value_at_trade, i.point_value) AS point_value,
    COALESCE(p.tick_size_at_trade,   i.tick_size)   AS tick_size,
    CASE
      WHEN p.point_value_at_trade IS NOT NULL THEN 'snapshot'
      WHEN i.point_value          IS NOT NULL THEN 'instrument'
      ELSE 'missing'
    END AS point_value_source,
    COALESCE(p.quote_currency_at_trade, i.quote_currency) AS quote_currency,
    a.currency AS account_currency,
    -- Isti redosled prioriteta kao za point_value: snimljeno pa živo. Jedinica
    -- se podrazumeva SAMO kad se valute stvarno poklapaju — nikad kao fallback
    -- za nepoznat kurs, jer bi 1 tiho izjednačila jen sa dolarom.
    COALESCE(
      p.fx_rate_at_trade,
      CASE
        WHEN COALESCE(p.quote_currency_at_trade, i.quote_currency) = a.currency
          THEN 1
      END
    ) AS fx_rate,
    CASE
      WHEN p.fx_rate_at_trade IS NOT NULL THEN 'snapshot'
      WHEN a.currency IS NULL THEN 'no_account'
      WHEN COALESCE(p.quote_currency_at_trade, i.quote_currency) = a.currency
        THEN 'same_currency'
      ELSE 'missing'
    END AS fx_rate_source
  FROM public.tj_positions p
  LEFT JOIN ex ON ex.position_id = p.id
  LEFT JOIN public.tj_instruments i
         ON i.user_id = p.user_id AND i.symbol = p.instrument
  LEFT JOIN public.tj_accounts a ON a.id = p.account_id
),
derived AS (
  SELECT
    b.*,
    CASE WHEN b.entry_qty > 0::numeric THEN b.entry_notional / b.entry_qty END AS avg_entry,
    CASE WHEN b.exit_qty  > 0::numeric THEN b.exit_notional  / b.exit_qty  END AS avg_exit,
    -- Realized move on the quantity actually closed, valued against the average
    -- entry — correct for partial exits and for scale-ins alike.
    CASE
      WHEN b.entry_qty > 0::numeric AND b.exit_qty > 0::numeric
        THEN (b.exit_notional - b.entry_notional / b.entry_qty * b.exit_qty)
             * b.dir_mult::numeric
    END AS gross_points
  FROM base b
),
risk AS (
  SELECT
    d.*,
    -- Planned stop distance: plan entry when present, average fill otherwise.
    -- NULLIF collapses a zero-width stop to NULL so R is undefined, not infinite.
    NULLIF(abs(COALESCE(d.entry_price, d.avg_entry) - d.stop_price), 0::numeric) AS risk_pts
  FROM derived d
),
money AS (
  SELECT
    r.*,
    -- Jedan izraz za bruto u valuti naloga, izveden jednom i korišćen četiri
    -- puta ispod — isti razlog zbog kojeg je `gross_points` izdvojen u CTE
    -- (20260728120000): aritmetika ne sme da se raziđe između kolona.
    r.gross_points * r.point_value * r.fx_rate AS gross_pl_acct
  FROM risk r
)
SELECT
  m.position_id,
  m.user_id,
  m.account_id,
  m.instrument,
  m.direction,
  m.status,
  m.entry_qty,
  m.exit_qty,
  m.avg_entry,
  m.avg_exit,
  m.total_fees,
  m.total_swap,
  m.opened_at,
  m.closed_at,
  CASE
    WHEN m.closed_at IS NOT NULL AND m.opened_at IS NOT NULL
      THEN EXTRACT(epoch FROM m.closed_at - m.opened_at)
  END AS duration_seconds,
  m.point_value,
  m.tick_size,
  m.point_value_source,
  m.quote_currency,
  m.account_currency,
  m.fx_rate,
  m.fx_rate_source,
  m.dir_mult,
  m.gross_points,
  m.gross_pl_acct AS gross_pl,
  -- Provizije i swap su već u valuti naloga i NE množe se kursom. Vidi zaglavlje.
  m.gross_pl_acct - m.total_fees - m.total_swap AS net_pl,
  -- R je odnos u prostoru cena: preživljava i nepoznat point_value i nepoznat kurs.
  m.gross_points / (m.risk_pts * m.entry_qty) AS realized_r,
  -- Neto R deli novac novcem, pa i imenilac mora u valutu naloga.
  (m.gross_pl_acct - m.total_fees - m.total_swap)
    / (m.risk_pts * m.entry_qty * m.point_value * m.fx_rate) AS realized_r_net
FROM money m;

-- Run with the QUERYING user's privileges so RLS on tj_positions / tj_executions /
-- tj_instruments / tj_accounts still applies. CREATE VIEW resets view options, so
-- this must be re-asserted after every rebuild (advisor 0010_security_definer_view).
ALTER VIEW public.tj_position_stats SET (security_invoker = on);

GRANT SELECT ON public.tj_position_stats TO anon, authenticated, service_role;
