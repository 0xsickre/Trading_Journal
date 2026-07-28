-- C1: make historical P&L immutable.
--
-- tj_position_stats recomputed every past trade's money from a LIVE join against
-- tj_instruments. Three silent failures followed:
--
--   1. Editing an instrument's point_value in Settings retroactively rewrote the
--      P&L, R, drawdown and score of every trade ever taken on that symbol.
--   2. Deleting or renaming an instrument dropped the join, and COALESCE(..., 1)
--      quietly priced the trade in RAW POINTS — a 500-point ES win rendering as
--      $500 instead of $25,000, with no indication anything was wrong.
--   3. Import made this routine: normalizeInstrumentSymbol() passes through any
--      unrecognised broker symbol ("EUR/USD.pro" -> "EURUSDPRO"), matching no
--      instrument row.
--
-- A journal records what happened. The instrument table is current configuration.
-- They must not be the same number, so the contract spec is now snapshotted onto
-- the position at write time and the view prefers that snapshot.
--
-- The ", 1" fallback is deliberately gone. When neither a snapshot nor an
-- instrument can price a trade, every money column is NULL and point_value_source
-- reports 'missing' — the UI flags it instead of showing a confident wrong number.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS point_value_at_trade numeric,
  ADD COLUMN IF NOT EXISTS tick_size_at_trade   numeric;

COMMENT ON COLUMN public.tj_positions.point_value_at_trade IS
  'Instrument point value captured when the trade was written. Immutable: later '
  'edits to tj_instruments must not move historical P&L.';
COMMENT ON COLUMN public.tj_positions.tick_size_at_trade IS
  'Instrument tick size captured when the trade was written.';

-- Backfill from the current instrument table — the best information available for
-- rows written before the snapshot existed. From here on it stops moving.
UPDATE public.tj_positions p
   SET point_value_at_trade = i.point_value,
       tick_size_at_trade   = i.tick_size
  FROM public.tj_instruments i
 WHERE i.user_id = p.user_id
   AND i.symbol  = p.instrument
   AND p.point_value_at_trade IS NULL;

-- Rebuilt rather than replaced: the column list is reordered and the repeated
-- gross-points expression (previously spelled out four times, once per derived
-- column) is now computed once in a CTE, so the arithmetic cannot drift between
-- gross_pl, net_pl, realized_r and realized_r_net.
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
    p.result,
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
    -- the snapshot column existed. No literal default: see the header note.
    COALESCE(p.point_value_at_trade, i.point_value) AS point_value,
    COALESCE(p.tick_size_at_trade,   i.tick_size)   AS tick_size,
    CASE
      WHEN p.point_value_at_trade IS NOT NULL THEN 'snapshot'
      WHEN i.point_value          IS NOT NULL THEN 'instrument'
      ELSE 'missing'
    END AS point_value_source
  FROM public.tj_positions p
  LEFT JOIN ex ON ex.position_id = p.id
  LEFT JOIN public.tj_instruments i
         ON i.user_id = p.user_id AND i.symbol = p.instrument
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
)
SELECT
  r.position_id,
  r.user_id,
  r.account_id,
  r.instrument,
  r.direction,
  r.status,
  r.result,
  r.entry_qty,
  r.exit_qty,
  r.avg_entry,
  r.avg_exit,
  r.total_fees,
  r.total_swap,
  r.opened_at,
  r.closed_at,
  CASE
    WHEN r.closed_at IS NOT NULL AND r.opened_at IS NOT NULL
      THEN EXTRACT(epoch FROM r.closed_at - r.opened_at)
  END AS duration_seconds,
  r.point_value,
  r.tick_size,
  r.point_value_source,
  r.dir_mult,
  r.gross_points,
  r.gross_points * r.point_value AS gross_pl,
  r.gross_points * r.point_value - r.total_fees - r.total_swap AS net_pl,
  -- R is a price-space ratio, so it survives a missing point value.
  r.gross_points / (r.risk_pts * r.entry_qty) AS realized_r,
  (r.gross_points * r.point_value - r.total_fees - r.total_swap)
    / (r.risk_pts * r.entry_qty * r.point_value) AS realized_r_net
FROM risk r;

-- Run with the QUERYING user's privileges so RLS on tj_positions / tj_executions /
-- tj_instruments still applies. CREATE VIEW resets view options, so this must be
-- re-asserted after every rebuild (Supabase advisor 0010_security_definer_view).
ALTER VIEW public.tj_position_stats SET (security_invoker = on);

GRANT SELECT ON public.tj_position_stats TO anon, authenticated, service_role;
