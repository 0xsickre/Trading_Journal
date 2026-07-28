-- Daily Report + Focus Goals (process journaling, isolated from trades)

CREATE TABLE public.tj_focus_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_text text NOT NULL,
  started_at date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  ended_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tj_focus_goals_one_active_per_user
  ON public.tj_focus_goals (user_id) WHERE is_active = true;

CREATE INDEX tj_focus_goals_user_idx ON public.tj_focus_goals (user_id);

CREATE TABLE public.tj_daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date date NOT NULL,

  day_grade text CHECK (day_grade IN ('A','B','C','D','E','F')),

  mental_temp smallint CHECK (mental_temp BETWEEN 1 AND 10),
  sleep_quality smallint CHECK (sleep_quality BETWEEN 1 AND 5),
  macro_note text,
  mantra_series boolean NOT NULL DEFAULT false,
  mantra_rules boolean NOT NULL DEFAULT false,
  mantra_risk boolean NOT NULL DEFAULT false,
  risk_accepted boolean NOT NULL DEFAULT false,
  mental_rehearsal text,
  market_type text CHECK (market_type IN (
    'bull_quiet', 'bull_volatile', 'bear_quiet', 'bear_volatile',
    'sideways_quiet', 'sideways_volatile'
  )),

  micromanage text CHECK (micromanage IN ('untouched', 'watched', 'violated')),
  impulse_fomo boolean NOT NULL DEFAULT false,
  impulse_fear boolean NOT NULL DEFAULT false,
  impulse_greed boolean NOT NULL DEFAULT false,
  impulse_fear_wrong boolean NOT NULL DEFAULT false,
  impulse_note text,

  rule_broken boolean,
  rule_broken_note text,
  learned_today text,
  tomorrow_change text,
  easiest_setup text,
  day_overview text,
  celebrate_win text,

  friday_flat boolean,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, report_date)
);

CREATE INDEX tj_daily_reports_user_date_idx
  ON public.tj_daily_reports (user_id, report_date DESC);

ALTER TABLE public.tj_focus_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_focus_goals_owner ON public.tj_focus_goals
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_daily_reports_owner ON public.tj_daily_reports
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Keep the hardening from 20260620102516_tj_harden_updated_at_fn: without an
-- explicit `SET search_path`, this CREATE OR REPLACE silently reverts the
-- function to a mutable search_path (advisor 0011_function_search_path_mutable).
CREATE OR REPLACE FUNCTION public.tj_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tj_focus_goals_updated_at
  BEFORE UPDATE ON public.tj_focus_goals
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TRIGGER tj_daily_reports_updated_at
  BEFORE UPDATE ON public.tj_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();
