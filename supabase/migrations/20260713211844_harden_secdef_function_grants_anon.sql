-- Harden EXECUTE grants on PRE-EXISTING SECURITY DEFINER functions flagged by
-- `supabase db advisors --type security` as anon-executable via /rest/v1/rpc.
-- Same class as 20260713205146 (which covered only the org-RBAC Phase-1 fns);
-- this closes the remaining anon-executable SECDEF surface across the org base
-- layer, the platform RBAC layer, and the event/guest predicates.
--
-- SAFETY (verified before writing): every RLS policy that references these
-- predicates is `TO authenticated` (0 policies TO anon/public) — so revoking
-- anon cannot cause a "permission denied for function" in any policy the way a
-- blind revoke of has_role once did. Internal calls from other SECDEF functions
-- run as the definer (postgres), which keeps EXECUTE. No anon RPC path uses
-- them (the browser supabase client is dead code; anon surfaces use their own
-- token-scoped SECDEF RPCs or service_role). `authenticated` is KEPT on the
-- predicates because TO-authenticated policies + the server DAL call them.
--
-- Trigger functions are invoked by triggers (which do NOT check EXECUTE), so
-- they are revoked from every app role — they must never be callable directly.

-- Platform-RBAC trigger functions (from 20260713171233) -----------------------
revoke execute on function public.platform_rbac_audit()                       from public, anon, authenticated;
revoke execute on function public.platform_role_permissions_protect_owner()   from public, anon, authenticated;
revoke execute on function public.platform_staff_prevent_last_owner()         from public, anon, authenticated;

-- Predicate functions: drop anon + public, keep authenticated ------------------
revoke execute on function public.can_access_event(uuid, text, text)  from public, anon;
revoke execute on function public.owns_event(uuid)                    from public, anon;
revoke execute on function public.is_org_member(uuid)                 from public, anon;
revoke execute on function public.is_platform_owner()                 from public, anon;
revoke execute on function public.is_staff()                          from public, anon;
revoke execute on function public.has_platform_permission(text)       from public, anon;
revoke execute on function public.org_role_rank(uuid)                 from public, anon;
