-- Phase 4b: the playbook becomes an entity.
--
-- Before this, a strategy was `ict_entry_model` — one string on the trade — and
-- adherence was `rules_followed`, one Yes/Partial/No per trade. Neither can
-- answer the question a playbook exists to answer: WHICH individual rule carries
-- the edge, and which one is a ritual you perform because you always have?
--
-- For that, a rule must be a row with its own statistics. tj_position_rules is
-- the join that makes "trades where rule X was followed" a queryable set, so the
-- Phase 3 engine can score a rule the same way it scores a setup grade —
-- including the sample threshold, which matters more here than anywhere: a rule
-- followed on 12 of 15 trades has 3 counter-examples, and a table that does not
-- say so is inviting a conclusion the data cannot support.

-- 1) Playbooks ---------------------------------------------------------------

CREATE TABLE public.tj_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  color text,
  icon text,

  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, name)
);

CREATE INDEX tj_playbooks_user_order_idx
  ON public.tj_playbooks (user_id, sort_order, id);

-- 2) Rule groups -------------------------------------------------------------

CREATE TABLE public.tj_playbook_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playbook_id uuid NOT NULL REFERENCES public.tj_playbooks(id) ON DELETE CASCADE,

  name text NOT NULL CHECK (btrim(name) <> ''),
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tj_playbook_groups_playbook_idx
  ON public.tj_playbook_groups (playbook_id, sort_order, id);

-- 3) Rules -------------------------------------------------------------------

CREATE TABLE public.tj_playbook_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.tj_playbook_groups(id) ON DELETE CASCADE,

  text text NOT NULL CHECK (btrim(text) <> ''),

  -- When the checklist offers this rule. 'winner' rules are review questions
  -- ("did you let it run?") that only make sense once the trade is green.
  show_when text NOT NULL DEFAULT 'always' CHECK (
    show_when IN ('always', 'winner', 'loser', 'breakeven')
  ),

  sort_order integer NOT NULL DEFAULT 0,

  -- Soft delete, and it is not optional.
  --
  -- Same principle 20260728120000 established for the instrument spec: a journal
  -- records what happened, configuration is the current state, and those are not
  -- the same number. Deleting a rule must not move a single historical
  -- statistic, so the row stays and every read filters on deleted_at.
  deleted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tj_playbook_rules_group_idx
  ON public.tj_playbook_rules (group_id, sort_order, id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.tj_playbook_rules.deleted_at IS
  'Soft delete. A rule with checks against it must never disappear from history '
  '— every read of an active checklist filters deleted_at IS NULL, every read of '
  'statistics does not.';

-- 4) Per-trade rule adherence ------------------------------------------------

CREATE TABLE public.tj_position_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id uuid NOT NULL REFERENCES public.tj_positions(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.tj_playbook_rules(id) ON DELETE CASCADE,

  -- Three states, not two. NULL is "not answered", which is different from "not
  -- followed" — counting an unanswered rule as a violation would invent a
  -- discipline problem out of an incomplete form.
  followed boolean,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (position_id, rule_id)
);

CREATE INDEX tj_position_rules_rule_idx
  ON public.tj_position_rules (rule_id, position_id);

-- 5) Trade columns -----------------------------------------------------------

ALTER TABLE public.tj_positions
  ADD COLUMN playbook_id uuid REFERENCES public.tj_playbooks(id) ON DELETE SET NULL,
  -- Conviction is the trader's own 1-5 rating of the setup at entry. Distinct
  -- from setup_grade, which grades the SETUP; this grades the confidence.
  ADD COLUMN conviction smallint CHECK (conviction IS NULL OR conviction BETWEEN 1 AND 5);

CREATE INDEX tj_positions_playbook_idx
  ON public.tj_positions (playbook_id)
  WHERE playbook_id IS NOT NULL;

-- 6) RLS + triggers ----------------------------------------------------------

ALTER TABLE public.tj_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_playbook_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_playbook_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tj_position_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_playbooks_owner ON public.tj_playbooks
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_playbook_groups_owner ON public.tj_playbook_groups
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_playbook_rules_owner ON public.tj_playbook_rules
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY tj_position_rules_owner ON public.tj_position_rules
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_playbooks_updated_at
  BEFORE UPDATE ON public.tj_playbooks
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TRIGGER tj_playbook_groups_updated_at
  BEFORE UPDATE ON public.tj_playbook_groups
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TRIGGER tj_playbook_rules_updated_at
  BEFORE UPDATE ON public.tj_playbook_rules
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

CREATE TRIGGER tj_position_rules_updated_at
  BEFORE UPDATE ON public.tj_position_rules
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- 7) show_when is frozen once a rule has been answered -----------------------
--
-- The stat for a 'winner' rule is "of the winning trades that offered this rule,
-- how many followed it". Flip show_when after the fact and the denominator
-- silently changes shape: answers recorded under one population get reported
-- against another. The UI greys the control out; this trigger is what makes it
-- true, because the UI is not the only way rows get written.

CREATE OR REPLACE FUNCTION public.tj_playbook_rule_freeze_show_when()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.show_when is distinct from old.show_when
     and exists (select 1 from public.tj_position_rules where rule_id = old.id)
  then
    raise exception
      'show_when is locked: rule % already has recorded answers. Create a new rule instead.',
      old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE TRIGGER tj_playbook_rules_freeze_show_when
  BEFORE UPDATE ON public.tj_playbook_rules
  FOR EACH ROW EXECUTE FUNCTION public.tj_playbook_rule_freeze_show_when();

-- 8) Seed --------------------------------------------------------------------
-- One playbook per retired ict_entry_model value, each with the three groups a
-- checklist naturally splits into. Rules are left empty on purpose: a seeded
-- rule you did not write is a rule you will check without reading.

CREATE OR REPLACE FUNCTION public.tj_seed_playbooks(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.tj_playbooks where user_id = target) then
    return;
  end if;

  insert into public.tj_playbooks (user_id, name, sort_order)
  select target, v.name, v.ord
  from (values
    ('2022 Model', 0),
    ('OTE', 1),
    ('Order Block', 2),
    ('FVG', 3),
    ('Turtle Soup', 4),
    ('Silver Bullet', 5)
  ) as v(name, ord);

  insert into public.tj_playbook_groups (user_id, playbook_id, name, sort_order)
  select target, p.id, g.name, g.ord
  from public.tj_playbooks p
  cross join (values
    ('Ulazak', 0),
    ('Izlazak', 1),
    ('Uslovi tržišta', 2)
  ) as g(name, ord)
  where p.user_id = target;
end;
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    PERFORM public.tj_seed_playbooks(r.id);
  END LOOP;
END $$;

-- Fold into the signup seed so new users get the same starting point.
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
end;
$function$;
