-- Two automatic tracker rules about RISK TAKEN, scored on the day of entry.
--
-- WHY THESE, AND WHY NOT A REWRITE OF THE OLD ONE. `max_loss_per_trade` grades
-- the realized loss on the CLOSE day: a trade sized at three times the intended
-- risk that ran to target is invisible to it, and one that was closed early
-- passes. That is a rule about the outcome, and outcomes are not the thing a
-- process tracker exists to grade.
--
-- Rewriting it to read the risk at entry was the obvious move and is the wrong
-- one twice over: every locked day in the history was scored under the old
-- meaning and cannot be rescored (the lock guard refuses), so the book would
-- become inconsistent with itself; and the two questions are genuinely
-- different — how much you RISKED (a decision, on the open day) against how much
-- you LOST (an outcome, on the close day). The distance between them is itself a
-- finding: slippage through the stop, a gap, an exit taken early.
--
--   risk_per_trade       no trade opened that day risked more than the limit,
--                        as a percentage of the equity the day opened with.
--   risk_matched_intent  every trade opened that day was sized within tolerance
--                        of the `risk_pct` the trader chose for it. No config:
--                        the tolerance is `RISK_INTENT_TOLERANCE` in
--                        `risk-taken.ts`, one constant rather than a second
--                        shape of config for the UI, the zod branch and
--                        `parseConfig` to learn.
--
-- Both read `tj_positions.equity_at_entry` (20260920160000) as the denominator,
-- so a trade whose entry-day equity could not be established scores `na` with
-- reason `unpriced` rather than passing.

-- 1) Widen the CHECK ---------------------------------------------------------
--
-- The constraint is the closed set `AUTO_RULE_KEYS` mirrors in the app. Dropping
-- and re-adding is the only way to extend an inline CHECK; the name is the one
-- Postgres generated in 20260729150000.

ALTER TABLE public.tj_tracker_rules
  DROP CONSTRAINT IF EXISTS tj_tracker_rules_auto_key_check;

ALTER TABLE public.tj_tracker_rules
  ADD CONSTRAINT tj_tracker_rules_auto_key_check
  CHECK (auto_key IN (
    'max_loss_per_trade', 'max_loss_per_day', 'max_loss_per_week',
    'playbook_linked', 'stop_loss_set', 'thesis_written',
    'risk_per_trade', 'risk_matched_intent'
  ));

-- 2) New users get them from the seed ----------------------------------------
--
-- Body copied from the live function with two rows added and nothing else
-- changed: same signature, same SECURITY DEFINER / search_path, same early
-- return, same ordinals on the existing rows. `create or replace` keeps the
-- privileges, so the REVOKE choreography around this function is not repeated —
-- and must not be, since re-issuing it here would be a permissions change
-- smuggled into a data edit.

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
    ('Počni dan po ritualu (priprema pre otvaranja)', 'prepare', null,                  0),
    ('Trgujem samo u definisanim satima',             'trade',   null,                  1),
    ('Svaki trejd vezan za playbook',                 'trade',   'playbook_linked',     2),
    ('Svaki trejd ima unet stop loss',                'trade',   'stop_loss_set',       3),
    ('Every trade has a written thesis',              'trade',   'thesis_written',      4),
    ('Net max gubitak po trejdu',                     'trade',   'max_loss_per_trade',  5),
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',    6),
    ('Net max gubitak po nedelji',                    'trade',   'max_loss_per_week',   7),
    ('Max risk per trade at entry',                   'trade',   'risk_per_trade',      8),
    ('Every trade sized to its planned risk',         'trade',   'risk_matched_intent', 9)
  ) as v(text, stage, auto_key, ord);
end;
$function$;

-- The Serbian rows stay Serbian: they are seeded USER DATA, editable in Settings
-- and possibly already edited, and renaming them from a migration would rewrite
-- rows the trader owns. The new ones are written in English because nobody has
-- edited them yet.

-- 3) Existing users get them too ---------------------------------------------
--
-- The seed only runs for a user with NO rules, so on its own this migration
-- would ship two rules the one account already using the app never receives.
--
-- Idempotent through the partial unique index
-- `tj_tracker_rules_one_per_auto_key` (user_id, auto_key) WHERE auto_key IS NOT
-- NULL AND deleted_at IS NULL: the NOT EXISTS makes a re-run a no-op, and a user
-- who has already RETIRED one of these is skipped — un-retiring someone's
-- deliberate choice would be worse than not shipping the rule.
--
-- `risk_per_trade` is seeded WITHOUT a `pct`, like the other limit rules: a
-- limit the trader did not choose is a limit they will pass without noticing, so
-- it stays unscored (reason `unconfigured`) until they set one.

INSERT INTO public.tj_tracker_rules
  (user_id, text, stage, auto_key, is_mandatory, sort_order)
SELECT
  r.user_id,
  v.text,
  'trade',
  v.auto_key,
  true,
  -- After the last existing rule rather than at a fixed ordinal: the trader may
  -- have reordered their list, and dropping these in at 8 and 9 would shuffle an
  -- arrangement they chose.
  COALESCE(MAX(r.sort_order), 0) + v.offset_ord
FROM public.tj_tracker_rules r
CROSS JOIN (values
  ('Max risk per trade at entry',           'risk_per_trade',      1),
  ('Every trade sized to its planned risk', 'risk_matched_intent', 2)
) AS v(text, auto_key, offset_ord)
GROUP BY r.user_id, v.text, v.auto_key, v.offset_ord
HAVING NOT EXISTS (
  SELECT 1 FROM public.tj_tracker_rules x
  WHERE x.user_id = r.user_id AND x.auto_key = v.auto_key
);
