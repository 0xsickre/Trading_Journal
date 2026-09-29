-- F5.4: the "before" window of an experiment is counted in TRADES, not weeks (the trader,
-- 29.09.2026: "Trejdovi").
--
-- WHY. The interval of the difference depends on n, not on the calendar. On a day trader's book
-- four weeks hold twenty trades in a quiet month and a hundred and twenty in a busy one, so two
-- experiments on the same book were compared on different ground. "Before" is now the last
-- `baseline_trades` trades closed before the start week (40 by default); the start stays a Monday,
-- because the weekly review is where the change is written, and "after" is every trade since.
--
-- ORDER. This adds the column; `baseline_weeks` is dropped by 20260930000100 once the code that
-- stopped writing it is deployed. Existing experiments take the default: their old "four weeks"
-- was a number of weeks, not of trades, and there is nothing to convert it into.

ALTER TABLE public.tj_experiments
  ADD COLUMN IF NOT EXISTS baseline_trades integer NOT NULL DEFAULT 40;

ALTER TABLE public.tj_experiments DROP CONSTRAINT IF EXISTS tj_experiments_baseline_trades_range;
ALTER TABLE public.tj_experiments
  ADD CONSTRAINT tj_experiments_baseline_trades_range
  CHECK (baseline_trades BETWEEN 10 AND 500);
