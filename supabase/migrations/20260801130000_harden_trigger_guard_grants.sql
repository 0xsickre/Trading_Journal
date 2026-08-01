-- Revoke EXECUTE on two trigger guards that were left reachable over the API.
--
-- `tj_execution_guard()` and `tj_position_missed_guard()` are SECURITY DEFINER
-- trigger functions from 20260729091418_integrity_guards, and both still carry
-- the default PUBLIC grant. That makes them callable as
-- /rest/v1/rpc/tj_execution_guard with a signed-in user's JWT — which the
-- security advisor flags, and which the tracker migration already avoided for
-- its own two guards.
--
-- The practical risk is low: a trigger function called directly raises
-- "trigger functions can only be called as triggers" before it touches
-- anything. It is revoked anyway, because "it happens to fail" is a weaker
-- guarantee than "it is not callable", and because leaving known findings in the
-- sweep trains everyone to ignore the sweep.
--
-- Revoking is safe for the triggers themselves: PostgreSQL checks EXECUTE on a
-- trigger function when the trigger is CREATED, not each time it fires. The same
-- pattern is already live on tj_daily_report_lock_guard and
-- tj_tracker_checkin_lock_guard, whose triggers were verified firing against
-- this database after their revokes.
--
-- tj_seed_my_defaults() is deliberately NOT revoked. It also shows in the sweep,
-- but it takes no arguments and derives everything from auth.uid(), so a signed
-- in user calling it can only seed their own defaults — which is exactly what it
-- exists for. The dangerous shape is the one 20260729140000 fixed: SECURITY
-- DEFINER plus a user id as an argument.

REVOKE ALL ON FUNCTION public.tj_execution_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_execution_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tj_execution_guard() FROM authenticated;

REVOKE ALL ON FUNCTION public.tj_position_missed_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tj_position_missed_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tj_position_missed_guard() FROM authenticated;
