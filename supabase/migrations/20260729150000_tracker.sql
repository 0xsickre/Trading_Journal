-- Phase 5: Progress Tracker.
--
-- Phases 0-4 measure the RESULT — P&L, R, drawdown, which playbook rule carries
-- the edge. None of those numbers say whether the process was followed at all,
-- which is the one thing a trader fully controls. This is the table that records
-- it, and the streak is what makes it stick.
--
-- Everything below rests on one distinction: a journal records what happened,
-- configuration is the current state. Retiring a rule tomorrow must not raise
-- yesterday's compliance, and a rule added today must not retroactively fail a
-- year of days. Both fall out of `created_at` and `deleted_at` being timestamps
-- the compliance reader compares against each day — see
-- src/lib/journal/tracker/compliance.ts.

-- 1) Rules -------------------------------------------------------------------

CREATE TABLE public.tj_tracker_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  text text NOT NULL CHECK (btrim(text) <> ''),
  stage text NOT NULL DEFAULT 'prepare'
    CHECK (stage IN ('prepare', 'trade', 'reflect')),

  -- ISO weekday numbers, 1=Mon .. 7=Sun. Same convention zonedWeekStartKey
  -- already uses via the "i" format token. Date#getDay (0=Sun) is a THIRD
  -- convention and is deliberately never applied to these values.
  active_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'
    CHECK (
      active_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
      AND array_length(active_days, 1) BETWEEN 1 AND 7
    ),

  -- Which evaluator runs for this rule. NULL means a manual rule, ticked by
  -- hand. A column rather than a key inside `config`: this is the discriminant
  -- that decides which branch of code executes, so it needs a CHECK and an
  -- index — neither of which a free-form blob can carry. Matching on `text`
  -- instead would break the first time the wording is edited.
  auto_key text CHECK (auto_key IN (
    'max_loss_per_trade', 'max_loss_per_day', 'playbook_linked', 'stop_loss_set'
  )),

  -- Per-rule settings, e.g. {"amount": 400}. Validated in the server action by
  -- a zod schema per auto_key; SQL carries only the structural guarantees,
  -- because a jsonb-path CHECK mirroring the schema would need a migration
  -- every time a key is added and the app is the sole writer.
  config jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT tj_tracker_rules_manual_has_no_config
    CHECK (auto_key IS NOT NULL OR config = '{}'::jsonb),
  -- Absent amount = unconfigured, which the evaluator reports as not-applicable
  -- rather than inventing a limit. Present but non-numeric is a bug.
  CONSTRAINT tj_tracker_rules_amount_is_number
    CHECK (config -> 'amount' IS NULL OR jsonb_typeof(config -> 'amount') = 'number'),

  is_mandatory boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,

  -- Soft retire, and the ONLY on/off switch this table has.
  --
  -- There is deliberately no `is_active` boolean: an untimestamped flag means
  -- flipping it silently rewrites the denominator of every past day, which is
  -- exactly what the compliance reader's created_at/deleted_at comparisons
  -- exist to prevent.
  deleted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.tj_tracker_rules.auto_key IS
  'Which evaluator scores this rule from data. NULL = manual. See '
  'src/lib/journal/tracker/auto-rules.ts — the day a trade is attributed to '
  'differs per key (money rules use the close day, decision rules the open day).';

CREATE INDEX tj_tracker_rules_user_order_idx
  ON public.tj_tracker_rules (user_id, stage, sort_order, id)
  WHERE deleted_at IS NULL;

-- Two live "Net Max Loss/Day" rules would make "which limit applies" undefined.
CREATE UNIQUE INDEX tj_tracker_rules_one_per_auto_key
  ON public.tj_tracker_rules (user_id, auto_key)
  WHERE auto_key IS NOT NULL AND deleted_at IS NULL;

-- 2) Check-ins ---------------------------------------------------------------

CREATE TABLE public.tj_tracker_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.tj_tracker_rules(id) ON DELETE CASCADE,
  report_date date NOT NULL,

  -- THREE states. NULL means "evaluated, not applicable" and is only legal on a
  -- frozen auto row — a manual answer is always yes or no.
  --
  -- Nullable is load-bearing, not tidiness. Lock a Monday with no trades: if the
  -- freeze wrote nothing for the not-applicable auto rules, a later import
  -- backfilling a Monday trade would RESURRECT those rules on a day that is
  -- supposed to be sealed. An explicit NULL row closes that.
  checked boolean,
  auto_evaluated boolean NOT NULL DEFAULT false,
  CONSTRAINT tj_tracker_checkins_answer_or_auto
    CHECK (checked IS NOT NULL OR auto_evaluated),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (rule_id, report_date)
);

COMMENT ON COLUMN public.tj_tracker_checkins.auto_evaluated IS
  'True on rows frozen at lock time. Auto rules are derived on read for an '
  'UNLOCKED day and materialised here when the day is locked — that hybrid is '
  'what lets trades stay editable while a locked day stays fixed.';

CREATE INDEX tj_tracker_checkins_user_date_idx
  ON public.tj_tracker_checkins (user_id, report_date);

-- 3) The lock ----------------------------------------------------------------
--
-- On tj_daily_reports rather than a table of its own: the lock seals the process
-- journal, and the process journal's row for a date IS this row. A separate
-- table would need its own RLS policy and would admit a state the domain has no
-- meaning for — a locked date with no journal entry, a lock on nothing.
--
-- A timestamp, not a boolean: WHEN the day was sealed is itself journal data,
-- and it lets "irreversible" be a condition a trigger can state.

ALTER TABLE public.tj_daily_reports ADD COLUMN locked_at timestamptz;

COMMENT ON COLUMN public.tj_daily_reports.locked_at IS
  'Set once, never cleared — the guard trigger rejects any UPDATE of a locked '
  'row, and unlocking would be an UPDATE. Scoped to the PROCESS journal only.';

-- 4) Guards ------------------------------------------------------------------
--
-- Why the database and not just the server action: PostgREST is a live write
-- path holding the user's own JWT, and RLS grants the owner everything. A lock
-- enforced only in an action is a lock any curl walks through. Same reasoning
-- that put the show_when freeze trigger in 20260729130000.

CREATE OR REPLACE FUNCTION public.tj_daily_report_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.locked_at is not null then
    raise exception 'Dan % je zaključan i ne može se menjati.', old.report_date
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$function$;

-- Any update of a locked row raises, and unlocking IS an update. That is how
-- "irreversible" is expressed. Setting the lock itself passes because
-- OLD.locked_at is still null at that moment.
CREATE TRIGGER tj_daily_reports_lock_guard
  BEFORE UPDATE OR DELETE ON public.tj_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tj_daily_report_lock_guard();

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
    raise exception 'Dan % je zaključan — čekiranje pravila je zamrznuto.', d
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE TRIGGER tj_tracker_checkins_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.tj_tracker_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tj_tracker_checkin_lock_guard();

-- NOTE, deliberately: there is NO trigger on tj_positions, and none should be
-- added. Locking is scoped to the process journal. P&L is a fact that must stay
-- correctable — a mistyped fill from a locked day has to be fixable, and every
-- money figure must move when it is fixed. A locked day's COMPLIANCE does not
-- move, because it was frozen into tj_tracker_checkins at lock time.

-- 5) Locking RPC -------------------------------------------------------------
--
-- One call, because ordering matters: the frozen rows must be written while the
-- day is still unlocked (the checkin guard would reject its own rows otherwise),
-- and the seal must land in the same transaction.
--
-- SECURITY INVOKER (the default) on purpose. It takes no user id, derives
-- everything from auth.uid(), and RLS still applies to both tables — so it
-- cannot touch another user's rows and needs none of the REVOKE choreography
-- that tj_seed_playbooks(uuid) required.
--
-- Verdicts are computed in TypeScript and passed in. Re-implementing the
-- open-day/close-day attribution in SQL would create a second source of truth
-- for the one rule in this phase most likely to be got wrong.

CREATE OR REPLACE FUNCTION public.tj_lock_day(p_date date, p_auto jsonb DEFAULT '[]'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Niste prijavljeni.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_auto) <> 'array' then
    raise exception 'p_auto mora biti niz.' using errcode = 'invalid_parameter_value';
  end if;

  -- Locking asserts "this day's record is final", which presupposes a record.
  insert into public.tj_daily_reports (user_id, report_date)
  values (uid, p_date)
  on conflict (user_id, report_date) do nothing;

  if exists (
    select 1 from public.tj_daily_reports
    where user_id = uid and report_date = p_date and locked_at is not null
  ) then
    raise exception 'Dan % je već zaključan.', p_date using errcode = 'check_violation';
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

REVOKE ALL ON FUNCTION public.tj_lock_day(date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_lock_day(date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.tj_lock_day(date, jsonb) TO authenticated;

-- 6) RLS + updated_at --------------------------------------------------------

ALTER TABLE public.tj_tracker_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_tracker_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_tracker_rules_owner ON public.tj_tracker_rules
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_tracker_checkins_owner ON public.tj_tracker_checkins
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_tracker_rules_updated_at
  BEFORE UPDATE ON public.tj_tracker_rules
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TRIGGER tj_tracker_checkins_updated_at
  BEFORE UPDATE ON public.tj_tracker_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- 7) Seed --------------------------------------------------------------------
--
-- The money rules seed with config = '{}' — UNCONFIGURED, which evaluates to
-- not-applicable everywhere until you set a limit. Same reasoning that kept the
-- playbook seed free of rules: a seeded limit of 200 is a limit you will pass
-- without ever having chosen it.

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
    ('Net max gubitak po trejdu',                     'trade',   'max_loss_per_trade', 4),
    ('Net max gubitak po danu',                       'trade',   'max_loss_per_day',   5)
  ) as v(text, stage, auto_key, ord);
end;
$function$;

-- Takes a user id as an argument and is SECURITY DEFINER, so it must not be
-- reachable over /rest/v1/rpc — the exact hole 20260729140000 had to close.
REVOKE ALL ON FUNCTION public.tj_seed_tracker_rules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_seed_tracker_rules(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tj_seed_tracker_rules(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.tj_daily_report_lock_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_daily_report_lock_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tj_daily_report_lock_guard() FROM authenticated;

REVOKE ALL ON FUNCTION public.tj_tracker_checkin_lock_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_tracker_checkin_lock_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tj_tracker_checkin_lock_guard() FROM authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    PERFORM public.tj_seed_tracker_rules(r.id);
  END LOOP;
END $$;

-- Fold into the signup seed. Only the last line changes versus 20260729130000.
CREATE OR REPLACE FUNCTION public.tj_seed_defaults(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.tj_accounts where user_id = target) then
    insert into public.tj_accounts (user_id, name, currency, starting_balance, default_asset_class, timezone)
    values (target, 'Main Account', 'USD', 0, 'Futures', 'America/New_York');
  end if;

  if not exists (select 1 from public.tj_option_lists where user_id = target) then
    insert into public.tj_option_lists (user_id, key, label, category, sort_order)
    select target, v.key, v.label, v.category, v.sort_order
    from (values
      ('direction','Direction','Context',0),
      ('macro_align','Macro Align','Context',1),
      ('cot_filter','COT Filter','Context',2),
      ('htf_bias','HTF Bias','Context',3),
      ('entry_tf','Entry TF','Context',4),
      ('technical_tag','Technical Tags','ICT Setup',5),
      ('setup_grade','Setup Grade','ICT Setup',6),
      ('risk_pct','Risk %','Risk',7),
      ('result','Result','Risk',8),
      ('exit_reason','Exit Reason','Risk',9),
      ('miss_reason','Miss Reason','Risk',10),
      ('emotion','Emotion','Psychology',11),
      ('discipline','Discipline / Behavior','Psychology',12),
      ('mistake','Mistake','Psychology',13)
    ) as v(key, label, category, sort_order);

    insert into public.tj_option_items (user_id, list_id, value, label, sort_order)
    select target, l.id, v.value, v.value, v.ord
    from (values
      ('direction','Long',0),('direction','Short',1),
      ('macro_align','Uz bias',0),('macro_align','Protiv bias',1),('macro_align','Van scope',2),
      ('cot_filter','Ulaz dozvoljen',0),('cot_filter','Odložen',1),('cot_filter','Ne chase',2),
      ('htf_bias','Bullish',0),('htf_bias','Bearish',1),('htf_bias','Neutral / Ranging',2),
      ('entry_tf','4H',0),('entry_tf','1H',1),('entry_tf','30m',2),('entry_tf','15m',3),('entry_tf','5m',4),
      ('technical_tag','Liquidity sweep',0),('technical_tag','MSS/CHoCH',1),('technical_tag','Displacement',2),('technical_tag','FVG',3),('technical_tag','Order Block',4),('technical_tag','Breaker',5),('technical_tag','Premium/Discount OK',6),('technical_tag','OTE zone',7),('technical_tag','SMT divergence',8),('technical_tag','Killzone timing',9),('technical_tag','HTF PD overlap',10),('technical_tag','Multi-TF alignment',11),
      ('setup_grade','A+',0),('setup_grade','A',1),('setup_grade','B',2),('setup_grade','C',3),
      ('risk_pct','0.25%',0),('risk_pct','0.5%',1),('risk_pct','0.75%',2),('risk_pct','1%',3),('risk_pct','1.5%',4),('risk_pct','2%',5),
      ('result','Win',0),('result','Loss',1),('result','Breakeven',2),('result','Partial Win',3),('result','Partial Loss',4),
      ('exit_reason','TP hit',0),('exit_reason','SL hit',1),('exit_reason','Manual (profit)',2),('exit_reason','Manual (loss)',3),('exit_reason','BE stop',4),
      ('miss_reason','No fill',0),('miss_reason','Price ran away',1),('miss_reason','Setup invalidated',2),('miss_reason','News / event',3),('miss_reason','Discretion',4),('miss_reason','Session ended',5),('miss_reason','Other',6),
      ('emotion','Discipliniran',0),('emotion','FOMO',1),('emotion','Strah',2),('emotion','Pohlepa',3),('emotion','Revenge',4),('emotion','Nestrpljiv',5),('emotion','Overconfident',6),('emotion','Umoran/rastrojen',7),
      ('discipline','Followed plan',0),('discipline','Moved stop',1),('discipline','Cut winner short',2),('discipline','Revenge',3),('discipline','Oversized',4),
      ('mistake','None',0),('mistake','Late entry',1),('mistake','Early/no confirmation',2),('mistake','Moved stop',3),('mistake','Cut winner short',4),('mistake','Oversized',5),('mistake','Chased/FOMO',6),('mistake','Against bias',7)
    ) as v(list_key, value, ord)
    join public.tj_option_lists l on l.user_id = target and l.key = v.list_key;
  end if;

  if not exists (select 1 from public.tj_field_defs where user_id = target) then
    insert into public.tj_field_defs (user_id, key, label, field_type, list_key, group_id, sort_order)
    select target, v.key, v.label, 'select', v.key, v.group_id, v.ord
    from (values
      ('macro_align','Macro Align','macro',0),
      ('cot_filter','COT Filter','macro',1),
      ('htf_bias','HTF Bias','setup',0),
      ('entry_tf','Entry TF','plan_advanced',0)
    ) as v(key, label, group_id, ord)
    on conflict (user_id, key) do nothing;
  end if;

  perform public.tj_seed_instruments_defaults(target);
  perform public.tj_seed_playbooks(target);
  perform public.tj_seed_tracker_rules(target);
end;
$function$;
