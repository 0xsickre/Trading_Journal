-- Security fix: run tj_position_stats with the QUERYING user's privileges/RLS
-- instead of the view owner's. As a SECURITY DEFINER view it bypassed RLS on the
-- underlying tables (tj_positions, tj_executions, tj_instruments), so a direct
-- REST query on the view could leak other users' rows.
-- All underlying tj_* tables have owner RLS policies, so with security_invoker on
-- each user still sees exactly their own stats and the app keeps working.
-- (Supabase advisor: 0010_security_definer_view.)

ALTER VIEW public.tj_position_stats SET (security_invoker = on);
