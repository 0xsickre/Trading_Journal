-- The morning brief reaches the journal as data, not as a link.
--
-- WHY. The brief in futures-trading already knows the three things the day's
-- rules need and the journal did not: the red windows around the day's news,
-- the Topstep end of day (15:10 CT, earlier on a holiday or an early close),
-- and the expected NQ / ES range. Until now it wrote them into an HTML page and
-- a Telegram message, so `/daily` could not show them and no rule could read
-- them — "no entry inside a red window" had no source to be checked against.
--
-- One row per Topstep trading day (17:00 -> 17:00 CT, the day `/daily` shows
-- for a Topstep account). The brief writes it through PostgREST signed in as
-- the journal's user, so RLS applies as it does in the app; a rerun of the brief
-- replaces the day's row rather than adding a second one.
--
-- WHAT IS NOT HERE: the contracts for the day. The journal computes them from
-- `topstep.ts` itself; a copy from the brief would be a second number free to
-- disagree with the first (decision G11).
--
-- `red_windows` is an array of {from, to, title, impact}, instants in ISO UTC.
-- `ranges` is the brief's model output keyed as the brief keys it (NQ_ts,
-- NQ_rth, ES_ts, ES_rth, 6E_ts, 6E_jutro) — kept whole so a new key needs no
-- migration. `flat_by` NULL means the exchange is closed that day.

CREATE TABLE IF NOT EXISTS public.tj_session_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  trading_day date NOT NULL,
  flat_by timestamptz,
  day_note text,
  red_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  ranges jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, trading_day),

  CONSTRAINT tj_session_briefs_red_windows_array
    CHECK (jsonb_typeof(red_windows) = 'array'),
  CONSTRAINT tj_session_briefs_ranges_object
    CHECK (jsonb_typeof(ranges) = 'object')
);

ALTER TABLE public.tj_session_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tj_session_briefs_owner ON public.tj_session_briefs;
CREATE POLICY tj_session_briefs_owner ON public.tj_session_briefs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP TRIGGER IF EXISTS tj_session_briefs_updated_at ON public.tj_session_briefs;
CREATE TRIGGER tj_session_briefs_updated_at
  BEFORE UPDATE ON public.tj_session_briefs
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

COMMENT ON TABLE public.tj_session_briefs IS
  'The futures-trading morning brief for one Topstep trading day: red windows, '
  'Topstep end of day, expected range. Written by the brief, read by /daily '
  'and the tracker.';

-- `tj_reset_my_data` keeps its table list BY HAND. Restated verbatim from
-- 20260921130000_experiments.sql with ONE line added.

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
  DELETE FROM public.tj_session_briefs     WHERE user_id = v_uid;
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
  'Deletes all 29 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
