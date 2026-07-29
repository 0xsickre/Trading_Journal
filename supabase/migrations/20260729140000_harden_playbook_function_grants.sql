-- Close the grant hole 20260729130000 opened.
--
-- New functions inherit EXECUTE for PUBLIC, which means `anon` too. For
-- tj_seed_playbooks(target uuid) that is a real hole: the function is
-- SECURITY DEFINER, so it bypasses RLS, and it takes the target user as an
-- ARGUMENT — anyone could call it over `/rest/v1/rpc/tj_seed_playbooks` with
-- somebody else's uuid and write rows into their account.
--
-- 20260620151646_tj_seed_harden_grants established the pattern for exactly this:
-- a uuid-taking seed function is reachable only by postgres and service_role,
-- and end users get the no-argument `tj_seed_my_defaults()` wrapper that derives
-- the target from auth.uid(). tj_seed_playbooks was added after that migration
-- and therefore missed it. There is no wrapper to add here — the function is
-- called from tj_seed_defaults, which is itself already locked down.
--
-- The trigger function is revoked for hygiene rather than for a live risk:
-- calling it over RPC errors out ("can only be called as a trigger"), but a
-- SECURITY DEFINER function should not be in the exposed API surface at all.
-- Revoking EXECUTE does not stop the trigger from firing — a trigger runs under
-- the table owner's rights and the privilege is only checked when the trigger is
-- created.

REVOKE ALL ON FUNCTION public.tj_seed_playbooks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_seed_playbooks(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tj_seed_playbooks(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.tj_playbook_rule_freeze_show_when() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_playbook_rule_freeze_show_when() FROM anon;
REVOKE ALL ON FUNCTION public.tj_playbook_rule_freeze_show_when() FROM authenticated;
