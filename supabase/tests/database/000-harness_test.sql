-- staff-tables-permission-rls, task 1.3: the runner and the actor fixture.
-- Created with `npx supabase test new database/000-harness`; run with
--   npx supabase test db --local supabase/tests/database/000-harness_test.sql
-- Everything below runs in one transaction that is rolled back: no row, role or extension survives the run.
--
-- The fixture is the one scripts/gen-staff-table-rls.ts renders for its actors (src/lib/auth/staff-table-rls.ts,
-- renderActorSetup): a staff member on a SEEDED role, and one on a TEMPORARY role holding exactly one permission.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select pass('the pgTAP runner reaches the local database');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'rls-a001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'rls-a002@test.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'rls-a003@test.invalid');

-- A: the seeded billing_clerk role, as it is in the catalogue today.
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000a001', id, '00000000-0000-4000-8000-00000000a001'
  from public.platform_roles where name = 'billing_clerk';

-- B: a temporary role holding exactly manage_voice (same statements as the generated actors, rank 0 included).
insert into public.platform_roles (id, name, label, is_owner_role, rank)
  values ('00000000-0000-4000-8000-00000000b001', 'rls_test_harness', 'RLS test: harness', false, 0);
insert into public.platform_role_permissions (role_id, permission_id)
  select '00000000-0000-4000-8000-00000000b001', id from public.platform_permission_definitions where key = 'manage_voice';
insert into public.platform_staff (user_id, role_id, granted_by)
  values ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a002');

-- C (a003): signed in, not staff.

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';
select is((select public.has_platform_permission('manage_billing')), true, 'billing_clerk holds manage_billing');
select is((select public.has_platform_permission('manage_voice')), false, 'billing_clerk does not hold manage_voice');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a002';
select is((select public.has_platform_permission('manage_voice')), true, 'the temporary role holds manage_voice');
select is((select public.has_platform_permission('manage_billing')), false, 'the temporary role holds nothing else');
select is((select public.is_platform_staff()), true, 'the temporary role makes its member platform staff');

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a003';
select is((select public.is_platform_staff()), false, 'a signed-in non-staff user is not platform staff');
select is((select public.has_platform_permission('manage_voice')), false, 'a signed-in non-staff user holds no key');

set local role anon;
select throws_ok(
  $$select public.has_platform_permission('manage_voice')$$,
  '42501',
  null,
  'anon cannot call has_platform_permission'
);

select * from finish();
rollback;
