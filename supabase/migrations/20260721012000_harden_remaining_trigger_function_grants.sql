-- Close the last three functions in `public` that PUBLIC can still execute.
--
-- FOUND BY a full sweep of the schema after 20260721005000 fixed the ineffective
-- `revoke ... from anon` on is_console_agent(). The question that sweep answered
-- was whether that mistake — revoking from a role while PUBLIC still holds the
-- privilege, which is a no-op — had been repeated elsewhere.
--
-- RESULT OF THE SWEEP (49 functions in `public`, measured with
-- has_function_privilege rather than by reading migrations):
--   * 0 functions carry a NULL proacl (nothing was left at the raw default);
--   * exactly 3 grant EXECUTE to PUBLIC, listed below;
--   * all 3 are `RETURNS trigger` AND `SECURITY INVOKER`;
--   * of the 16 trigger functions in the schema, the other 13 are already
--     revoked from public/anon/authenticated — these 3 are the only outliers.
--
-- SEVERITY: none. This is consistency, not an exposure. A trigger function
-- cannot be invoked directly at all — `select public.set_updated_at()` raises
-- 0A000 "trigger functions can only be called as triggers" (verified live) —
-- and being SECURITY INVOKER they would run with the caller's own privileges and
-- RLS regardless. They are closed because leaving three functions off the
-- pattern invites the next reader to conclude the pattern is optional.
--
-- The house pattern being restored is 20260630230249, which revoked exactly this
-- way for events_guard_update / campaigns_require_active_event /
-- campaigns_guard_cancel.
--
-- SAFE — the privilege is NOT what makes a trigger fire. Verified live in a
-- rolled-back transaction: after these three revokes,
-- has_function_privilege('authenticated','public.set_updated_at()','EXECUTE')
-- is false, yet an UPDATE issued while impersonating `authenticated` still
-- succeeded AND updated_at was actually bumped by the trigger. Postgres invokes
-- a trigger function through the trigger mechanism, which does not consult the
-- statement issuer's EXECUTE privilege.
--
-- DELIBERATELY NOT TOUCHED: the 14 SECURITY DEFINER functions that `authenticated`
-- may execute. Every one is required, and revoking would break the app rather
-- than harden it:
--   * 8 are called from RLS policy expressions (can_access_event alone in 26
--     policies). Policy expressions are evaluated with the QUERYING role's
--     privileges — proven by revoking EXECUTE on is_console_agent() from
--     authenticated in a rolled-back transaction, which turned a working read
--     into `42501 permission denied for function is_console_agent`.
--   * the rest are invoked server-side through the cookie client, which is also
--     the `authenticated` role (e.g. accept_invitation, create_organization,
--     claim_first_admin, is_staff).
-- The `authenticated_security_definer_function_executable` advisor warnings on
-- those are inherent to the RLS-gate architecture, not defects. Their security
-- boundary is inside the function: each resolves auth.uid() itself rather than
-- trusting a caller-supplied identity. has_role() does take a _user_id argument,
-- but every policy calling it passes auth.uid() — audited, no exceptions.
--
-- ROLLBACK:
--   grant execute on function public.set_updated_at() to public;
--   grant execute on function public.events_before_insert() to public;
--   grant execute on function public.campaign_authorized_set_audit_no_mutate() to public;

revoke execute on function public.set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.events_before_insert()
  from public, anon, authenticated;
revoke execute on function public.campaign_authorized_set_audit_no_mutate()
  from public, anon, authenticated;
