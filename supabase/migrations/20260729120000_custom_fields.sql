-- Phase 4a: trade fields become data.
--
-- macro_align, cot_filter, htf_bias and entry_tf were physical columns. Recording
-- one new idea therefore cost a migration, a form-config edit and a registry
-- edit — so in practice ideas went unrecorded, which is the opposite of what a
-- journal is for. After this migration a field is a row in tj_field_defs, its
-- value lives in tj_positions.custom, and adding one is a form action.
--
-- The columns are dropped in the same migration that introduces `custom`, with
-- no backfill and no dual-write period. That is only correct because
-- tj_positions is EMPTY at the time of writing (verified: 0 rows). Do not copy
-- this shape into a later migration once real trades exist — there the two
-- storage locations must overlap while data is copied across.
--
-- ict_entry_model is NOT migrated to a custom field: Phase 4b promotes it from a
-- trade attribute to a playbook entity, and its six values seed the first
-- playbooks. rules_followed is deleted outright — a single Yes/Partial/No per
-- trade cannot answer which individual rule carries the edge, which is the whole
-- reason the playbook exists.

-- 1) Field definitions ------------------------------------------------------

CREATE TABLE public.tj_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Storage key inside tj_positions.custom. Restricted to an identifier shape so
  -- a key can never collide with jsonb path syntax or with a column name typed
  -- by hand somewhere in the app.
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,48}$'),
  label text NOT NULL CHECK (btrim(label) <> ''),

  field_type text NOT NULL DEFAULT 'select' CHECK (
    field_type IN ('select', 'text', 'textarea', 'number', 'tags', 'url')
  ),

  -- Option list backing a select/tags field. Nullable: text and number fields
  -- have no list. Not a foreign key on purpose — the list is looked up by key,
  -- the same way form-config always has, and a missing list degrades to a plain
  -- input rather than blocking the field from existing.
  list_key text,

  -- Which methodology group on the form this field is rendered in. The form's
  -- STRUCTURE stays in code (tabs, the progressive risk plan, the missed-setup
  -- logic are behaviour, not data); only the field list inside these groups is
  -- data.
  group_id text NOT NULL DEFAULT 'setup' CHECK (
    group_id IN ('macro', 'setup', 'plan_advanced', 'execution_advanced')
  ),

  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,

  -- Reserved for conditional display (Phase 4b uses the same vocabulary for
  -- playbook rules). 'always' is the only value the form honours today.
  show_when text NOT NULL DEFAULT 'always' CHECK (
    show_when IN ('always', 'winner', 'loser', 'breakeven')
  ),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, key)
);

COMMENT ON TABLE public.tj_field_defs IS
  'User-defined trade fields. Values live in tj_positions.custom, keyed by `key`.';

CREATE INDEX tj_field_defs_user_order_idx
  ON public.tj_field_defs (user_id, group_id, sort_order, id);

ALTER TABLE public.tj_field_defs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_field_defs_owner ON public.tj_field_defs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TRIGGER tj_field_defs_updated_at
  BEFORE UPDATE ON public.tj_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.tj_set_updated_at();

-- 2) Value storage ----------------------------------------------------------

ALTER TABLE public.tj_positions
  ADD COLUMN custom jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tj_positions.custom IS
  'Values for user-defined fields, keyed by tj_field_defs.key. Invariant: a key '
  'here must never also be a column on this table — lib/journal/field-values.ts '
  'reads columns first, so a duplicate key would be silently unreachable.';

-- GIN so filtering by a custom field stays an index scan. jsonb_path_ops is the
-- smaller, faster operator class and covers @> containment, which is the only
-- operator a value filter needs.
CREATE INDEX tj_positions_custom_idx
  ON public.tj_positions USING gin (custom jsonb_path_ops);

-- 3) Retire the methodology columns ----------------------------------------

ALTER TABLE public.tj_positions
  DROP COLUMN IF EXISTS macro_align,
  DROP COLUMN IF EXISTS cot_filter,
  DROP COLUMN IF EXISTS htf_bias,
  DROP COLUMN IF EXISTS entry_tf,
  DROP COLUMN IF EXISTS ict_entry_model;

-- 4) Seed field defs for existing users -------------------------------------

INSERT INTO public.tj_field_defs (user_id, key, label, field_type, list_key, group_id, sort_order)
SELECT u.id, v.key, v.label, 'select', v.key, v.group_id, v.ord
FROM auth.users u
CROSS JOIN (values
  ('macro_align', 'Macro Align', 'macro', 0),
  ('cot_filter',  'COT Filter',  'macro', 1),
  ('htf_bias',    'HTF Bias',    'setup', 0),
  ('entry_tf',    'Entry TF',    'plan_advanced', 0)
) AS v(key, label, group_id, ord)
ON CONFLICT (user_id, key) DO NOTHING;

-- 5) Drop the retired option lists -----------------------------------------

DELETE FROM public.tj_option_items
WHERE list_id IN (
  SELECT id FROM public.tj_option_lists
  WHERE key IN ('ict_entry_model', 'rules_followed')
);

DELETE FROM public.tj_option_lists
WHERE key IN ('ict_entry_model', 'rules_followed');

-- Psychology tags merged suggestions from three lists, one of which is gone.
-- Strip the orphaned values off existing trades so the tag dimension does not
-- keep reporting buckets no list can produce any more.
UPDATE public.tj_positions
SET psychology_tags = (
  SELECT coalesce(array_agg(t), '{}')
  FROM unnest(psychology_tags) AS t
  WHERE t NOT IN ('Yes', 'Partial', 'No')
)
WHERE psychology_tags && ARRAY['Yes', 'Partial', 'No'];

-- 6) Reseed function --------------------------------------------------------
-- Same body as 20260728124000, minus the two retired lists (remaining
-- sort_order values closed up so they stay contiguous), plus the field defs.

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

  -- The four methodology fields that used to be columns. Guarded separately from
  -- the option lists: a user who already has lists must still get field defs.
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
end;
$function$;
