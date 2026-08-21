-- Time stop gets an upper bound: 1..5 days.
--
-- WHAT WAS MISSING. `20260813090000_swing_thesis_and_time_stop.sql` reasoned
-- carefully about the LOWER bound -- zero means "close immediately", negative is
-- meaningless, NULL already says "no time stop" -- and then stopped. There has
-- never been an upper bound, in the database or in TypeScript, so `time_stop_days
-- = 400` was storable and would have read on the Daily check-in as a position
-- 397 days from a warning.
--
-- The owner's own rule closes it: holds longer than a week are no longer taken.
-- The form now offers exactly five buttons, and this is the half of that which
-- a form cannot enforce -- an importer, a future bot event or a hand-written
-- UPDATE all reach the column without passing the UI.
--
-- NO TYPESCRIPT UPPER BOUND, deliberately, following the precedent
-- `trade-input-schema.ts` already sets for `execution_rating`: a value the UI
-- cannot produce belongs in the database's care, not in a second check that has
-- to be kept in step with the first.
--
-- SAFE ON EXISTING DATA: measured before writing, zero rows carry a value at
-- all (`count(time_stop_days) = 0`), so nothing can fail the tightened check.
-- The migration still states the count it relied on, because "it was empty when
-- I looked" is the kind of claim that should be written down rather than
-- remembered.

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_time_stop_days_positive;

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_time_stop_days_positive
  CHECK (time_stop_days IS NULL OR (time_stop_days >= 1 AND time_stop_days <= 5));

COMMENT ON COLUMN public.tj_positions.time_stop_days IS
  'Exit deadline in days, 1..5. NULL means no time stop. Drives the Daily '
  'check-in ("day 3 of 5", amber past it) and the past_time_stop insight -- '
  'nothing on the trade form itself, which is why the field carries a hint.';
