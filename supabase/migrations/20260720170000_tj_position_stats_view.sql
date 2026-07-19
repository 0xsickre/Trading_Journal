-- Canonical tj_position_stats view (versioned in repo).
-- R denominator: planned entry_price (fallback avg_entry); realized_r_net = net_pl / planned $ risk.

CREATE OR REPLACE VIEW public.tj_position_stats AS
WITH ex AS (
  SELECT
    e.position_id,
    sum(e.qty) FILTER (WHERE e.side = 'entry') AS entry_qty,
    sum(e.price * e.qty) FILTER (WHERE e.side = 'entry') AS entry_notional,
    sum(e.qty) FILTER (WHERE e.side = 'exit') AS exit_qty,
    sum(e.price * e.qty) FILTER (WHERE e.side = 'exit') AS exit_notional,
    sum(COALESCE(e.fee, 0::numeric)) AS total_fees,
    sum(COALESCE(e.swap_funding, 0::numeric)) AS total_swap,
    min(e.executed_at) FILTER (WHERE e.side = 'entry') AS opened_at,
    max(e.executed_at) FILTER (WHERE e.side = 'exit') AS closed_at
  FROM tj_executions e
  GROUP BY e.position_id
)
SELECT
  p.id AS position_id,
  p.user_id,
  p.account_id,
  p.instrument,
  p.direction,
  p.status,
  p.result,
  ex.entry_qty,
  ex.exit_qty,
  CASE
    WHEN ex.entry_qty > 0::numeric THEN ex.entry_notional / ex.entry_qty
    ELSE NULL::numeric
  END AS avg_entry,
  CASE
    WHEN ex.exit_qty > 0::numeric THEN ex.exit_notional / ex.exit_qty
    ELSE NULL::numeric
  END AS avg_exit,
  COALESCE(ex.total_fees, 0::numeric) AS total_fees,
  COALESCE(ex.total_swap, 0::numeric) AS total_swap,
  ex.opened_at,
  ex.closed_at,
  CASE
    WHEN ex.closed_at IS NOT NULL AND ex.opened_at IS NOT NULL
      THEN EXTRACT(epoch FROM ex.closed_at - ex.opened_at)
    ELSE NULL::numeric
  END AS duration_seconds,
  COALESCE(i.point_value, 1::numeric) AS point_value,
  CASE
    WHEN lower(COALESCE(p.direction, ''::text)) ~~ 'short%'::text THEN '-1'::integer
    ELSE 1
  END AS dir_mult,
  CASE
    WHEN ex.entry_qty > 0::numeric AND ex.exit_qty > 0::numeric
      THEN (ex.exit_notional - ex.entry_notional / ex.entry_qty * ex.exit_qty)
        * (
          CASE
            WHEN lower(COALESCE(p.direction, ''::text)) ~~ 'short%'::text THEN -1
            ELSE 1
          END
        )::numeric
    ELSE NULL::numeric
  END AS gross_points,
  CASE
    WHEN ex.entry_qty > 0::numeric AND ex.exit_qty > 0::numeric
      THEN (ex.exit_notional - ex.entry_notional / ex.entry_qty * ex.exit_qty)
        * (
          CASE
            WHEN lower(COALESCE(p.direction, ''::text)) ~~ 'short%'::text THEN -1
            ELSE 1
          END
        )::numeric
        * COALESCE(i.point_value, 1::numeric)
    ELSE NULL::numeric
  END AS gross_pl,
  CASE
    WHEN ex.entry_qty > 0::numeric AND ex.exit_qty > 0::numeric
      THEN (ex.exit_notional - ex.entry_notional / ex.entry_qty * ex.exit_qty)
        * (
          CASE
            WHEN lower(COALESCE(p.direction, ''::text)) ~~ 'short%'::text THEN -1
            ELSE 1
          END
        )::numeric
        * COALESCE(i.point_value, 1::numeric)
        - COALESCE(ex.total_fees, 0::numeric)
        - COALESCE(ex.total_swap, 0::numeric)
    ELSE NULL::numeric
  END AS net_pl,
  CASE
    WHEN ex.entry_qty > 0::numeric
      AND ex.exit_qty > 0::numeric
      AND p.stop_price IS NOT NULL
      AND abs(
        COALESCE(p.entry_price, ex.entry_notional / NULLIF(ex.entry_qty, 0)) - p.stop_price
      ) > 0::numeric
      THEN (ex.exit_notional - ex.entry_notional / ex.entry_qty * ex.exit_qty)
        * (
          CASE
            WHEN lower(COALESCE(p.direction, ''::text)) ~~ 'short%'::text THEN -1
            ELSE 1
          END
        )::numeric
        / (
          abs(
            COALESCE(p.entry_price, ex.entry_notional / NULLIF(ex.entry_qty, 0)) - p.stop_price
          ) * ex.entry_qty
        )
    ELSE NULL::numeric
  END AS realized_r,
  CASE
    WHEN ex.entry_qty > 0::numeric
      AND ex.exit_qty > 0::numeric
      AND p.stop_price IS NOT NULL
      AND abs(
        COALESCE(p.entry_price, ex.entry_notional / NULLIF(ex.entry_qty, 0)) - p.stop_price
      ) > 0::numeric
      THEN (
        (ex.exit_notional - ex.entry_notional / ex.entry_qty * ex.exit_qty)
          * (
            CASE
              WHEN lower(COALESCE(p.direction, ''::text)) ~~ 'short%'::text THEN -1
              ELSE 1
            END
          )::numeric
          * COALESCE(i.point_value, 1::numeric)
          - COALESCE(ex.total_fees, 0::numeric)
          - COALESCE(ex.total_swap, 0::numeric)
      )
      / (
        abs(
          COALESCE(p.entry_price, ex.entry_notional / NULLIF(ex.entry_qty, 0)) - p.stop_price
        ) * ex.entry_qty * COALESCE(i.point_value, 1::numeric)
      )
    ELSE NULL::numeric
  END AS realized_r_net
FROM tj_positions p
LEFT JOIN ex ON ex.position_id = p.id
LEFT JOIN tj_instruments i ON i.user_id = p.user_id AND i.symbol = p.instrument;
