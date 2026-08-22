-- A one-line description on an option item.
--
-- Written for playbook sections, where the line under the heading ("The
-- standing read, before you look for an entry.") was a constant in the app —
-- `RULE_CATEGORY_HINTS`, keyed by the five values this repo used to seed. That
-- made it unrenameable by the person it describes: a trader who renames
-- "Context" to "Bias" kept a sentence written for someone else's vocabulary,
-- and a section they invented got no line at all.
--
-- Nullable, and the app still falls back to the built-in hint when it is null,
-- so nothing changes for a section nobody has edited. The column is on
-- `tj_option_items` rather than a playbook-specific table because sections ARE
-- option items — the same rows the tag manager edits — and a second place to
-- store "what this value means" would immediately disagree with the first.

ALTER TABLE public.tj_option_items
  ADD COLUMN description text;

COMMENT ON COLUMN public.tj_option_items.description IS
  'Optional one-line explanation shown under the item. Used by playbook '
  'sections for the hint beside the heading; null falls back to the built-in '
  'text for the seeded values.';
