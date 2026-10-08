-- Povratak za migrations/20261008120000_drop_weekly_experiments_focus.sql
--
-- ŠTA RADI: ponovo pravi tri PRAZNE tabele (tj_weekly_reviews, tj_experiments,
-- tj_focus_goals) u obliku koji su imale pre brisanja, sa RLS-om, okidačima i lock
-- guard funkcijom nedeljnog pregleda.
--
-- ŠTA NE RADI: podatke ne vraća — redovi su obrisani bez arhive (trejder,
-- 08.10.2026). Ako trebaju, vraćaju se iz noćnog R2 snimka (futures-trading,
-- tools/journal_backup.py) od pre migracije, tek posle ovog skripta. Ne vraća ni
-- tri DELETE reda u tj_reset_my_data: za to ponovo pokreni definiciju funkcije iz
-- migrations/20260929140000_drop_position_checkins.sql.
--
-- KADA GA NE POKRETATI: dok kod u journal-u ne čita ove tabele (posle faze M nijedna
-- ruta ih ne koristi) — prazne tabele bez koda samo vraćaju mrtvu šemu.

CREATE TABLE IF NOT EXISTS public.tj_weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  week_grade smallint CONSTRAINT tj_weekly_reviews_week_grade_check
    CHECK (week_grade IS NULL OR (week_grade >= 1 AND week_grade <= 5)),
  went_well text,
  went_badly text,
  one_pattern text,
  one_change text,
  next_week_catalysts text,
  previous_change_kept text CHECK (previous_change_kept IN ('yes', 'partly', 'no')),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS tj_weekly_reviews_user_week_idx
  ON public.tj_weekly_reviews (user_id, week_start);
ALTER TABLE public.tj_weekly_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tj_weekly_reviews_owner ON public.tj_weekly_reviews
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE TRIGGER tj_weekly_reviews_updated_at
  BEFORE UPDATE ON public.tj_weekly_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE OR REPLACE FUNCTION public.tj_weekly_review_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('tj.bypass_lock_guard', true) = 'on' then
    return coalesce(new, old);
  end if;
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

CREATE TABLE IF NOT EXISTS public.tj_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_week date NOT NULL,
  hypothesis text NOT NULL,
  metric_key text NOT NULL,
  baseline_trades integer NOT NULL DEFAULT 40,
  ended_week date,
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, started_week),
  CONSTRAINT tj_experiments_started_week_monday CHECK (EXTRACT(ISODOW FROM started_week) = 1),
  CONSTRAINT tj_experiments_ended_week_monday CHECK (ended_week IS NULL OR EXTRACT(ISODOW FROM ended_week) = 1),
  CONSTRAINT tj_experiments_ended_after_started CHECK (ended_week IS NULL OR ended_week >= started_week),
  CONSTRAINT tj_experiments_baseline_trades_range CHECK (baseline_trades BETWEEN 10 AND 500),
  CONSTRAINT tj_experiments_status CHECK (status IN ('running', 'kept', 'dropped')),
  CONSTRAINT tj_experiments_running_has_no_end CHECK ((status = 'running') = (ended_week IS NULL)),
  CONSTRAINT tj_experiments_metric_measurable CHECK (metric_key IN ('win_rate', 'profit_factor', 'expectancy'))
);
CREATE INDEX IF NOT EXISTS tj_experiments_user_week_idx
  ON public.tj_experiments (user_id, started_week DESC);
ALTER TABLE public.tj_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tj_experiments_owner ON public.tj_experiments
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE TRIGGER tj_experiments_updated_at
  BEFORE UPDATE ON public.tj_experiments
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TABLE IF NOT EXISTS public.tj_focus_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_text text NOT NULL,
  started_at date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  ended_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tj_focus_goals_one_active_per_user
  ON public.tj_focus_goals (user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS tj_focus_goals_user_idx ON public.tj_focus_goals (user_id);
ALTER TABLE public.tj_focus_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tj_focus_goals_owner ON public.tj_focus_goals
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE TRIGGER tj_focus_goals_updated_at
  BEFORE UPDATE ON public.tj_focus_goals
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();
