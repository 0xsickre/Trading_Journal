-- Loss limits become a percentage of equity, and a weekly one joins them.
--
-- WHY THE UNIT CHANGED. A limit of "200 EUR on a day" is a different rule at a
-- 5 000 account than at a 50 000 one, so a number set once stops describing the
-- trader's risk the moment the account moves — and the figure that has to be
-- retyped to stay honest is the figure nobody retypes. A percentage keeps its
-- meaning as the balance changes, which is why every prop firm states its rules
-- that way and why `ftmo_daily_loss_pct` on `tj_accounts` already did.
--
-- THE BASIS IS THE DAY'S OPENING EQUITY — the previous day's close, computed in
-- `equity-ladder.ts`. Measuring against the live balance instead would make the
-- limit a moving target: lose money and the allowance shrinks with it, so the
-- rule could never quite be broken.
--
-- WHY THE OLD AMOUNTS ARE CLEARED RATHER THAN CONVERTED. A conversion needs an
-- equity to divide by, and the only one available here is whatever the account
-- holds at migration time — which turns "200 EUR" into a percentage that
-- describes today's balance rather than any decision the trader made. Worse,
-- the seed writes `starting_balance = 0`, so for a fresh book the division has
-- no answer at all. Clearing sends the rules back to `unconfigured`, which the
-- evaluator already reports as not-scored, and asks for the number in the new
-- unit. Past days keep their verdicts: those were frozen into
-- `tj_tracker_checkins` at lock time and nothing here touches them.

-- 1. The new key. Same shape as 20260813160000_thesis_written_rule.sql — the
--    CHECK is dropped and rebuilt rather than altered, because Postgres has no
--    "add a value to this CHECK".
ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key IN (
    'max_loss_per_trade',
    'max_loss_per_day',
    'max_loss_per_week',
    'playbook_linked',
    'stop_loss_set',
    'thesis_written'
  ));

-- 2. The structural CHECK follows the key rename. `amount` was money and `pct`
--    is a share, so a row carrying the old key must not satisfy the new
--    constraint by accident — the app's reader ignores `amount` outright.
ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_amount_is_number;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_pct_is_number
  CHECK (
    config -> 'pct' IS NULL
    OR (
      jsonb_typeof(config -> 'pct') = 'number'
      AND (config ->> 'pct')::numeric > 0
      AND (config ->> 'pct')::numeric <= 100
    )
  );

-- 3. Drop the stale money limits. `config` goes back to `{}`, which is exactly
--    what an unconfigured auto rule looks like.
UPDATE public.tj_tracker_rules
   SET config = '{}'::jsonb
 WHERE config ? 'amount';

-- 4. The weekly rule, for everyone who already has the daily one.
--
--    Seeded retired-free and mandatory like its siblings, and scored on every
--    weekday: the point of a weekly budget is that Thursday can tell you it is
--    already spent, so it is evaluated cumulatively from Monday rather than
--    once the week is over.
--
--    Idempotent through the partial unique index
--    `tj_tracker_rules_one_per_auto_key (user_id, auto_key) WHERE auto_key IS
--    NOT NULL AND deleted_at IS NULL`: a user who already has a live one is
--    skipped by the NOT EXISTS below, and a user who retired theirs keeps that
--    decision rather than having it undone by a migration.
INSERT INTO public.tj_tracker_rules
  (user_id, text, stage, auto_key, active_days, is_mandatory, sort_order)
SELECT DISTINCT r.user_id,
       'Net max gubitak po nedelji',
       'trade',
       'max_loss_per_week',
       ARRAY[1,2,3,4,5,6,7]::smallint[],
       true,
       COALESCE(
         (SELECT MAX(x.sort_order) + 1
            FROM public.tj_tracker_rules x
           WHERE x.user_id = r.user_id),
         0)
  FROM public.tj_tracker_rules r
 WHERE NOT EXISTS (
         SELECT 1 FROM public.tj_tracker_rules x
          WHERE x.user_id = r.user_id
            AND x.auto_key = 'max_loss_per_week'
       );

-- 5. The seed, so a new signup gets the rule too rather than only the users who
--    existed when this ran.
--
--    Body copied from 20260813160000 with one row added and nothing else
--    changed: same signature, same SECURITY DEFINER / search_path, same early
--    return, same ordinals on the existing rows. `create or replace` keeps the
--    privileges, so the REVOKE choreography around this function is not
--    repeated here — and must not be, since re-issuing it would be a
--    permissions change smuggled into a data edit.
--
--    The existing rows stay exactly as they are. They are seeded USER DATA,
--    editable in Settings and possibly already edited, so a migration that
--    reworded them would be rewriting rows the user owns.

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
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',   6),
    ('Net max gubitak po nedelji',                    'trade',   'max_loss_per_week',  7)
  ) as v(text, stage, auto_key, ord);
end;
$function$;

COMMENT ON CONSTRAINT tj_tracker_rules_pct_is_number ON public.tj_tracker_rules IS
  'Loss limits are a share of the day''s opening equity. Bounded above by 100 because "lose more than all of it" is not a limit, and a stray digit turning 2 into 200 would switch the rule off rather than tighten it.';
