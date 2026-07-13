-- Harden EXECUTE grants on the org-RBAC functions added in
-- 20260713203826_org_role_permissions_per_role.sql.
--
-- Supabase's default privileges on the `public` schema grant EXECUTE to `anon`
-- and `authenticated` on every new function, so the `revoke ... from public` in
-- the prior migration did not remove the explicit `anon` grant. This migration
-- removes anon (and public) executability, per the same pattern as
-- 20260713141127_harden_function_search_path_and_grants.
--
-- Trigger functions are invoked by triggers, which do NOT check EXECUTE, so
-- revoking from every app role is safe and correct — they should never be
-- callable directly via /rest/v1/rpc.
revoke execute on function public.org_role_permissions_protect_system() from public, anon, authenticated;
revoke execute on function public.org_role_permissions_protect_owner()  from public, anon, authenticated;
revoke execute on function public.org_role_permissions_no_update()      from public, anon, authenticated;
revoke execute on function public.org_role_permissions_audit()          from public, anon, authenticated;

-- Predicates: `authenticated` MUST keep EXECUTE (the DAL calls is_org_owner via
-- rpc as the authenticated user, and 5 `TO authenticated` RLS policies call
-- has_org_permission directly). Only `anon`/`public` are removed — verified no
-- anon-facing policy or RPC path uses either (all callers are TO authenticated;
-- can_access_event calls has_org_permission internally as the SECDEF owner).
revoke execute on function public.is_org_owner(uuid)                       from public, anon;
revoke execute on function public.has_org_permission(uuid, text, text)     from public, anon;
