-- Close an unindexed FK the tracker migration left behind.
--
-- tj_tracker_rules has two indexes leading with user_id, and BOTH are partial
-- (`WHERE deleted_at IS NULL`). A partial index cannot serve a query that
-- touches retired rows, so two things had no index at all:
--
--   1. the ON DELETE CASCADE from auth.users, which must find every row
--      including retired ones;
--   2. `getTrackerRules({ includeRetired: true })` — the Settings screen and
--      every statistics read, because compliance has to see a rule that was
--      live on the day being scored even if it is retired today.
--
-- The second is the one that would actually have bitten: retired rules are
-- exactly what the compliance reader needs, so the common path was the
-- unindexed one. Same class of finding as 20260730140000_integrity_guards, which
-- caught it for tj_playbook_rules and tj_playbook_groups — the tracker tables
-- were created after that audit ran and so were never swept.

CREATE INDEX IF NOT EXISTS tj_tracker_rules_user_idx
  ON public.tj_tracker_rules (user_id, id);
