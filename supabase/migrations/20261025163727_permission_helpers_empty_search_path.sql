-- staff-tables-permission-rls, stage S6 (task 7.1): pin search_path to empty on the two permission helpers.
--
-- is_platform_staff() and has_platform_permission(text) are SECURITY DEFINER and every staff-table policy calls one of
-- them; both ran with `search_path=public`. The Supabase database-functions guide and Advisor lint 0011: a definer
-- function must pin search_path, and '' forces every name in the body to be schema-qualified, so no object placed
-- earlier on a caller's path can be picked up. Both bodies already name public.platform_staff, public.platform_roles,
-- public.platform_role_permissions, public.platform_permission_definitions and auth.uid() in full (pg_get_functiondef,
-- local and live, 25.10.2026), so only the setting changes: no body, return type, volatility or grant is touched.
--
-- Proof: supabase/tests/database/s6_helpers_test.sql (shape and behaviour), and every staff-table pgTAP file, which call
-- the helpers through the policies.
--
-- ROLLBACK (live catalog, read-only query of 25.10.2026; the local catalog was identical):
--   alter function public.is_platform_staff() set search_path = public;
--   alter function public.has_platform_permission(text) set search_path = public;

alter function public.is_platform_staff() set search_path = '';
alter function public.has_platform_permission(text) set search_path = '';
