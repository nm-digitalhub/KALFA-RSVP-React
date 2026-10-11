-- The owner agent's read-only SQL may call guest_effective_attending, as its primer tells it to.
--
-- WHY: the owner agent's execute_sql runs as supabase_read_only_user (src/lib/owner-agent/runner.ts, `--read-only`), and
-- its primer (src/lib/owner-agent/consumer/primer.ts) gives "attending people = sum(guest_effective_attending(g))".
-- 20260706135941_over_invited_business_flag.sql revoked EXECUTE from PUBLIC — the grant every role inherits by default
-- (Supabase auth-hooks guide: "By default every role inherits execute from the public role") — and granted it back to
-- authenticated and service_role only. The read-only role was not in that list. Measured on the live project
-- 11.10.2026: the 08:30 daily report's query failed with 42501 "permission denied for function
-- guest_effective_attending"; has_function_privilege('supabase_read_only_user', …, 'EXECUTE') = false.
--
-- WHAT IT DOES: grants EXECUTE on that one function to supabase_read_only_user. It widens no data access: the role is a
-- member of pg_read_all_data and bypasses RLS (measured), so it already reads every guests row; the function is
-- SECURITY INVOKER, STABLE, and only computes a headcount from the row it is given.
--
-- WHAT IT DOES NOT DO: change the function, or any grant to anon, authenticated, service_role or PUBLIC.
--
-- ROLLBACK:
--   revoke execute on function public.guest_effective_attending(public.guests) from supabase_read_only_user;

grant execute on function public.guest_effective_attending(public.guests) to supabase_read_only_user;
