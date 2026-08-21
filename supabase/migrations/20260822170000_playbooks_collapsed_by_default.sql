-- Flips which playbook state needs no history: expanded, not collapsed.
--
-- 20260819220000 made this list hold COLLAPSED ids on purpose, reasoning that
-- an id absent from the array — a playbook the trader has never touched —
-- should default to expanded, "the least surprising state". That was right
-- for the card the list rendered at the time: fully expanded WAS the useful
-- view, so a page you had never customized showing everything open was the
-- sane default.
--
-- The list is a compact table now (see the playbook-card grid header): every
-- number worth a glance at is already visible collapsed, and expanding is a
-- deliberate "I want to edit this one's rules" action. So the untouched state
-- should default to COLLAPSED, and by the same "absent means the default"
-- idiom this column follows elsewhere in `tj_user_prefs`, that means the
-- column has to hold EXPANDED ids instead — a plain rename, not a value
-- rewrite, because this account has no `tj_user_prefs` row yet (confirmed live
-- before writing this: zero rows), so there is no existing collapsed-set to
-- invert.

ALTER TABLE public.tj_user_prefs
  RENAME COLUMN playbooks_collapsed TO playbooks_expanded;

COMMENT ON COLUMN public.tj_user_prefs.playbooks_expanded IS
  'Playbook ids EXPANDED on /playbooks. Empty means every playbook is '
  'collapsed, the state every account starts in. An id for a deleted '
  'playbook is inert — nothing reads it back — so this is never cleaned up '
  'on delete.';
