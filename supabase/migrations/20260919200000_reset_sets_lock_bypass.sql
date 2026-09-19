-- "Delete all data" works again.
--
-- `tj_reset_my_data` deletes `tj_note_folders`, whose system folder is guarded by
-- `tj_protect_system_note_folder` unless `tj.bypass_lock_guard` is on. The bypass
-- was set when the guards were introduced (20260820090000) and lost in the two
-- restatements since (20260916100000, 20260918120000), so every reset raised
-- "This folder is required and cannot be deleted." and rolled back. Restated
-- whole, as before; the only new lines are the bypass and its comment.

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
  'Deletes all 27 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
