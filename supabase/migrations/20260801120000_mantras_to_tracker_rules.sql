-- Move the four hardcoded morning checkboxes into tracker rules.
--
-- mantra_series, mantra_rules, mantra_risk and risk_accepted were columns on
-- tj_daily_reports rendered as fixed checkboxes. They are the same KIND of thing
-- as a tracker rule — "did I do this today, yes or no" — but they lived in the
-- wrong place, which cost three things:
--
--   1. Nothing ever read them back. Grep the app: they were written and never
--      consumed. They did not move the day's compliance, did not extend the
--      streak, did not reach the Sickre Score. Ticking them was write-only.
--   2. They could not be edited. The wording was compiled into the app, so a
--      fifth mantra, a reworded one, or removing one all needed a code change.
--   3. They had no active_days, so they applied on weekends too.
--
-- As tracker rules they get all three, and the daily report goes back to being
-- what it is good at: prose and ratings.
--
-- rule_broken deliberately STAYS on the daily report. The insight engine already
-- consumes it, and Process Adherence is specified to come from check-ins only —
-- moving it here as well would feed one signal into the score twice.

-- 1) Refuse to run if there is anything to migrate --------------------------
--
-- Verified empty before writing this (0 daily reports, 0 ticks), which is why
-- there is no backfill. Rather than leave that as an assumption in a comment,
-- assert it: if a tick exists, the columns hold history that dropping them would
-- destroy, and whoever hits this needs to write the backfill first. Matching old
-- ticks to new rules would have to go by rule TEXT — there is no key column for a
-- manual rule — and a text match is exactly the fragile mechanism worth avoiding
-- while the tables are still empty.

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.tj_daily_reports
   WHERE mantra_series OR mantra_rules OR mantra_risk OR risk_accepted;
  IF n > 0 THEN
    RAISE EXCEPTION
      'Prekinuto: % dnevnih izveštaja ima čekirane mantre. Napiši backfill pre nego što se kolone obrišu.', n;
  END IF;
END $$;

-- 2) The rules, for users that already exist ---------------------------------
--
-- Inserted directly rather than through tj_seed_tracker_rules, which returns
-- early for any user that already has rules — every existing user does.
--
-- is_mandatory like the rest of the seeded set: it guards the hard delete, not
-- the right to stop tracking something. Retiring one still works and still keeps
-- the history of the days it was live on.

INSERT INTO public.tj_tracker_rules
  (user_id, text, stage, auto_key, is_mandatory, sort_order)
SELECT u.id, v.text, 'prepare', NULL, true,
       coalesce(
         (SELECT max(sort_order) FROM public.tj_tracker_rules r
           WHERE r.user_id = u.id AND r.stage = 'prepare'), -1) + v.ord
FROM auth.users u
CROSS JOIN (VALUES
  ('Razmišljam u verovatnoćama — edge se ispoljava kroz seriju, ne kroz jedan trejd.', 1),
  ('Sve može da se desi; svaki trenutak na grafikonu je jedinstven.', 2),
  ('Definišem i u potpunosti prihvatam rizik pre nego što delujem.', 3),
  ('Prihvatam rizik na svaki trejd koji danas uzmem (gubitak je već mentalno plaćen).', 4)
) AS v(text, ord)
WHERE NOT EXISTS (
  -- Idempotent: re-running must not produce a second copy of a mantra.
  SELECT 1 FROM public.tj_tracker_rules r
   WHERE r.user_id = u.id AND r.text = v.text
);

-- 3) The same four for users that sign up later ------------------------------

CREATE OR REPLACE FUNCTION public.tj_seed_tracker_rules(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.tj_tracker_rules where user_id = target) then
    return;
  end if;

  insert into public.tj_tracker_rules (user_id, text, stage, auto_key, is_mandatory, sort_order)
  select target, v.text, v.stage, v.auto_key, true, v.ord
  from (values
    ('Počni dan po ritualu (priprema pre otvaranja)', 'prepare', null,                 0),
    ('Razmišljam u verovatnoćama — edge se ispoljava kroz seriju, ne kroz jedan trejd.',
                                                     'prepare', null,                 1),
    ('Sve može da se desi; svaki trenutak na grafikonu je jedinstven.',
                                                     'prepare', null,                 2),
    ('Definišem i u potpunosti prihvatam rizik pre nego što delujem.',
                                                     'prepare', null,                 3),
    ('Prihvatam rizik na svaki trejd koji danas uzmem (gubitak je već mentalno plaćen).',
                                                     'prepare', null,                 4),
    ('Trgujem samo u definisanim satima',             'trade',   null,                 5),
    ('Svaki trejd vezan za playbook',                 'trade',   'playbook_linked',    6),
    ('Svaki trejd ima unet stop loss',                'trade',   'stop_loss_set',      7),
    ('Net max gubitak po trejdu',                     'trade',   'max_loss_per_trade', 8),
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',   9)
  ) as v(text, stage, auto_key, ord);
end;
$function$;

-- Same reason as 20260729150000: SECURITY DEFINER taking a user id must not be
-- reachable over /rest/v1/rpc. CREATE OR REPLACE keeps the existing grants, but
-- these are restated so the guarantee is readable in one file.
REVOKE ALL ON FUNCTION public.tj_seed_tracker_rules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_seed_tracker_rules(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tj_seed_tracker_rules(uuid) FROM authenticated;

-- 4) Drop the columns --------------------------------------------------------
--
-- Last, so the guard above has already refused if any of them held a tick.

ALTER TABLE public.tj_daily_reports
  DROP COLUMN mantra_series,
  DROP COLUMN mantra_rules,
  DROP COLUMN mantra_risk,
  DROP COLUMN risk_accepted;
