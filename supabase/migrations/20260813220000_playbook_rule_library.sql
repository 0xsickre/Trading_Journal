-- Rules become a LIBRARY. A playbook becomes a selection from it.
--
-- Until now a rule lived in exactly one group in exactly one playbook:
--
--     tj_playbook_rules.group_id → tj_playbook_groups.id → tj_playbooks.id
--
-- so the same rule used by two playbooks had to be typed twice, became TWO
-- rule ids, and its statistics split in half. "Did waiting for the sweep pay?"
-- then had two half-answers and no whole one — which defeats the reason the
-- rule answers are recorded at all.
--
-- Done NOW because the tables are empty: 0 playbooks, 0 groups, 0 rules, 0
-- answers. The same change once answers exist is a data migration that has to
-- decide which duplicate id survives and how to merge two histories.

-- 1) The playbook carries its operating model -------------------------------
--
-- Research on what a playbook actually is agrees it is not a list of rules: it
-- is the setup, its invalidation, the RISK MODEL, and what separates a standard
-- setup from an A+ one. The last part matters because an A+ label has to DO
-- something — size or management — or it is decoration.

ALTER TABLE public.tj_playbooks
  -- Suggested, never imposed: the trade form offers it only into an empty
  -- field, so a deliberate 0.5 % on a marginal setup is never overwritten.
  ADD COLUMN IF NOT EXISTS default_risk_pct numeric
    CHECK (default_risk_pct IS NULL
           OR (default_risk_pct > 0 AND default_risk_pct <= 100)),
  ADD COLUMN IF NOT EXISTS a_plus_criteria text;

COMMENT ON COLUMN public.tj_playbooks.default_risk_pct IS
  'Suggested risk for this setup. Prefills the trade form only when the field is empty.';
COMMENT ON COLUMN public.tj_playbooks.a_plus_criteria IS
  'What earns an A+ grade for THIS setup. Shown next to setup_grade on the trade form.';

-- 2) Rules become flat and user-scoped --------------------------------------
--
-- `category` replaces the per-playbook group. Five values, closed set, mirrored
-- by RULE_CATEGORIES in playbook-types.ts.
--
-- `no_trade` is new in substance, not just in name: nothing in the schema could
-- express "this is when I stand aside", and standing aside is the decision a
-- playbook most needs to make explicit. A no-trade rule is answerable exactly
-- like the others — on a trade you took, "the setup was outside my window" is
-- answered false.

ALTER TABLE public.tj_playbook_rules
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'entry'
    CHECK (category IN ('context', 'entry', 'management', 'exit', 'no_trade'));

ALTER TABLE public.tj_playbook_rules
  DROP COLUMN IF EXISTS group_id;

CREATE INDEX IF NOT EXISTS tj_playbook_rules_user_category_idx
  ON public.tj_playbook_rules (user_id, category, sort_order, id);

COMMENT ON TABLE public.tj_playbook_rules IS
  'The user''s rule library, flat. A rule is written once and linked into any number of playbooks via tj_playbook_rule_links, so its answers stay under one id.';

-- 3) The link: a playbook is a selection ------------------------------------

CREATE TABLE public.tj_playbook_rule_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playbook_id uuid NOT NULL REFERENCES public.tj_playbooks(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.tj_playbook_rules(id) ON DELETE CASCADE,

  -- Order WITHIN the playbook. The same rule can sit third in one book and
  -- first in another, which is why the ordinal lives on the link and not on the
  -- rule.
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Linking the same rule twice into one playbook would show it twice on the
  -- checklist and count its answer twice in the follow rate.
  UNIQUE (playbook_id, rule_id)
);

CREATE INDEX tj_playbook_rule_links_playbook_idx
  ON public.tj_playbook_rule_links (playbook_id, sort_order, id);

CREATE INDEX tj_playbook_rule_links_rule_idx
  ON public.tj_playbook_rule_links (rule_id);

ALTER TABLE public.tj_playbook_rule_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_playbook_rule_links_owner ON public.tj_playbook_rule_links
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 4) Groups are gone ---------------------------------------------------------
--
-- Nothing is lost: the table held only a name and an ordinal, and the naming
-- job it did is now the rule's own `category`. Its rules cascaded from it, which
-- is precisely the coupling being removed — unlinking a rule from a playbook
-- must not destroy the rule or its recorded history.

DROP TABLE IF EXISTS public.tj_playbook_groups;

-- NOTE, deliberately: `show_when` and its freeze trigger stay exactly as they
-- are. It carries real weight — "did you let it run?" has no denominator
-- outside winners — and freezing it once answered is what stops the denominator
-- moving under recorded observations.
