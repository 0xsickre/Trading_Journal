-- Direktan unos rezultata, kao alternativa `price × point_value × kurs`.
--
-- Vlasnik je objasnio zašto je automatska FX konverzija (20260815130000) za
-- njegov način rada nepotrebna: ručni unos ionako prepisuje broj sa brokerovog
-- ekrana, a CSV izvoz iz platforme brokera već ima gotovu kolonu profita — u
-- OBA slučaja je broj koji vidi već konvertovan po kursu koji je broker koristio
-- u trenutku izvršenja, i on tu konverziju ne može ni da zna ni da ponovi.
--
-- Napetost koju ovo unosi, rečeno pošteno: README-ov princip „Trejd nije jedan
-- red" postoji baš zato da se novac nikad ne upiše dvaput — uvek se izvodi iz
-- fill-ova, da profit ne bi otišao svojim putem u odnosu na R-multiple.
-- `gross_pnl_override` je svesno, ograničeno odstupanje: MENJA odakle dolazi
-- novac, NE menja odakle dolazi R. `realized_r` ostaje računat iz cena bez
-- obzira da li je override postavljen — cene i dalje treba uneti, override
-- utiče samo na to kako se novac dobija iz njih.
--
-- PRAVILO
--
--   gross_pl = COALESCE(override, gross_points × point_value × fx_rate)
--   net_pl   = gross_pl − total_fees − total_swap                        (uvek)
--   realized_r = gross_points / (risk_pts × entry_qty)                   (uvek iz cena)
--   realized_r_net = i dalje traži point_value i kurs, čak i sa override-om —
--     R U NOVCU je odnos rizika u novcu, pa mu treba i imenilac u novcu. Ako
--     kurs nije poznat, realized_r_net ostaje null dok realized_r i net_pl
--     (sa override-om) mogu biti poznati. Ovo je legitiman razmak, ne bag:
--     možeš znati dolarski profit a da ne znaš dolarski rizik.
--
-- Ime namerno bez `_at_trade` sufiksa koji nose snapshot kolone
-- (`point_value_at_trade`, `fx_rate_at_trade`): one hvataju konfiguraciju u
-- trenutku pisanja bez učešća korisnika; ovo je prvorazredan uneti podatak, kao
-- `entry_price`.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS gross_pnl_override numeric;

COMMENT ON COLUMN public.tj_positions.gross_pnl_override IS
  'Bruto rezultat u valuti naloga, unet direktno (ručno ili iz CSV kolone '
  'Profit) umesto izveden iz cena × point_value × kurs. Kad je postavljen, '
  'zaobilazi FX konverziju u potpunosti. R ostaje računat iz cena, nezavisno.';

-- Undo uvoza mora da vrati i ovo, ne samo fill-ove.
--
-- `prev_executions` postoji od 20260727122000 baš zbog toga: uvoz koji spoji red
-- sa postojećim trejdom TRAJNO gazi ono što je tamo pisalo, pa undo bez snimka
-- nije povratak nego druga izmena. Isti razlog važi i za rezultat koji je
-- korisnik uneo rukom pre nego što je uvoz stigao da ga ispravi.
--
-- Zasebna kolona, a ne polje unutar `prev_executions`: taj jsonb je niz fill-ova
-- i ima svoj oblik, pa bi gurati skalar u njega značilo da ga svaki čitalac mora
-- raspakovati na dva načina.
ALTER TABLE public.tj_import_rows
  ADD COLUMN IF NOT EXISTS prev_gross_pnl_override numeric;

COMMENT ON COLUMN public.tj_import_rows.prev_gross_pnl_override IS
  'Rezultat koji je stajao na poziciji pre nego što ga je ovaj uvoz prepisao. '
  'NULL i kad ga nije bilo i kad red nije bio merge — undo u oba slučaja vraća '
  'NULL, što je tačno.';

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
    p.id AS position_id, p.user_id, p.account_id, p.instrument, p.direction, p.status,
    p.entry_price, p.stop_price, p.gross_pnl_override,
    ex.entry_qty, ex.exit_qty, ex.entry_notional, ex.exit_notional,
    COALESCE(ex.total_fees, 0::numeric) AS total_fees,
    COALESCE(ex.total_swap, 0::numeric) AS total_swap,
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
  m.entry_qty, m.exit_qty, m.avg_entry, m.avg_exit, m.total_fees, m.total_swap,
  m.opened_at, m.closed_at,
  CASE WHEN m.closed_at IS NOT NULL AND m.opened_at IS NOT NULL
    THEN EXTRACT(epoch FROM m.closed_at - m.opened_at) END AS duration_seconds,
  m.point_value, m.tick_size, m.point_value_source,
  m.quote_currency, m.account_currency, m.fx_rate, m.fx_rate_source,
  (m.gross_pnl_override IS NOT NULL) AS money_overridden,
  m.dir_mult, m.gross_points,
  m.gross_pl_acct AS gross_pl,
  m.gross_pl_acct - m.total_fees - m.total_swap AS net_pl,
  -- R je odnos u prostoru cena, nezavisan od override-a.
  m.gross_points / (m.risk_pts * m.entry_qty) AS realized_r,
  -- Neto R u novcu i dalje traži point_value i kurs za imenilac, čak i kad je
  -- gross_pl poznat preko override-a. Ostaje null dok kurs nije poznat — to je
  -- razmak, ne bag: dolarski profit se može znati bez dolarskog rizika.
  (m.gross_pl_acct - m.total_fees - m.total_swap)
    / (m.risk_pts * m.entry_qty * m.point_value * m.fx_rate) AS realized_r_net
FROM money m;

ALTER VIEW public.tj_position_stats SET (security_invoker = on);

GRANT SELECT ON public.tj_position_stats TO anon, authenticated, service_role;
