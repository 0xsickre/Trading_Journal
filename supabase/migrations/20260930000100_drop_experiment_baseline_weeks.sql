-- F5.4, second half: `baseline_weeks` goes, after the code that read and wrote it (20260930000000
-- explains the switch to `baseline_trades`). Its CHECK goes with it.

ALTER TABLE public.tj_experiments DROP CONSTRAINT IF EXISTS tj_experiments_baseline_positive;
ALTER TABLE public.tj_experiments DROP COLUMN IF EXISTS baseline_weeks;
