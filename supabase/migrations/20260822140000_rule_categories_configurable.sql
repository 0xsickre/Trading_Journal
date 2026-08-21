-- Rule categories stop being five values chosen by this repo.
--
-- WHAT WAS WRONG. `tj_playbook_rules.category` carried
-- `CHECK IN ('context','entry','management','exit','no_trade')`, and
-- `playbook-card.tsx` rendered ALL FIVE sections whether or not a book used
-- them — deliberately, with a comment arguing that an empty "No-trade" section
-- is a useful prompt. That argument assumed the five were the right five.
--
-- They are somebody else's taxonomy. A trader whose method is "these are the
-- conditions to get in, these are the conditions to get out, and here is the
-- risk rule" gets three headings they wrote and two they did not, permanently
-- empty, on every playbook. The empty section stops reading as a prompt and
-- starts reading as a form that does not fit.
--
-- THE MECHANISM ALREADY EXISTED. `tj_option_lists` / `tj_option_items` is how
-- this journal has always handled a set the trader owns: seeded with defaults,
-- renameable, reorderable, archivable, and edited in Settings with no code
-- change. `exit_reason`, `miss_reason` and `setup_grade` all work that way. The
-- category was the odd one out, hardcoded because it happened to be added as an
-- enum first.
--
-- SO: the CHECK goes, and the five become a seeded `rule_category` list. Nothing
-- moves for an existing rule — the same five values are seeded under the same
-- keys, so every rule keeps the category it had and the app looks identical
-- until the trader edits the list.
--
-- ARCHIVED, NOT DELETED, and the UI depends on it. `tj_option_items.is_active`
-- hides a value from the pickers while history keeps resolving it. A rule filed
-- under a category the trader later switches off must still appear on the
-- playbook — the reading code appends any category that has rules even when the
-- list no longer offers it. Hiding rules because a heading was retired would be
-- data loss by presentation.
--
-- NO DATABASE CHECK REPLACES THE OLD ONE, and that is a real trade-off rather
-- than an oversight. The permitted set is now per-user rows, so a CHECK cannot
-- see it; enforcing it would take a trigger joining tj_option_items on every
-- rule write. The value is a display grouping — no statistic keys on it, no
-- denominator counts it, and `follow_rate` and the setup score both ignore it
-- entirely. A typo produces a section with an odd name, not a wrong number, so
-- the guard lives in the server action where the message can be read.

ALTER TABLE public.tj_playbook_rules
  DROP CONSTRAINT IF EXISTS tj_playbook_rules_category_check;

COMMENT ON COLUMN public.tj_playbook_rules.category IS
  'Which section of the playbook this rule is drawn under. Values come from the '
  'user''s `rule_category` option list, not from a fixed set. Presentation only: '
  'no metric groups or counts by it.';

-- Seed the list for users who already exist. Guarded per user so a trader who
-- has already edited theirs is never overwritten.
INSERT INTO public.tj_option_lists (user_id, key, label, category, sort_order)
SELECT DISTINCT ol.user_id, 'rule_category', 'Playbook Sections', 'ICT Setup', 17
  FROM public.tj_option_lists ol
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tj_option_lists x
    WHERE x.user_id = ol.user_id AND x.key = 'rule_category'
 );

INSERT INTO public.tj_option_items (user_id, list_id, value, label, sort_order)
SELECT l.user_id, l.id, v.value, v.label, v.ord
  FROM public.tj_option_lists l
  CROSS JOIN (VALUES
    ('context',    'Context',    0),
    ('entry',      'Entry',      1),
    ('management', 'Management', 2),
    ('exit',       'Exit',       3),
    ('no_trade',   'No-trade',   4)
  ) AS v(value, label, ord)
 WHERE l.key = 'rule_category'
   AND NOT EXISTS (
     SELECT 1 FROM public.tj_option_items i
      WHERE i.list_id = l.id AND i.value = v.value
   );
