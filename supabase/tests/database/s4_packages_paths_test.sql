-- staff-tables-permission-rls, stage S4 (task 5.1): the cases of `packages` that s4_packages_test.sql does not generate
-- (HAND_WRITTEN in src/lib/auth/staff-table-rls.ts):
--   * the seeded roles (owner, billing_clerk, ops_engineer, auditor) and a stand-in for support_agent;
--   * the reads under the kept public read `packages_public_read` (anon and authenticated, `active = true`): every
--     session without manage_billing sees the active packages and none of the inactive ones;
--   * the statement shapes of src/lib/data/admin/packages.ts (listPackages, getPackage, the form readers,
--     createPackage, updatePackage, deletePackage) for a holder and for each session without the key.
-- Created with `npx supabase test new database/s4_packages_paths`; run with
--   SUPABASE_DB_PORT=54322 npx supabase test db --local supabase/tests/database
-- One transaction, rolled back: no row, role or grant survives the run.
--
-- support_agent exists in production only (created through the staff UI on 13.07.2026, not by a migration). The
-- stand-in role holds its live keys, read on 25.10.2026: view_activity_log, view_customer_data, view_events.
--
-- A session without the key that writes is refused by its real mechanism: anon has no INSERT, UPDATE or DELETE grant
-- (`permission denied`); an authenticated session holds the grant (holders need it), so its INSERT fails the policy's
-- `with check` (42501) and its UPDATE or DELETE matches no row, followed by a read proving the row intact.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

-- Actors.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d401', 'rls-s4-d401@test.invalid'),
  ('00000000-0000-4000-8000-00000000d402', 'rls-s4-d402@test.invalid'),
  ('00000000-0000-4000-8000-00000000d403', 'rls-s4-d403@test.invalid'),
  ('00000000-0000-4000-8000-00000000d404', 'rls-s4-d404@test.invalid'),
  ('00000000-0000-4000-8000-00000000d405', 'rls-s4-d405@test.invalid'),
  ('00000000-0000-4000-8000-00000000d406', 'rls-s4-d406@test.invalid');
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d401', id, '00000000-0000-4000-8000-00000000d401' from public.platform_roles where name = 'owner';
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d402', id, '00000000-0000-4000-8000-00000000d402' from public.platform_roles where name = 'billing_clerk';
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d403', id, '00000000-0000-4000-8000-00000000d403' from public.platform_roles where name = 'ops_engineer';
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000d404', id, '00000000-0000-4000-8000-00000000d404' from public.platform_roles where name = 'auditor';
insert into public.platform_roles (id, name, label, is_owner_role, rank)
  values ('00000000-0000-4000-8000-00000000d491', 'rls_s4_support_agent', 'RLS test: support_agent stand-in', false, 0);
insert into public.platform_role_permissions (role_id, permission_id)
  select '00000000-0000-4000-8000-00000000d491', id from public.platform_permission_definitions
  where key in ('view_activity_log', 'view_customer_data', 'view_events');
insert into public.platform_staff (user_id, role_id, granted_by)
  values ('00000000-0000-4000-8000-00000000d405', '00000000-0000-4000-8000-00000000d491', '00000000-0000-4000-8000-00000000d405');
-- d406: signed in, not staff (a customer).

-- Row fixtures: one active package (the public read), one inactive (admin data).
insert into public.packages (id, name, tier, price_with_vat, active, sort_order) values
  ('00000000-0000-4000-8000-00000000c411', 'RLS active', 'rls', 10, true, 1),
  ('00000000-0000-4000-8000-00000000c412', 'RLS inactive', 'rls', 20, false, 2);
-- What each session must list, read as postgres.
create temp table s4_expected_all on commit drop as select id from public.packages;
create temp table s4_expected_active on commit drop as select id from public.packages where active;
grant select on s4_expected_all, s4_expected_active to authenticated, anon;

-- The actors hold what the cases assume.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d401';
select is((select public.has_platform_permission('manage_billing')), true, 'owner: manage_billing is true');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d402';
select is((select public.has_platform_permission('manage_billing')), true, 'billing_clerk: manage_billing is true');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d403';
select is((select public.has_platform_permission('manage_billing')), false, 'ops_engineer: manage_billing is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d404';
select is((select public.has_platform_permission('manage_billing')), false, 'auditor: manage_billing is false');
select is((select public.has_platform_permission('view_billing')), true, 'auditor: view_billing is true (and still cannot write)');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d405';
select is((select public.has_platform_permission('manage_billing')), false, 'support_agent (stand-in): manage_billing is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d406';
select is((select public.has_platform_permission('manage_billing')), false, 'signed-in non-staff: manage_billing is false');

-- Reads. Holders of manage_billing: listPackages, getPackage on an inactive row, the form readers (active only).
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d401';
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_all$$, 'packages: owner listPackages returns every package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, array['00000000-0000-4000-8000-00000000c412'], 'packages: owner getPackage reads an inactive package');
select set_eq($$select id from public.packages where active = true order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: owner form readers list the active packages');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d402';
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_all$$, 'packages: billing_clerk listPackages returns every package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, array['00000000-0000-4000-8000-00000000c412'], 'packages: billing_clerk getPackage reads an inactive package');
select set_eq($$select id from public.packages where active = true order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: billing_clerk form readers list the active packages');

-- Every session without manage_billing: the public read only (active rows), no inactive row.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d403';
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: ops_engineer sees the active packages only');
select is_empty($$select id from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, 'packages: ops_engineer does not see the inactive package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c411'$$, array['00000000-0000-4000-8000-00000000c411'], 'packages: ops_engineer reads the active package (public read)');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d404';
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: auditor sees the active packages only');
select is_empty($$select id from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, 'packages: auditor does not see the inactive package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c411'$$, array['00000000-0000-4000-8000-00000000c411'], 'packages: auditor reads the active package (public read)');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d405';
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: support_agent (stand-in) sees the active packages only');
select is_empty($$select id from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, 'packages: support_agent (stand-in) does not see the inactive package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c411'$$, array['00000000-0000-4000-8000-00000000c411'], 'packages: support_agent (stand-in) reads the active package (public read)');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d406';
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: signed-in non-staff sees the active packages only');
select is_empty($$select id from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, 'packages: signed-in non-staff does not see the inactive package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c411'$$, array['00000000-0000-4000-8000-00000000c411'], 'packages: signed-in non-staff reads the active package (public read)');
set local role anon;
select set_eq($$select id from public.packages order by sort_order, name$$, $$select id from s4_expected_active$$, 'packages: anon sees the active packages only');
select is_empty($$select id from public.packages where id = '00000000-0000-4000-8000-00000000c412'$$, 'packages: anon does not see the inactive package');
select results_eq($$select id::text from public.packages where id = '00000000-0000-4000-8000-00000000c411'$$, array['00000000-0000-4000-8000-00000000c411'], 'packages: anon reads the active package (public read)');

-- Writes by every session without manage_billing: createPackage, updatePackage and deletePackage on both rows.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d403';
select throws_ok($$insert into public.packages (name, tier, price_with_vat, active) values ('RLS by ops_engineer', 'rls', 1, false) returning id$$, '42501', 'new row violates row-level security policy for table "packages"', 'packages: ops_engineer createPackage refused (with check)');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: ops_engineer updatePackage on the active package changes no row');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: ops_engineer updatePackage on the inactive package changes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: ops_engineer deletePackage on the active package deletes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: ops_engineer deletePackage on the inactive package deletes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d404';
select throws_ok($$insert into public.packages (name, tier, price_with_vat, active) values ('RLS by auditor', 'rls', 1, false) returning id$$, '42501', 'new row violates row-level security policy for table "packages"', 'packages: auditor createPackage refused (with check)');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: auditor updatePackage on the active package changes no row');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: auditor updatePackage on the inactive package changes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: auditor deletePackage on the active package deletes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: auditor deletePackage on the inactive package deletes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d405';
select throws_ok($$insert into public.packages (name, tier, price_with_vat, active) values ('RLS by support_agent', 'rls', 1, false) returning id$$, '42501', 'new row violates row-level security policy for table "packages"', 'packages: support_agent (stand-in) createPackage refused (with check)');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: support_agent (stand-in) updatePackage on the active package changes no row');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: support_agent (stand-in) updatePackage on the inactive package changes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: support_agent (stand-in) deletePackage on the active package deletes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: support_agent (stand-in) deletePackage on the inactive package deletes no row');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d406';
select throws_ok($$insert into public.packages (name, tier, price_with_vat, active) values ('RLS by a customer', 'rls', 1, false) returning id$$, '42501', 'new row violates row-level security policy for table "packages"', 'packages: signed-in non-staff createPackage refused (with check)');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: signed-in non-staff updatePackage on the active package changes no row');
select is_empty($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: signed-in non-staff updatePackage on the inactive package changes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c411' returning id$$, 'packages: signed-in non-staff deletePackage on the active package deletes no row');
select is_empty($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c412' returning id$$, 'packages: signed-in non-staff deletePackage on the inactive package deletes no row');
set local role anon;
select throws_ok($$insert into public.packages (name, tier, price_with_vat, active) values ('RLS by anon', 'rls', 1, false) returning id$$, '42501', 'permission denied for table packages', 'packages: anon createPackage refused (no grant)');
select throws_ok($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c411'$$, '42501', 'permission denied for table packages', 'packages: anon updatePackage refused (no grant)');
select throws_ok($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c411'$$, '42501', 'permission denied for table packages', 'packages: anon deletePackage refused (no grant)');
reset role;
select results_eq(
  $$select id::text || '/' || price_with_vat::text from public.packages where id in ('00000000-0000-4000-8000-00000000c411', '00000000-0000-4000-8000-00000000c412') order by id$$,
  array['00000000-0000-4000-8000-00000000c411/10.00', '00000000-0000-4000-8000-00000000c412/20.00'],
  'packages: both packages are intact after the refused writes'
);
select is((select count(*) from public.packages where name like 'RLS by %'), 0::bigint, 'packages: no package was created by a refused session');

-- Writes by holders of manage_billing: create, update, delete (each deletes the package it created).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d401';
select results_eq($$insert into public.packages (id, name, tier, price_with_vat, active) values ('00000000-0000-4000-8000-00000000c421', 'RLS created by owner', 'rls', 5, false) returning id::text$$, array['00000000-0000-4000-8000-00000000c421'], 'packages: owner createPackage');
select results_eq($$update public.packages set price_with_vat = 999 where id = '00000000-0000-4000-8000-00000000c412' returning price_with_vat::text$$, array['999.00'], 'packages: owner updatePackage');
select results_eq($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c421' returning id::text$$, array['00000000-0000-4000-8000-00000000c421'], 'packages: owner deletePackage');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000d402';
select results_eq($$insert into public.packages (id, name, tier, price_with_vat, active) values ('00000000-0000-4000-8000-00000000c422', 'RLS created by billing_clerk', 'rls', 5, false) returning id::text$$, array['00000000-0000-4000-8000-00000000c422'], 'packages: billing_clerk createPackage');
select results_eq($$update public.packages set price_with_vat = 998 where id = '00000000-0000-4000-8000-00000000c412' returning price_with_vat::text$$, array['998.00'], 'packages: billing_clerk updatePackage');
select results_eq($$delete from public.packages where id = '00000000-0000-4000-8000-00000000c422' returning id::text$$, array['00000000-0000-4000-8000-00000000c422'], 'packages: billing_clerk deletePackage');

select * from finish();
rollback;
