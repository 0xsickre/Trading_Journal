-- The daily entry moves from the DAY to the POSITION.
--
-- `tj_daily_reports` was built as a day trader's form: rate the day, how did you
-- sleep, what did you rehearse, what did you learn. That works when the day
-- closes flat and the outcome is known by the bell. This book holds 2–5 days,
-- so on Wednesday the outcome is not in yet — and rating a day mid-hold reads
-- the P&L, which is the thing the process journal exists to stop doing.
--
-- What actually changes from one day to the next while a swing is open is: did
-- the reason for holding it survive today, and did I touch it. That is a fact
-- about the POSITION, not about the day.
--
-- THE CORRECTION THIS MAKES, and the reason it is not just a move:
--
-- `micromanage` was a column on the DAY. Hold two positions, touch one, and the
-- `micromanage` report dimension — which reads the whole holding window and lets
-- the worst state win — tags BOTH as violated. The untouched one is convicted by
-- the calendar. One row per position per day makes that impossible to express.
--
-- The book is empty, so columns are dropped outright rather than deprecated.

-- 1) Per-position, per-day check-in -----------------------------------------

CREATE TABLE public.tj_position_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id uuid NOT NULL REFERENCES public.tj_positions(id) ON DELETE CASCADE,
  report_date date NOT NULL,

  -- Nullable on purpose: a row may exist carrying only a note, and "I have not
  -- judged the thesis today" is a different statement from "the thesis is
  -- intact". Defaulting to intact would manufacture agreement nobody gave.
  thesis_state text CHECK (thesis_state IN ('intact', 'weakened', 'invalidated')),
  touched text CHECK (touched IN ('untouched', 'stop_moved', 'partial_exit', 'added')),
  note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (position_id, report_date)
);

CREATE INDEX tj_position_checkins_user_date_idx
  ON public.tj_position_checkins (user_id, report_date);

ALTER TABLE public.tj_position_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_position_checkins_owner ON public.tj_position_checkins
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_position_checkins_updated_at
  BEFORE UPDATE ON public.tj_position_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- 2) The lock reaches here too ----------------------------------------------
--
-- A locked day is sealed. `tj_daily_reports` and `tj_tracker_checkins` each
-- already refuse writes once `locked_at` is set; without the same guard here,
-- the position notes of a "frozen" day stay editable — the lock would be
-- telling the truth about two tables out of three.
--
-- Same shape as `tj_tracker_checkin_lock_guard`, same errcode, over this table.
-- `tj_lock_day` is deliberately NOT changed: it freezes AUTOMATIC verdicts into
-- rows so a later trade edit cannot move them, and these check-ins are all
-- hand-entered — there is no derived value here to freeze, only writes to refuse.

CREATE OR REPLACE FUNCTION public.tj_position_checkin_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d date := coalesce(new.report_date, old.report_date);
  u uuid := coalesce(new.user_id, old.user_id);
begin
  if exists (
    select 1 from public.tj_daily_reports
    where user_id = u and report_date = d and locked_at is not null
  ) then
    raise exception 'Day % is locked — position check-ins are frozen.', d
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE TRIGGER tj_position_checkins_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.tj_position_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tj_position_checkin_lock_guard();

-- 3) What the daily report stops asking -------------------------------------
--
-- Seventeen columns. Each is dropped for one of three reasons:
--
--   MOVED TO THE POSITION — `micromanage`. See the note at the top.
--
--   MOVED TO THE WEEK (phase 3) — `day_grade`, `rule_broken`,
--   `rule_broken_note`, `learned_today`, `tomorrow_change`, `easiest_setup`,
--   `day_overview`, `celebrate_win`. These are review questions, and a review
--   answered mid-hold is answered without the outcome. They are the same
--   questions; they are asked once a week instead of five times.
--
--   NOT A SWING QUESTION — `sleep_quality`, `mental_rehearsal`, `market_type`,
--   `friday_flat`. Friction with no reader: nothing in the app grouped, scored
--   or surfaced any of them.
--
--   ALREADY SOMEWHERE ELSE — `mantra_series`, `mantra_rules`, `mantra_risk`,
--   `risk_accepted`. Migration 20260801120000 turned the Douglas mantras into
--   tracker rules; these columns have been a second copy since.
--
-- `mental_temp` STAYS, and deliberately so: it is a gate read BEFORE entering,
-- not a diary entry, and both `dimensions.ts` and the `low_mental_temp_entry`
-- insight already read it. `macro_note` stays but is re-asked — "what is on the
-- calendar between now and my planned exit" rather than "macro events today",
-- because the holding window is what a swing position is exposed to.

ALTER TABLE public.tj_daily_reports
  DROP COLUMN IF EXISTS day_grade,
  DROP COLUMN IF EXISTS sleep_quality,
  DROP COLUMN IF EXISTS mental_rehearsal,
  DROP COLUMN IF EXISTS market_type,
  DROP COLUMN IF EXISTS micromanage,
  DROP COLUMN IF EXISTS rule_broken,
  DROP COLUMN IF EXISTS rule_broken_note,
  DROP COLUMN IF EXISTS learned_today,
  DROP COLUMN IF EXISTS tomorrow_change,
  DROP COLUMN IF EXISTS easiest_setup,
  DROP COLUMN IF EXISTS day_overview,
  DROP COLUMN IF EXISTS celebrate_win,
  DROP COLUMN IF EXISTS friday_flat,
  DROP COLUMN IF EXISTS mantra_series,
  DROP COLUMN IF EXISTS mantra_rules,
  DROP COLUMN IF EXISTS mantra_risk,
  DROP COLUMN IF EXISTS risk_accepted;
