-- The review moves from the DAY to the WEEK.
--
-- Phase 2 dropped eight questions from `tj_daily_reports` — the grade, whether a
-- rule was broken, what was learned, what to change tomorrow, the day overview,
-- the win to celebrate, the easiest setup. They were not deleted because they
-- are bad questions. They are good questions asked on the wrong clock.
--
-- A review answered mid-hold is answered without the outcome. On Wednesday of a
-- four-day position, "how did it go" can only be answered by reading the open
-- P&L — which is the single thing a process journal exists to stop you doing.
-- Asked once the week is over, the same question has facts behind it.
--
-- It is also five times less writing. The research this redesign came from is
-- blunt about the failure mode: journals asking twenty-plus fields a day get
-- abandoned inside a fortnight, and an abandoned journal measures nothing.

CREATE TABLE public.tj_weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The Monday of the ISO week, and the CHECK is not decoration. Every key in
  -- this app is a `yyyy-MM-dd` string, so nothing about the type would stop a
  -- caller storing Wednesday — and then the same week exists twice under two
  -- keys, with the unique constraint powerless to notice. `isodow` is 1 on
  -- Monday.
  week_start date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),

  -- Same six-point scale the day used, deliberately: it is the one the trader
  -- has already been reading, and re-basing it would make old habits of
  -- judgement misfire against new numbers.
  week_grade text CHECK (week_grade IN ('A', 'B', 'C', 'D', 'E', 'F')),

  went_well text,
  went_badly text,
  -- Singular on purpose, in both. A review that lists six patterns and six
  -- changes produces no change at all; naming one of each is what makes the
  -- next week's tracker rule obvious.
  one_pattern text,
  one_change text,
  -- Forward-looking, and the reason this is not just a retrospective: an
  -- intraweek swing book is exposed to whatever lands inside its holding
  -- window, so the week's calendar is a sizing input, not trivia.
  next_week_catalysts text,

  -- Set by `lockWeek`, never by the form's save. Same shape as
  -- `tj_daily_reports.locked_at`.
  locked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, week_start)
);

CREATE INDEX tj_weekly_reviews_user_week_idx
  ON public.tj_weekly_reviews (user_id, week_start);

ALTER TABLE public.tj_weekly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_weekly_reviews_owner ON public.tj_weekly_reviews
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_weekly_reviews_updated_at
  BEFORE UPDATE ON public.tj_weekly_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- The lock, in the database rather than only in the server action.
--
-- Same reasoning as `tj_daily_report_lock_guard`, which this is copied from:
-- PostgREST is a live write path holding the user's own JWT, and RLS grants the
-- owner everything. A lock enforced only in an action is a lock any curl walks
-- through.
--
-- Any update of a locked row raises, and UNLOCKING IS AN UPDATE. That is how
-- "irreversible" is expressed here. Setting the lock itself passes, because
-- OLD.locked_at is still null at that moment.

CREATE OR REPLACE FUNCTION public.tj_weekly_review_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.locked_at is not null then
    raise exception 'The week of % is locked and cannot be changed.', old.week_start
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE TRIGGER tj_weekly_reviews_lock_guard
  BEFORE UPDATE OR DELETE ON public.tj_weekly_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tj_weekly_review_lock_guard();

REVOKE ALL ON FUNCTION public.tj_weekly_review_lock_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_weekly_review_lock_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tj_weekly_review_lock_guard() FROM authenticated;

-- NOTE, deliberately: locking a week does NOT lock its days, and locking a day
-- does not lock its week. They are separate seals over separate statements —
-- the day says what you did, the week says what you make of it — and a trader
-- who sealed Monday should still be able to write Sunday's review of it.
