-- Lock guard messages, in English.
--
-- The app's interface was unified on English; these five strings were the only
-- user-facing text left in Serbian, and they are the ones a trader actually
-- meets at the worst moment — trying to edit a sealed day. A toast that answers
-- in a different language than the screen it covers reads like a bug.
--
-- THREE FUNCTIONS, TEXT ONLY. Each body below is copied verbatim from
-- 20260729150000_tracker.sql with nothing changed but the message string:
-- same signatures, same SECURITY DEFINER / SET search_path on the two guards,
-- same errcodes, same control flow. `create or replace` keeps existing
-- privileges, so the REVOKE/GRANT choreography around `tj_lock_day` does not
-- need repeating — and must not be, since re-issuing it here would be a
-- permissions change smuggled into a copy edit.
--
-- What this migration deliberately does NOT touch: the Serbian rows already
-- seeded into `tj_tracker_rules` (the Douglas mantras), the notebook templates,
-- and `tj_option_items`. Those are not text in the codebase — they are the
-- user's own data, editable in Settings, and possibly already edited. Renaming
-- them from a migration would be rewriting rows the user owns.

CREATE OR REPLACE FUNCTION public.tj_daily_report_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
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

CREATE OR REPLACE FUNCTION public.tj_lock_day(p_date date, p_auto jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'You are not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_auto) <> 'array' then
    raise exception 'p_auto must be an array.' using errcode = 'invalid_parameter_value';
  end if;

  -- Locking asserts "this day's record is final", which presupposes a record.
  insert into public.tj_daily_reports (user_id, report_date)
  values (uid, p_date)
  on conflict (user_id, report_date) do nothing;

  if exists (
    select 1 from public.tj_daily_reports
    where user_id = uid and report_date = p_date and locked_at is not null
  ) then
    raise exception 'Day % is already locked.', p_date using errcode = 'check_violation';
  end if;

  -- FIRST the frozen auto rows, while the guard still lets them through ...
  insert into public.tj_tracker_checkins (user_id, rule_id, report_date, checked, auto_evaluated)
  select uid, (e ->> 'rule_id')::uuid, p_date,
         case when jsonb_typeof(e -> 'checked') = 'boolean'
              then (e ->> 'checked')::boolean
              else null end,
         true
  from jsonb_array_elements(p_auto) e
  on conflict (rule_id, report_date) do update
    set checked = excluded.checked, auto_evaluated = true;

  -- ... THEN the seal.
  update public.tj_daily_reports
     set locked_at = now()
   where user_id = uid and report_date = p_date;
end;
$function$;
