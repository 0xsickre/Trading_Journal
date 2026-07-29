-- Re-assert EXECUTE grants that a function rebuild silently handed back to PUBLIC.
--
-- Four SECURITY INVOKER functions were found with EXECUTE granted to `anon`:
--
--   tj_add_option_item(uuid, text)
--   tj_add_option_list(text, text, text)
--   tj_replace_executions(uuid, jsonb)
--   tj_set_updated_at()
--
-- tj_replace_executions is the one that shows the mechanism. Its own migration
-- (20260728121000) ends with an explicit `REVOKE ALL ... FROM public`. That revoke was
-- undone by a LATER migration, tj_replace_executions_owner_from_position, which recreated
-- the function — and a fresh CREATE FUNCTION grants EXECUTE to PUBLIC by default, which
-- `anon` inherits. The revoke was never re-asserted afterwards.
--
-- This is the same trap already written down for views in 20260728120000:
--
--   "CREATE VIEW resets view options, so this must be re-asserted after every rebuild."
--
-- Same failure mode, different object type. 20260729140000_harden_playbook_function_grants
-- closed this for the playbook functions; these four were missed.
--
-- Severity is low and this is not a data hole: all four are SECURITY INVOKER, so RLS still
-- applies to the caller, and `anon` has no policy on any tj_ table — every tj_*_owner
-- policy is `TO authenticated`. An anonymous call to tj_replace_executions therefore finds
-- no visible position and raises no_data_found. This is defense in depth, and it stops the
-- functions showing up in a security advisor sweep.
--
-- If you ever CREATE OR REPLACE one of these after a DROP, come back and re-run this.

REVOKE ALL ON FUNCTION public.tj_add_option_item(uuid, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tj_add_option_list(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tj_replace_executions(uuid, jsonb)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tj_set_updated_at()                  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tj_add_option_item(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tj_add_option_list(text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tj_replace_executions(uuid, jsonb)
  TO authenticated, service_role;

-- tj_set_updated_at gets no GRANT back here, and does not need one: it is a trigger
-- function, and PostgreSQL does not check EXECUTE when firing a trigger.
--
-- It nonetheless still shows EXECUTE for `authenticated` after this migration, and that is
-- correct rather than a leftover — the privilege is a DIRECT grant from
-- tj_harden_updated_at_fn, not the PUBLIC grant this file revokes. Verified post-apply:
-- proacl is {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}, with
-- no PUBLIC entry. Only the anon-via-PUBLIC path was closed.
