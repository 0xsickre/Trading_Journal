-- Setup grade stops being a letter you type and becomes a score you earn.
--
-- WHAT WAS WRONG, and it was wrong rather than merely slow. `setup_grade` is a
-- free-text column with a seeded A+/A/B/C option list, filled in by hand -- and
-- filled in AFTER the outcome is known. A loser gets remembered as a B, a winner
-- as an A+. That corrupts the one dimension the dashboard groups by default, so
-- the grade "explains" performance with a label partly DERIVED from performance.
-- Circular, and invisible while it happens.
--
-- Everything needed to replace it already existed: a rule library
-- (`tj_playbook_rules`), per-trade answers (`tj_position_rules`), a follow-rate
-- metric, and `ruleScorecard`, which already measures win rate when a rule was
-- kept against when it was broken. The only missing fact was WHICH rules define
-- setup quality, as opposed to process.
--
-- ON THE RULE, NOT THE LINK. `tj_playbook_rule_links` would allow a rule to be a
-- criterion in one playbook and not another, which sounds flexible and means the
-- same judgement has to be maintained in several places. What a rule IS does not
-- change with the book it is filed under.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CHECK IS THE SUBSTANCE, NOT DECORATION
--
-- `show_when` selects which trades a rule is asked about: always, or only on a
-- winner / loser / breakeven. A criterion restricted to winners would be
-- HINDSIGHT BY CONSTRUCTION -- it would grade the setup with a question that is
-- only posed once the result is known, which is precisely the defect this whole
-- change exists to remove. So the database refuses the combination outright
-- rather than trusting the UI to avoid offering it.
--
-- Consequence worth knowing: `show_when` is frozen by an existing trigger
-- (20260729130000) as soon as a rule has any recorded answer. A rule already
-- answered under 'winner' therefore cannot be promoted to a criterion at all --
-- it has to be retired and rewritten. That is the honest outcome; silently
-- grading on it would be the alternative.
--
-- PROCESS AND QUALITY STAY SEPARATE. `follow_rate` keeps counting every rule.
-- Mixing the two would mean the setup grade moves when the paperwork is tidied.

ALTER TABLE public.tj_playbook_rules
  ADD COLUMN IF NOT EXISTS is_setup_criterion boolean NOT NULL DEFAULT false;

ALTER TABLE public.tj_playbook_rules
  DROP CONSTRAINT IF EXISTS tj_playbook_rules_criterion_always;

ALTER TABLE public.tj_playbook_rules
  ADD CONSTRAINT tj_playbook_rules_criterion_always
  CHECK (is_setup_criterion = false OR show_when = 'always');

COMMENT ON COLUMN public.tj_playbook_rules.is_setup_criterion IS
  'Does this rule define SETUP QUALITY (as opposed to process)? The share of '
  'criteria met is what the derived setup grade is computed from. Constrained to '
  'show_when = ''always'': a criterion asked only of winners would grade the '
  'setup with hindsight. follow_rate still counts every rule, criterion or not.';

-- Partial index: the score reader asks for criteria only, and in a rule library
-- most rules are not criteria.
CREATE INDEX IF NOT EXISTS tj_playbook_rules_criteria_idx
  ON public.tj_playbook_rules (user_id)
  WHERE is_setup_criterion AND deleted_at IS NULL;
