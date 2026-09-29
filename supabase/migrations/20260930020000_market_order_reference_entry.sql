-- Market orders: R is measured from the fill for a trade logged after its entry (the trader,
-- 29.09.2026: "u glavnom ulazim market order" → "uradi sva tri").
--
-- WHY. `/trades/log` writes a trade after the close with the entry the trader types; the day's
-- TopstepX export later replaces the fills with the exact ones and the typed price stays, sealed as
-- the "plan". Every R was then divided by |typed entry − stop|, so a price typed 2.5 points off on a
-- 20-point stop moved R, risk and target attainment by 12 %, and "entry slippage" measured the
-- typing. A trade planned BEFORE its entry (a limit that waited) is unchanged.
--
-- WHAT CHANGES. Only `base.entry_price` in `tj_position_stats`: NULL when `created_at` is after the
-- first entry fill, so `risk_pts` falls back to `avg_entry`. The view is restated from
-- 20260929160000 with that one line; the column list is the same, so CREATE OR REPLACE keeps every
-- dependant. Nothing is rewritten in the table: undoing an import still restores exactly what was.

CREATE OR REPLACE VIEW public.tj_position_stats AS
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
    -- `risk_pts` below is the denominator of `realized_r` and `realized_r_net`,
    -- i.e. of every R in the application. It reads the SEALED plan
    -- (20260921120000) — and, since 20260930020000, NO planned entry for a
    -- trade written into the journal after its first fill (`created_at` after
    -- `opened_at`): a market order logged after the close had no planned price,
    -- the typed one is a reading the statement's fills replace, and R is then
    -- measured from the average fill (`COALESCE(entry_price, avg_entry)`).
    -- `plannedEntryOf` in `plan-snapshot.ts` is the TypeScript twin.
    CASE WHEN p.created_at > ex.opened_at THEN NULL
         ELSE public.tj_sealed_num(p.plan_snapshot, 'entry_price', p.entry_price)
    END AS entry_price,
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
