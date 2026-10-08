-- M3: the weekly review, the experiments and the focus goal go (trader, 08.10.2026).
--
-- WHY. Closing a day or a week moved out of the journal, into a conversation with
-- the mentor in the private `trading-mentor` repo, fed by the mentor pack ("weekly
-- skroz da ga više nema"). The journal measures and exports; it no longer judges.
-- `/weekly` (the review, the experiment card, Napredak) left in M1, the focus goal
-- in M2 — "domaći" in `trading-mentor` is the one place for what is being worked
-- on — and since then no code reads or writes these three tables.
--
-- The rows are dropped WITHOUT an archive, by the trader's choice ("samo obriši");
-- the nightly R2 backup taken before this migration still holds them.
--
-- ORDER. `tj_reset_my_data` is restated first, as in 20260929140000 minus the three
-- DELETE lines, so the function never names a table that is gone. Then the tables
-- and the weekly review's own lock guard function, which no other table uses.
-- `tj_delete_account` is untouched: it never named these tables.

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

  -- The lock guard (a locked day) and the system "Trade Notes" folder refuse
  -- deletes unless this is set, and they are right to — except here, where the
  -- user has asked for everything to go.
  PERFORM set_config('tj.bypass_lock_guard', 'on', true);

  DELETE FROM public.tj_position_rules      WHERE user_id = v_uid;
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
  DELETE FROM public.tj_session_briefs      WHERE user_id = v_uid;
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
  'Deletes all 25 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;


DROP TABLE IF EXISTS public.tj_weekly_reviews;
DROP TABLE IF EXISTS public.tj_experiments;
DROP TABLE IF EXISTS public.tj_focus_goals;
DROP FUNCTION IF EXISTS public.tj_weekly_review_lock_guard();
