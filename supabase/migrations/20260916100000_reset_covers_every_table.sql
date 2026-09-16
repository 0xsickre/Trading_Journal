-- `tj_reset_my_data` was missing two tables, and one of them survived the reset.
--
-- The function enumerates tables BY HAND, on purpose: 20260817120000 chose that
-- over a catalog loop so a table added later shows up as a visible omission
-- rather than a silent survivor. The mechanism worked exactly as designed —
-- right up to the point where nobody looked. Two tables were added after the
-- list was last touched:
--
--   tj_dashboard_templates  (20260818120000)  -- references auth.users directly
--   tj_playbook_sections    (20260824100000)  -- references tj_playbooks
--
-- Only one of them actually leaked. `tj_playbook_sections.playbook_id` is
-- ON DELETE CASCADE, so deleting `tj_playbooks` already took its sections with
-- it; it is added below for the same reason every other cascade-safe table is
-- already on the list — the list is the record of what "reset everything"
-- means, and a reader should not have to trace foreign keys to believe it.
--
-- `tj_dashboard_templates` is the real defect. It hangs off `auth.users`, not
-- off anything the reset deletes, so a saved dashboard layout outlived
-- "RESET EVERYTHING" — a promise the UI makes in those words, with a typed
-- confirmation phrase behind it. A reset that leaves state behind is worse than
-- one that refuses: the account looks new and behaves as if it remembers
-- something.
--
-- ORDER. Sections go directly after the links that point at them, before
-- `tj_playbooks`, so the deletes read top-down as dependents-then-parents even
-- though the cascades would tolerate any order. Templates go beside
-- `tj_user_prefs`, which is the other per-user display setting and the closest
-- thing to a neighbour they have.
--
-- Nothing else about the function changes: still SECURITY INVOKER (every table
-- carries `FOR ALL TO authenticated USING (user_id = auth.uid())`, so RLS
-- already scopes each DELETE to the caller and there is nothing to elevate),
-- still re-seeds through `tj_seed_my_defaults()` so "reset" and "first load
-- ever" land in the same state.

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

  DELETE FROM public.tj_bot_events          WHERE user_id = v_uid;
  DELETE FROM public.tj_bot_tokens          WHERE user_id = v_uid;
  DELETE FROM public.tj_broker_symbol_map   WHERE user_id = v_uid;
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
  'Deletes all 30 tj_ tables for the caller, then re-seeds defaults. Table list is maintained by hand — add new tables here.';

-- Unchanged, restated because CREATE OR REPLACE keeps existing grants and a
-- reader should not have to know that to be sure of who can call this.
REVOKE ALL ON FUNCTION public.tj_reset_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tj_reset_my_data() TO authenticated;
