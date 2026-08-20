-- Which playbook cards start collapsed on /playbooks.
--
-- The page renders every playbook fully expanded — header, risk/A+ inputs,
-- headline metrics, and a full rule table that can run to dozens of rows.
-- That reads fine with one or two playbooks. With five it is a page you
-- scroll PAST to find the one you came for, every single visit.
--
-- Same shape as `dashboard_hidden_widgets`, same reason: a list stored as
-- "collapsed" rather than "expanded" means a playbook created after this
-- ships is absent from the array and therefore expanded — the least
-- surprising state for something the trader has never touched. Collapsing is
-- an action taken ON a playbook, so the ids belong in a set of exceptions,
-- not a flag on `tj_playbooks` — this is a VIEW preference, not a property of
-- the playbook, and does not touch history the way `is_active` deliberately
-- does.
--
-- No default-collapsed-past-N-playbooks behaviour is encoded here. That would
-- be a second, silent default fighting the stored one — a sixth playbook
-- would jump state on a page load with nothing clicked. The page instead
-- offers Collapse all / Expand all, so reaching the compact view a five-book
-- account wants is one click, not a guess baked into a migration.

ALTER TABLE public.tj_user_prefs
  ADD COLUMN IF NOT EXISTS playbooks_collapsed text[] NOT NULL DEFAULT '{}'
    CHECK (array_length(playbooks_collapsed, 1) IS NULL
           OR array_length(playbooks_collapsed, 1) <= 200);

COMMENT ON COLUMN public.tj_user_prefs.playbooks_collapsed IS
  'Playbook ids collapsed on /playbooks. Empty means every playbook is '
  'expanded, the state every account starts in. An id for a deleted playbook '
  'is inert — nothing reads it back — so this is never cleaned up on delete.';
