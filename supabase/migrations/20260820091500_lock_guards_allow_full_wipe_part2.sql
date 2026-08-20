-- Part 2 of the full-wipe fix. The first pass (20260820090000) only found the
-- guards whose exact error text the user had already hit
-- (tj_tracker_checkin_lock_guard) plus its two obvious siblings on the same
-- table shape (tj_daily_report_lock_guard, tj_position_checkin_lock_guard).
-- A full sweep of every trigger function in `public` that can RAISE EXCEPTION
-- turned up two more that tj_reset_my_data's own DELETE statements walk
-- straight into, neither previously known to have this bug:
--
--   - tj_weekly_review_lock_guard on tj_weekly_reviews (BEFORE UPDATE OR
--     DELETE) -- same lock-guard shape as the daily-report one, just never
--     searched for by name before.
--   - tj_protect_system_note_folder on tj_note_folders (BEFORE DELETE) --
--     unconditionally refuses to delete the seeded "Trade Notes" folder
--     (is_system = true), no user/bypass check of any kind. Every account has
--     exactly one such folder, so `DELETE FROM tj_note_folders` in the reset
--     sweep hits this every single time, for every user, unconditionally --
--     the day-lock and weekly-lock guards only fire for accounts that happen
--     to have locked something, but this one is universal.
--
-- Same fix, same transaction-local flag `tj_reset_my_data`/`tj_delete_account`
-- already set before their deletes (see 20260820090000 for why SET LOCAL
-- semantics are safe here).

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

CREATE OR REPLACE FUNCTION public.tj_protect_system_note_folder()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_setting('tj.bypass_lock_guard', true) = 'on' then
    return old;
  end if;
  if old.is_system then
    raise exception 'This folder is required and cannot be deleted.';
  end if;
  return old;
end;
$function$;
