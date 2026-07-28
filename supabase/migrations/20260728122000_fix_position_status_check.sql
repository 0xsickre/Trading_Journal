-- C4: allow the statuses the application actually writes.
--
-- tj_positions_status_check still read:
--
--   CHECK (status = ANY (ARRAY['open', 'partial', 'closed']))
--
-- but 20260721130000_trade_lifecycle_missed.sql introduced 'planned' and
-- 'missed' and never widened it. The whole plan/miss lifecycle therefore fails
-- against the database:
--
--   * createTrade() on a plan with no fills  -> computeStatus([]) = 'planned'
--   * markTradeMissed()                      -> 'missed'
--   * restoreTradeToPlanned()                -> 'planned'
--   * commitImport() on a row with no fills  -> 'planned'
--
-- all raise 23514 and surface as a generic "Insert failed". That migration's own
-- backfill (UPDATE ... SET status = 'planned') would have failed too — it only
-- passed because no row matched at the time.
--
-- The constraint is kept rather than dropped: it is what stops a typo'd status
-- reaching the table, and computeStatus() in trade-lifecycle.ts is the single
-- writer whose PositionStatus union this list must mirror.

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_status_check;

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_status_check
  CHECK (status = ANY (ARRAY[
    'planned'::text,
    'missed'::text,
    'open'::text,
    'partial'::text,
    'closed'::text
  ]));

-- Re-run the lifecycle backfill that could not have applied before: a position
-- with no fills was never actually open.
UPDATE public.tj_positions p
   SET status = 'planned'
 WHERE p.status = 'open'
   AND NOT EXISTS (
     SELECT 1 FROM public.tj_executions e WHERE e.position_id = p.id
   );
