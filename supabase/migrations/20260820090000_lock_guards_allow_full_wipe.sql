-- The day-lock guards on tj_daily_reports / tj_tracker_checkins /
-- tj_position_checkins exist to stop a user quietly editing or erasing a
-- locked day's frozen compliance record through the ordinary write path.
-- They had no way to tell that apart from the user's OWN sanctioned
-- "delete everything" (tj_reset_my_data) or "delete this account"
-- (tj_delete_account) removing that same record along with literally
-- everything else -- so a user who had ever locked even one day could not
-- use either. Confirmed live: "Delete all data" on an account with one
-- locked day failed with "Day 2026-06-25 is locked -- rule check-ins are
-- frozen." from tj_tracker_checkin_lock_guard, mid-sweep, rolling back
-- every DELETE already run in that call.
--
-- Fix: a transaction-local flag the two wipe functions set before their
-- deletes, and the three lock-guard triggers check first. `set_config(...,
-- true)` is SET LOCAL semantics -- scoped to the current transaction, so it
-- cannot leak onto a pooled connection's next, unrelated statement, and
-- resets itself with no cleanup code needed. Every ordinary write through
-- PostgREST never sets it, so the guards keep refusing those exactly as
-- before.

CREATE OR REPLACE FUNCTION public.tj_daily_report_lock_guard()
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
    raise exception 'Day % is locked and cannot be changed.', old.report_date
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tj_tracker_checkin_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d date := coalesce(new.report_date, old.report_date);
  u uuid := coalesce(new.user_id, old.user_id);
begin
  if current_setting('tj.bypass_lock_guard', true) = 'on' then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from public.tj_daily_reports
    where user_id = u and report_date = d and locked_at is not null
  ) then
    raise exception 'Day % is locked — rule check-ins are frozen.', d
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$function$;

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
  if current_setting('tj.bypass_lock_guard', true) = 'on' then
    return coalesce(new, old);
  end if;
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

-- The two wipe entry points: set the bypass before their first DELETE, right
-- after the sign-in check. Both are already SECURITY INVOKER, so this does
-- not change who the deletes run as -- RLS still scopes every statement to
-- `v_uid`, and the flag only silences the trigger's lock check, nothing else.

CREATE OR REPLACE FUNCTION public.tj_delete_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_uid       uuid := (SELECT auth.uid());
  v_remaining int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('tj.bypass_lock_guard', 'on', true);

  IF NOT EXISTS (
    SELECT 1 FROM public.tj_accounts
     WHERE id = p_account_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.tj_accounts
   WHERE user_id = v_uid AND id <> p_account_id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'The last account cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.tj_positions
   WHERE user_id = v_uid AND account_id = p_account_id;

  DELETE FROM public.tj_import_batches
   WHERE user_id = v_uid AND account_id = p_account_id;

  DELETE FROM public.tj_accounts
   WHERE user_id = v_uid AND id = p_account_id;
END;
$$;

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

  PERFORM set_config('tj.bypass_lock_guard', 'on', true);

  DELETE FROM public.tj_position_rules      WHERE user_id = v_uid;
  DELETE FROM public.tj_position_checkins   WHERE user_id = v_uid;
  DELETE FROM public.tj_trade_images        WHERE user_id = v_uid;
  DELETE FROM public.tj_executions          WHERE user_id = v_uid;
  DELETE FROM public.tj_import_rows         WHERE user_id = v_uid;
  DELETE FROM public.tj_positions           WHERE user_id = v_uid;
  DELETE FROM public.tj_import_batches      WHERE user_id = v_uid;
  DELETE FROM public.tj_playbook_rule_links WHERE user_id = v_uid;
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
  DELETE FROM public.tj_user_prefs          WHERE user_id = v_uid;

  PERFORM public.tj_seed_my_defaults();
END;
$$;

REVOKE ALL ON FUNCTION public.tj_delete_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_reset_my_data()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_delete_account(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tj_reset_my_data()      FROM anon;
