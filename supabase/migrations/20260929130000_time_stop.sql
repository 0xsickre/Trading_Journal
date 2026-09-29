-- A day trade's time stop: minutes, or the session's close (F4, decision G3-A).
--
-- `time_stop_days` (1–5, 20260822090000) was the swing version: how many days a
-- position may live before the reason for it has expired. A day trader's
-- question is how many MINUTES a trade gets to start working, or whether it is
-- simply held to the close. The form stops offering days; the column stays for
-- the trades that carry it until H2 removes it.
--
-- TEXT with five values, not an integer with a magic number for "close": "held
-- to the close" and "not recorded" are different answers, and NULL can only be
-- one of them. The chips on the form are these five; the CHECK makes a sixth
-- impossible from any write path, PostgREST included.
--
-- The plan seal (`plan_snapshot`) carries it from the save that first gives the
-- trade fills — `PLAN_FIELDS` in `src/lib/journal/plan-snapshot.ts`.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS time_stop text;

ALTER TABLE public.tj_positions
  DROP CONSTRAINT IF EXISTS tj_positions_time_stop_choice;

ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_time_stop_choice
  CHECK (time_stop IS NULL OR time_stop IN ('5', '15', '30', '60', 'close'));

COMMENT ON COLUMN public.tj_positions.time_stop IS
  'Time stop of a day trade: 5 / 15 / 30 / 60 minutes, or close (held to the session end). Replaces time_stop_days.';
