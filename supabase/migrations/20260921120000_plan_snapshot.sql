-- The plan, frozen the moment the money went on.
--
-- WHY. The day locks (`tj_daily_reports.locked_at`), the week locks
-- (`tj_weekly_reviews.locked_at`), and the trade plan never did. `entry_price`,
-- `stop_price`, `target_price`, `thesis`, `invalidation`, `time_stop_days` and
-- `risk_pct` stayed editable forever with no history — and every "plan versus
-- reality" figure is built on them: entry slippage, target attainment, delta R,
-- the `thesis_written` tracker rule. On a single-user system that makes the
-- whole comparison falsifiable by the only person it measures.
--
-- A SNAPSHOT RATHER THAN A LOCK, and the difference is the point. A lock
-- forbids the edit, which only moves it to "unlock, then change" while blocking
-- the honest correction of a typo. The snapshot makes the correction harmless
-- instead: the figures read what was sealed at entry, so they cannot be
-- improved once the outcome is known, the live fields stay editable so the
-- trade can still be made accurate, and an edit after the seal is stamped so
-- the screen can say it happened.
--
-- Three columns, no backfill. History has no seal and must not pretend to one:
-- a snapshot invented today from today's values would be exactly the claim this
-- column exists to make impossible. Readers fall back to the live fields when
-- `plan_snapshot IS NULL`, which is every trade written before this migration.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS plan_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS plan_sealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_amended_at timestamptz;

COMMENT ON COLUMN public.tj_positions.plan_snapshot IS
  'The plan fields as they stood when the trade first got an entry fill. '
  'Written once by lib/journal/plan-snapshot.ts, never overwritten, cleared '
  'when the last fill is removed. NULL means the trade predates the seal or '
  'was never entered; readers then fall back to the live columns.';

COMMENT ON COLUMN public.tj_positions.plan_sealed_at IS
  'When plan_snapshot was taken — the first entry fill''s save.';

COMMENT ON COLUMN public.tj_positions.plan_amended_at IS
  'First time a sealed plan field was changed afterwards. The trade then '
  'carries a visible badge; the measurements keep reading the seal.';

-- A snapshot is an object or nothing. A scalar or an array here would be a
-- write from somewhere that does not know what this column is.
ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_plan_snapshot_object;

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_plan_snapshot_object
  CHECK (plan_snapshot IS NULL OR jsonb_typeof(plan_snapshot) = 'object');

-- `tj_merge_positions` completes the survivor's plan columns from the discarded
-- row with COALESCE, and the survivor may already have fills — which would move
-- a sealed plan silently. Restated VERBATIM from 20260920160000 with three
-- lines added and nothing else touched: the body is long, and every earlier
-- restatement in this repo that was typed from memory dropped a clause
-- (20260919200000 exists only because of one).
CREATE OR REPLACE FUNCTION public.tj_merge_positions(
  p_keep       uuid,
  p_fills_from uuid
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
DECLARE
  v_keep  record;
  v_other record;
BEGIN
  IF p_keep = p_fills_from THEN
    RAISE EXCEPTION 'A trade cannot be merged into itself.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_keep  FROM public.tj_positions WHERE id = p_keep;
  SELECT * INTO v_other FROM public.tj_positions WHERE id = p_fills_from;

  IF v_keep.id IS NULL OR v_other.id IS NULL THEN
    RAISE EXCEPTION 'Trade not found.' USING ERRCODE = 'no_data_found';
  END IF;

  -- The same three refusals `mergeRefusal` makes in the dialog, restated where
  -- they are enforced. A client that skipped the dialog is not a reason to
  -- destroy a trade.
  IF v_keep.instrument IS DISTINCT FROM v_other.instrument THEN
    RAISE EXCEPTION 'Different instruments are not one trade.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF lower(COALESCE(v_keep.direction, '')) IS DISTINCT FROM lower(COALESCE(v_other.direction, '')) THEN
    RAISE EXCEPTION 'A long and a short are not one trade.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_keep.account_id IS DISTINCT FROM v_other.account_id THEN
    RAISE EXCEPTION 'These trades are on two different accounts.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1) Fills, whole ------------------------------------------------------------
  DELETE FROM public.tj_executions WHERE position_id = p_keep;
  UPDATE public.tj_executions SET position_id = p_keep WHERE position_id = p_fills_from;

  -- 2) Children with a unique key per position ---------------------------------
  --
  -- Each of these three has a UNIQUE (position_id, <something>), so a row can
  -- only move across when the survivor has nothing under that key. The rest go
  -- with the delete at the end — the survivor's own answer wins, because it is
  -- the one whose judgement is being kept.
  UPDATE public.tj_trade_images i
     SET position_id = p_keep
   WHERE i.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_trade_images k
        WHERE k.position_id = p_keep AND k.kind = i.kind
     );

  UPDATE public.tj_position_rules r
     SET position_id = p_keep
   WHERE r.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_rules k
        WHERE k.position_id = p_keep AND k.rule_id = r.rule_id
     );

  -- A check-in on a LOCKED day cannot move, and its guard raises rather than
  -- skipping. That is the right answer: a locked day is a day the trader
  -- declared finished, and this transaction stops instead of half-merging.
  UPDATE public.tj_position_checkins c
     SET position_id = p_keep
   WHERE c.position_id = p_fills_from
     AND NOT EXISTS (
       SELECT 1 FROM public.tj_position_checkins k
        WHERE k.position_id = p_keep AND k.report_date = c.report_date
     );

  UPDATE public.tj_notes       SET position_id = p_keep WHERE position_id = p_fills_from;
  UPDATE public.tj_import_rows SET matched_position_id = p_keep WHERE matched_position_id = p_fills_from;

  -- 3) The surviving row -------------------------------------------------------
  --
  -- Money follows the fills, including to NULL: an override describing fills
  -- that are no longer here is a wrong number presented as fact. The instrument
  -- snapshot travels with it for the same reason — it is what those fills were
  -- priced with.
  UPDATE public.tj_positions k SET
    status                  = v_other.status,
    needs_review            = v_other.needs_review,
    gross_pnl_override      = v_other.gross_pnl_override,
    point_value_at_trade    = COALESCE(v_other.point_value_at_trade, k.point_value_at_trade),
    tick_size_at_trade      = COALESCE(v_other.tick_size_at_trade, k.tick_size_at_trade),
    quote_currency_at_trade = COALESCE(v_other.quote_currency_at_trade, k.quote_currency_at_trade),
    fx_rate_at_trade        = COALESCE(v_other.fx_rate_at_trade, k.fx_rate_at_trade),

    -- Plan and judgement: completed, never overwritten.
    entry_price         = COALESCE(k.entry_price, v_other.entry_price),
    stop_price          = COALESCE(k.stop_price, v_other.stop_price),
    target_price        = COALESCE(k.target_price, v_other.target_price),
    risk_pct            = COALESCE(k.risk_pct, v_other.risk_pct),
    planned_rr          = COALESCE(k.planned_rr, v_other.planned_rr),
    position_size       = COALESCE(k.position_size, v_other.position_size),
    setup_grade         = COALESCE(k.setup_grade, v_other.setup_grade),
    conviction          = COALESCE(k.conviction, v_other.conviction),
    execution_rating    = COALESCE(k.execution_rating, v_other.execution_rating),
    exit_reason         = COALESCE(k.exit_reason, v_other.exit_reason),
    thesis              = COALESCE(k.thesis, v_other.thesis),
    invalidation        = COALESCE(k.invalidation, v_other.invalidation),
    time_stop_days      = COALESCE(k.time_stop_days, v_other.time_stop_days),
    scale_out_plan      = COALESCE(k.scale_out_plan, v_other.scale_out_plan),
    trade_journal_notes = COALESCE(k.trade_journal_notes, v_other.trade_journal_notes),
    playbook_id         = COALESCE(k.playbook_id, v_other.playbook_id),
    miss_reason         = COALESCE(k.miss_reason, v_other.miss_reason),
    missed_at           = COALESCE(k.missed_at, v_other.missed_at),
    max_drawdown_price  = COALESCE(k.max_drawdown_price, v_other.max_drawdown_price),
    max_profit_price    = COALESCE(k.max_profit_price, v_other.max_profit_price),
    equity_at_entry     = COALESCE(k.equity_at_entry, v_other.equity_at_entry),

    -- The seal travels with the SURVIVING trade and is never taken from the
    -- other one: a plan this trade never made is not its plan. Without these
    -- three lines the COALESCE list above would quietly move a sealed plan —
    -- at the one place nobody looks.
    plan_snapshot       = k.plan_snapshot,
    plan_sealed_at      = k.plan_sealed_at,
    plan_amended_at     = k.plan_amended_at,

    -- Tags: two lists about one trade are one list, deduped and without empties.
    mistake = ARRAY(
      SELECT DISTINCT t FROM unnest(k.mistake || v_other.mistake) AS t WHERE t <> ''
    ),
    technical_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.technical_tags || v_other.technical_tags) AS t WHERE t <> ''
    ),
    psychology_tags = ARRAY(
      SELECT DISTINCT t FROM unnest(k.psychology_tags || v_other.psychology_tags) AS t WHERE t <> ''
    ),

    -- User-defined fields: the survivor's answers win key by key.
    custom = v_other.custom || k.custom,
    -- A ladder is a plan, so it is completed rather than merged: two ladders for
    -- one trade would add up to more than the trade.
    scale_out_levels = CASE
      WHEN jsonb_array_length(COALESCE(k.scale_out_levels, '[]'::jsonb)) > 0
        THEN k.scale_out_levels
      ELSE COALESCE(v_other.scale_out_levels, '[]'::jsonb)
    END,
    updated_at = now()
  WHERE k.id = p_keep;

  -- 4) And the other one is gone -----------------------------------------------
  DELETE FROM public.tj_positions WHERE id = p_fills_from;
END;
$function$;

-- The SQL twin of `sealedNumber` in lib/journal/plan-snapshot.ts.
--
-- Same three rules, in the same order, because two implementations that
-- disagree would give one trade two R values: a key the seal does not carry
-- falls back to the live column; a key it carries is used even when it holds
-- null (a plan that deliberately had no stop must not borrow one typed later);
-- and anything that is not a number reads as null rather than raising, since a
-- view that throws would take every screen down with it.
CREATE OR REPLACE FUNCTION public.tj_sealed_num(
  p_snapshot jsonb,
  p_key      text,
  p_live     numeric
) RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_snapshot IS NULL OR NOT (p_snapshot ? p_key) THEN p_live
    WHEN jsonb_typeof(p_snapshot -> p_key) = 'number'
      THEN (p_snapshot ->> p_key)::numeric
    -- A number typed back as text, which is how a form field can arrive.
    WHEN jsonb_typeof(p_snapshot -> p_key) = 'string'
      AND (p_snapshot ->> p_key) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_snapshot ->> p_key)::numeric
    ELSE NULL
  END
$function$;

-- `tj_position_stats` is restated VERBATIM from
-- 20260815160000_gross_pnl_override.sql with exactly one line changed, marked
-- below. Nothing on the live database depends on the view (checked), so the
-- DROP is safe.

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
