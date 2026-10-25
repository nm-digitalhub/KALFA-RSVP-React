-- staff-tables-permission-rls, stage S4 (task 5.2): packages on manage_billing, per operation.
--
-- src/lib/data/admin/packages.ts reads and writes packages with the staff session after
-- requirePlatformAction(<action>, 'Package'), whose key comes from PLATFORM_ACTIONS.Package (src/lib/casl.ts:
-- read, create, update and delete all need manage_billing). Today `packages_admin_all` admits any platform staff
-- member through `is_platform_staff()`, so auditor and ops_engineer re-price, insert and delete packages and read
-- inactive ones straight through PostgREST (reproduced in src/lib/auth/permissions.local-it.test.ts).
--
-- WHAT IT DOES (design D3, D5, D10): revoke every privilege of anon and authenticated, drop packages_admin_all, grant
-- authenticated select, insert, update and delete with one policy each on manage_billing, and keep the public read
-- `packages_public_read` (anon and authenticated, active = true) with SELECT for anon. RLS stays on; service_role
-- untouched. Every other reader (package-offers.ts, agent-benefits.ts, admin/offers.ts, admin/coupon-assignments.ts,
-- campaigns.ts) uses the service role. Proof: supabase/tests/database/s4_packages_test.sql (generated),
-- s4_packages_paths_test.sql, 000-service-role_test.sql and src/lib/auth/staff-table-sql-consistency.test.ts.
--
-- ROLLBACK (live catalog, read-only query of 25.10.2026; the local catalog was identical):
--   grant select, insert, update, delete, truncate, references, trigger, maintain on table public.packages
--     to authenticated;
--   grant select on table public.packages to anon;
--   drop policy packages_select_permission, packages_insert_permission, packages_update_permission,
--     packages_delete_permission on public.packages;
--   create policy packages_admin_all on public.packages as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   packages_public_read is not touched (for select to anon, authenticated using (active = true)).

-- BEGIN GENERATED: scripts/gen-staff-table-rls.ts (do not edit between the marks)
-- packages: per operation (design D3)
revoke all on table public."packages" from anon, authenticated;
drop policy "packages_admin_all" on public."packages";
grant select, insert, update, delete on table public."packages" to authenticated;
grant select on table public."packages" to anon;
create policy "packages_select_permission" on public."packages" for select to authenticated
  using ((select public.has_platform_permission('manage_billing')));
create policy "packages_insert_permission" on public."packages" for insert to authenticated
  with check ((select public.has_platform_permission('manage_billing')));
create policy "packages_update_permission" on public."packages" for update to authenticated
  using ((select public.has_platform_permission('manage_billing')))
  with check ((select public.has_platform_permission('manage_billing')));
create policy "packages_delete_permission" on public."packages" for delete to authenticated
  using ((select public.has_platform_permission('manage_billing')));
-- END GENERATED
