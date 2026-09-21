-- The weekly change gets an outcome.
--
-- WHY. The weekly review asks for "one thing I am changing" and the next week
-- asks whether it was kept. Both answers are the trader's own word about the
-- trader's own behaviour; nothing ever asked the BOOK whether the change did
-- anything. A loop that records an intention and never checks the result is
-- not a loop, it is a diary.
--
-- An experiment is a week, a sentence and ONE metric. Everything else is
-- derived from the trades: the two windows, the two figures, the gap and its
-- interval all come out of `lib/journal/experiments.ts` at read time. Nothing
-- is stored here that the book already knows — a stored result would be a
-- second copy of a number, free to drift from the trades it came from, which
-- is the mistake `tj_position_stats` exists to prevent.
--
-- `metric_key` is restricted to the three metrics that carry a confidence
-- interval. An experiment on net P&L would always be "different" and always be
-- noise; the CHECK makes that a refusal rather than a convention.

CREATE TABLE IF NOT EXISTS public.tj_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The Monday it starts. A week is the unit the review already works in, and
  -- an experiment that started on a Wednesday could not be compared against
  -- whole weeks of history.
  started_week date NOT NULL,
  hypothesis text NOT NULL,
  metric_key text NOT NULL,
  baseline_weeks integer NOT NULL DEFAULT 4,

  -- The Monday of the last week it covers. NULL exactly while it runs.
  ended_week date,
  status text NOT NULL DEFAULT 'running',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One experiment per week. Two changes started in the same week cannot be
  -- told apart afterwards — whichever number moved, both would claim it.
  UNIQUE (user_id, started_week),

  CONSTRAINT tj_experiments_started_week_monday
    CHECK (EXTRACT(ISODOW FROM started_week) = 1),
  CONSTRAINT tj_experiments_ended_week_monday
    CHECK (ended_week IS NULL OR EXTRACT(ISODOW FROM ended_week) = 1),
  CONSTRAINT tj_experiments_ended_after_started
    CHECK (ended_week IS NULL OR ended_week >= started_week),
  CONSTRAINT tj_experiments_baseline_positive
    CHECK (baseline_weeks > 0),
  CONSTRAINT tj_experiments_status
    CHECK (status IN ('running', 'kept', 'dropped')),
  -- Running and ended are the same fact said twice; they may not disagree.
  CONSTRAINT tj_experiments_running_has_no_end
    CHECK ((status = 'running') = (ended_week IS NULL)),
  CONSTRAINT tj_experiments_metric_measurable
    CHECK (metric_key IN ('win_rate', 'profit_factor', 'expectancy'))
);

CREATE INDEX IF NOT EXISTS tj_experiments_user_week_idx
  ON public.tj_experiments (user_id, started_week DESC);

ALTER TABLE public.tj_experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tj_experiments_owner ON public.tj_experiments;
CREATE POLICY tj_experiments_owner ON public.tj_experiments
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP TRIGGER IF EXISTS tj_experiments_updated_at ON public.tj_experiments;
CREATE TRIGGER tj_experiments_updated_at
  BEFORE UPDATE ON public.tj_experiments
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

COMMENT ON TABLE public.tj_experiments IS
  'One deliberate change per week, with the metric that would move if it '
  'worked. Measured at read time from the trades; nothing derived is stored.';

-- `tj_reset_my_data` keeps its table list BY HAND, and its own comment says so.
-- A new table that is not added here survives "delete all my data", which is
-- the one promise that must not be kept only approximately. Restated verbatim
-- from 20260919200000_reset_sets_lock_bypass.sql with ONE line added.

CREATE OR REPLACE FUNCTION public.tj_reset_my_data()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The lock guards (a locked day, a locked week) and the system "Trade Notes"
  -- folder refuse deletes unless this is set, and they are right to — except
  -- here, where the user has asked for everything to go. 20260820090000 set it;
  -- the two later restatements of this function dropped the line, and from then
  -- on every reset failed on the system folder and rolled back.
  PERFORM set_config('tj.bypass_lock_guard', 'on', true);

  DELETE FROM public.tj_position_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_position_checkins   WHERE user_id = v_uid;
  DELETE FROM public.tj_trade_images        WHERE user_id = v_uid;
  DELETE FROM public.tj_executions          WHERE user_id = v_uid;
  DELETE FROM public.tj_import_rows         WHERE user_id = v_uid;
  DELETE FROM public.tj_positions           WHERE user_id = v_uid;
  DELETE FROM public.tj_import_batches      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rule_links WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_sections   WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbooks           WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_checkins    WHERE user_id = v_uid;
  DELETE FROM public.tj_tracker_rules       WHERE user_id = v_uid;
  DELETE FROM public.tj_daily_reports       WHERE user_id = v_uid;
  DELETE FROM public.tj_weekly_reviews      WHERE user_id = v_uid;
  DELETE FROM public.tj_experiments         WHERE user_id = v_uid;
  DELETE FROM public.tj_focus_goals         WHERE user_id = v_uid;
  DELETE FROM public.tj_notes               WHERE user_id = v_uid;
  DELETE FROM public.tj_note_folders        WHERE user_id = v_uid;
  DELETE FROM public.tj_note_tags           WHERE user_id = v_uid;
  DELETE FROM public.tj_cash_events         WHERE user_id = v_uid;
  DELETE FROM public.tj_accounts            WHERE user_id = v_uid;
  DELETE FROM public.tj_option_items        WHERE user_id = v_uid;
  DELETE FROM public.tj_option_lists        WHERE user_id = v_uid;
  DELETE FROM public.tj_field_defs          WHERE user_id = v_uid;
  DELETE FROM public.tj_instruments         WHERE user_id = v_uid;
  DELETE FROM public.tj_dashboard_templates WHERE user_id = v_uid;
  DELETE FROM public.tj_user_prefs          WHERE user_id = v_uid;

  PERFORM public.tj_seed_my_defaults();
END;
$$;

COMMENT ON FUNCTION public.tj_reset_my_data() IS
  'Deletes all 28 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
