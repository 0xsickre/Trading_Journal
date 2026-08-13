-- A fifth automatic tracker rule: was the thesis written before the entry.
--
-- Phase 1 put `thesis` on the trade and phase 2 built the daily check-in around
-- it — every morning the position is open, the check-in asks whether the reason
-- for holding survived. With nothing written at entry, that question has nothing
-- to compare against, and the answer is a feeling about the chart.
--
-- So it becomes a tracker rule, and an AUTOMATIC one. The database already
-- knows whether the field is filled; asking the trader to tick a box confirming
-- what the database can see is the ritual `playbook_linked` and `stop_loss_set`
-- were converted away from for the same reason.
--
-- Scored on the OPEN day, and for this rule that is the whole content of it: a
-- thesis written afterwards is a rationalisation. The check is that the reason
-- existed before the position did, and only the open day can say that.

-- 1) Widen the CHECK ---------------------------------------------------------
--
-- The constraint is the closed set the app's `AUTO_RULE_KEYS` mirrors. Dropping
-- and re-adding is the only way to extend an inline CHECK; the name is the one
-- Postgres generated for the column constraint in 20260729150000.

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key IN (
    'max_loss_per_trade', 'max_loss_per_day', 'playbook_linked',
    'stop_loss_set', 'thesis_written'
  ));

-- 2) New users get it from the seed ------------------------------------------
--
-- Body copied from 20260729150000 with one row added and nothing else changed:
-- same signature, same SECURITY DEFINER / search_path, same early return, same
-- ordinals on the existing rows. `create or replace` keeps the privileges, so
-- the REVOKE choreography around this function is not repeated — and must not
-- be, since re-issuing it here would be a permissions change smuggled into a
-- data edit.

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
    ('Trgujem samo u definisanim satima',             'trade',   null,                 1),
    ('Svaki trejd vezan za playbook',                 'trade',   'playbook_linked',    2),
    ('Svaki trejd ima unet stop loss',                'trade',   'stop_loss_set',      3),
    ('Every trade has a written thesis',              'trade',   'thesis_written',     4),
    ('Net max gubitak po trejdu',                     'trade',   'max_loss_per_trade', 5),
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',   6)
  ) as v(text, stage, auto_key, ord);
end;
$function$;

-- The five existing rows stay in Serbian. They are seeded USER DATA, editable in
-- Settings and possibly already edited — the same line 20260812220000 drew when
-- it translated the lock messages and left the Douglas mantras alone. Renaming
-- them from a migration would be rewriting rows the user owns. The new row is
-- written in English because it is new: nobody has edited it yet.

-- 3) Existing users get it too -----------------------------------------------
--
-- The seed above only runs for a user with NO rules, so on its own this
-- migration would ship a rule that the one account already using the app never
-- receives.
--
-- Idempotent through the partial unique index `tj_tracker_rules_one_per_auto_key`
-- (user_id, auto_key) WHERE auto_key IS NOT NULL AND deleted_at IS NULL: the
-- NOT EXISTS makes re-running a no-op, and a user who has already RETIRED this
-- rule is skipped too — un-retiring someone's deliberate choice would be worse
-- than not shipping the rule at all.

INSERT INTO public.tj_tracker_rules
  (user_id, text, stage, auto_key, is_mandatory, sort_order)
SELECT
  r.user_id,
  'Every trade has a written thesis',
  'trade',
  'thesis_written',
  true,
  -- After the last existing rule rather than at a fixed ordinal: the trader may
  -- have reordered their list, and dropping this into position 4 would shuffle
  -- an arrangement they chose.
  COALESCE(MAX(r.sort_order), 0) + 1
FROM public.tj_tracker_rules r
GROUP BY r.user_id
HAVING NOT EXISTS (
  SELECT 1 FROM public.tj_tracker_rules x
  WHERE x.user_id = r.user_id AND x.auto_key = 'thesis_written'
);
