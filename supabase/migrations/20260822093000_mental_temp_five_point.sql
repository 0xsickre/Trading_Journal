-- Mental temperature: 1..10 becomes 1..5 stars.
--
-- WHY. Ten levels is a precision nobody has about their own head. Asked to
-- separate a 6 from a 7 every morning, a person answers noise, and the noise
-- then feeds a report dimension and an insight rule as if it were signal. Five
-- stars is the same scale the journal already uses for execution rating and
-- conviction, so the whole app now asks for judgement in one unit.
--
-- THE EXISTING VALUE IS TRANSLATED, NOT KEPT. This is the part that would be a
-- silent data corruption if skipped: on a 1..10 scale a 5 is BELOW average, and
-- on 1..5 the same digit is the maximum. Keeping it would flip its meaning
-- while leaving it looking untouched.
--
--   ceil(old / 2.0):  1-2 -> 1,  3-4 -> 2,  5-6 -> 3,  7-8 -> 4,  9-10 -> 5
--
-- That preserves relative position -- the middle of the old scale lands in the
-- middle of the new one. Measured before writing: one row carries a value, and
-- it is a 5, so exactly one cell moves and it moves to 3.
--
-- ONE STATEMENT, and that is a correctness requirement rather than tidiness.
-- The first draft split the translation across three UPDATEs by range, and it
-- was wrong twice: a 9 became 5 in the first pass and was then caught by the
-- pass for "= 5" and translated AGAIN down to 3, while 2 and 3 matched no pass
-- at all and kept their old-scale meaning. A single UPDATE reads each row's
-- original value once, so neither failure is expressible.
--
-- The CHECK is dropped before the UPDATE and re-added after, because the old
-- constraint permits 1..10 and the new one permits 1..5; doing it in the other
-- order would refuse the very rows the update exists to fix.

ALTER TABLE public.tj_daily_reports
  DROP CONSTRAINT IF EXISTS tj_daily_reports_mental_temp_check;

UPDATE public.tj_daily_reports
   SET mental_temp = ceil(mental_temp / 2.0)
 WHERE mental_temp IS NOT NULL;

ALTER TABLE public.tj_daily_reports
  ADD CONSTRAINT tj_daily_reports_mental_temp_check
  CHECK (mental_temp IS NULL OR (mental_temp >= 1 AND mental_temp <= 5));

COMMENT ON COLUMN public.tj_daily_reports.mental_temp IS
  'How ready you judged yourself that morning, 1..5 stars. NULL means not '
  'answered, which is different from 1. Read at ENTRY time by the '
  'low_mental_temp_entry insight and by the mental_temp report dimension.';
