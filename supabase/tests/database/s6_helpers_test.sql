-- staff-tables-permission-rls, stage S6 (tasks 7.1, 7.3): the two permission helpers every staff-table policy calls,
-- is_platform_staff() and has_platform_permission(text), run with an empty search_path (design D7; the Supabase
-- database-functions guide and Advisor lint 0011: a SECURITY DEFINER function must pin search_path, and '' forces every
-- name in its body to be schema-qualified). The shape is asserted from the catalog; the behaviour by calling each
-- function under real sessions, so a body that relied on the old `search_path=public` would fail here. Also the fleet_*
-- entry points and the retired has_role/user_roles axis, read from the catalog.
-- Created with `npx supabase test new database/s6_helpers`; run with
--   SUPABASE_DB_PORT=54322 npx supabase test db --local supabase/tests/database
-- One transaction, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Shape: definer, return type, volatility, the pinned search_path, and the EXECUTE grants left as they were.
select is_definer('public', 'is_platform_staff', array[]::name[], 'is_platform_staff() is SECURITY DEFINER');
select function_returns('public', 'is_platform_staff', array[]::name[], 'boolean', 'is_platform_staff() returns boolean');
select volatility_is('public', 'is_platform_staff', array[]::name[], 'stable', 'is_platform_staff() is STABLE');
select is(
  (select proconfig from pg_proc where oid = 'public.is_platform_staff()'::regprocedure),
  array['search_path=""']::text[],
  'is_platform_staff() pins search_path to empty'
);
select is_definer('public', 'has_platform_permission', array['text']::name[], 'has_platform_permission(text) is SECURITY DEFINER');
select function_returns('public', 'has_platform_permission', array['text']::name[], 'boolean', 'has_platform_permission(text) returns boolean');
select volatility_is('public', 'has_platform_permission', array['text']::name[], 'stable', 'has_platform_permission(text) is STABLE');
select is(
  (select proconfig from pg_proc where oid = 'public.has_platform_permission(text)'::regprocedure),
  array['search_path=""']::text[],
  'has_platform_permission(text) pins search_path to empty'
);
select ok(
  has_function_privilege('authenticated', 'public.is_platform_staff()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.is_platform_staff()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.is_platform_staff()', 'EXECUTE'),
  'is_platform_staff(): EXECUTE for authenticated and service_role, not anon'
);
select ok(
  has_function_privilege('authenticated', 'public.has_platform_permission(text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.has_platform_permission(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.has_platform_permission(text)', 'EXECUTE'),
  'has_platform_permission(text): EXECUTE for authenticated and service_role, not anon'
);

-- Entry points (requirement "Entry-point functions enforce the same permission"): the six fleet_* RPCs a user session
-- calls are SECURITY DEFINER, pin search_path to empty, gate on manage_settings inside, and are not executable by anon
-- or PUBLIC; the service-only definers that write the same tables are not executable by authenticated either.
select ok(
  (select prosecdef and proconfig = array['search_path=""']::text[]
            and prosrc like '%has_platform_permission(''manage_settings'')%'
            and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.fleet_owner_request(text, text, smallint, text, text, uuid)'::regprocedure)
    and has_function_privilege('authenticated', 'public.fleet_owner_request(text, text, smallint, text, text, uuid)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.fleet_owner_request(text, text, smallint, text, text, uuid)'::regprocedure, 'EXECUTE'),
  'fleet_owner_request: definer, empty search_path, gated on manage_settings, executable by authenticated only'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']::text[]
            and prosrc like '%has_platform_permission(''manage_settings'')%'
            and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.fleet_answer_request(uuid, text, text)'::regprocedure)
    and has_function_privilege('authenticated', 'public.fleet_answer_request(uuid, text, text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.fleet_answer_request(uuid, text, text)'::regprocedure, 'EXECUTE'),
  'fleet_answer_request: definer, empty search_path, gated on manage_settings, executable by authenticated only'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']::text[]
            and prosrc like '%has_platform_permission(''manage_settings'')%'
            and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.fleet_goal_create(text, text, text)'::regprocedure)
    and has_function_privilege('authenticated', 'public.fleet_goal_create(text, text, text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.fleet_goal_create(text, text, text)'::regprocedure, 'EXECUTE'),
  'fleet_goal_create: definer, empty search_path, gated on manage_settings, executable by authenticated only'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']::text[]
            and prosrc like '%has_platform_permission(''manage_settings'')%'
            and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.fleet_goal_pause(uuid, text)'::regprocedure)
    and has_function_privilege('authenticated', 'public.fleet_goal_pause(uuid, text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.fleet_goal_pause(uuid, text)'::regprocedure, 'EXECUTE'),
  'fleet_goal_pause: definer, empty search_path, gated on manage_settings, executable by authenticated only'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']::text[]
            and prosrc like '%has_platform_permission(''manage_settings'')%'
            and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.fleet_goal_resume(uuid, timestamp with time zone)'::regprocedure)
    and has_function_privilege('authenticated', 'public.fleet_goal_resume(uuid, timestamp with time zone)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.fleet_goal_resume(uuid, timestamp with time zone)'::regprocedure, 'EXECUTE'),
  'fleet_goal_resume: definer, empty search_path, gated on manage_settings, executable by authenticated only'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']::text[]
            and prosrc like '%has_platform_permission(''manage_settings'')%'
            and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.fleet_goal_abandon(uuid, text)'::regprocedure)
    and has_function_privilege('authenticated', 'public.fleet_goal_abandon(uuid, text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', 'public.fleet_goal_abandon(uuid, text)'::regprocedure, 'EXECUTE'),
  'fleet_goal_abandon: definer, empty search_path, gated on manage_settings, executable by authenticated only'
);
select ok(
  not has_function_privilege('authenticated', 'public.fleet_goal_close(uuid, integer, text, text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fleet_goal_progress(uuid, integer, jsonb, timestamp with time zone, text)'::regprocedure, 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fleet_consume_request(uuid)'::regprocedure, 'EXECUTE'),
  'fleet_goal_close, fleet_goal_progress, fleet_consume_request: service only, not executable by authenticated'
);

-- The retired axis (requirement scenario "Retired axis"): nothing in the current schema references has_role or
-- user_roles, and neither object exists.
select hasnt_function('public', 'has_role', 'has_role() does not exist');
select hasnt_table('public', 'user_roles', 'user_roles does not exist');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'extensions') and p.prosrc ~ '\mhas_role\M|\muser_roles\M')
  + (select count(*) from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~ 'has_role|user_roles')
  + (select count(*) from pg_views where schemaname not in ('pg_catalog', 'information_schema') and definition ~ 'has_role|user_roles'),
  0::bigint,
  'no function body, policy or view references has_role or user_roles'
);

-- Behaviour under real sessions: an owner, a role holding exactly one key, staff holding no key, a signed-in non-staff
-- user, and anon. The pinned setting replaces the caller's search_path while the function runs, so these calls prove the
-- bodies resolve every name with an empty search_path.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e601', 'rls-s6-e601@test.invalid'),
  ('00000000-0000-4000-8000-00000000e602', 'rls-s6-e602@test.invalid'),
  ('00000000-0000-4000-8000-00000000e603', 'rls-s6-e603@test.invalid'),
  ('00000000-0000-4000-8000-00000000e604', 'rls-s6-e604@test.invalid');
insert into public.platform_staff (user_id, role_id, granted_by)
  select '00000000-0000-4000-8000-00000000e601', id, '00000000-0000-4000-8000-00000000e601' from public.platform_roles where is_owner_role;
insert into public.platform_roles (id, name, label, is_owner_role, rank) values
  ('00000000-0000-4000-8000-00000000e691', 'rls_s6_voice', 'RLS test: manage_voice only', false, 0),
  ('00000000-0000-4000-8000-00000000e692', 'rls_s6_none', 'RLS test: no key', false, 0);
insert into public.platform_role_permissions (role_id, permission_id)
  select '00000000-0000-4000-8000-00000000e691', id from public.platform_permission_definitions where key = 'manage_voice';
insert into public.platform_staff (user_id, role_id, granted_by) values
  ('00000000-0000-4000-8000-00000000e602', '00000000-0000-4000-8000-00000000e691', '00000000-0000-4000-8000-00000000e602'),
  ('00000000-0000-4000-8000-00000000e603', '00000000-0000-4000-8000-00000000e692', '00000000-0000-4000-8000-00000000e603');
-- e604: signed in, not staff.

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e601';
select is(public.is_platform_staff(), true, 'owner: is_platform_staff() is true');
select is(public.has_platform_permission('manage_billing'), true, 'owner: has_platform_permission(manage_billing) is true (every key)');
select is(public.has_platform_permission('no_such_key'), true, 'owner: has_platform_permission of an unknown key is true (the owner holds every key, present and future)');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e602';
select is(public.is_platform_staff(), true, 'manage_voice holder: is_platform_staff() is true');
select is(public.has_platform_permission('manage_voice'), true, 'manage_voice holder: has_platform_permission(manage_voice) is true');
select is(public.has_platform_permission('manage_settings'), false, 'manage_voice holder: has_platform_permission(manage_settings) is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e603';
select is(public.is_platform_staff(), true, 'staff holding no key: is_platform_staff() is true');
select is(public.has_platform_permission('manage_voice'), false, 'staff holding no key: has_platform_permission(manage_voice) is false');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e604';
select is(public.is_platform_staff(), false, 'signed-in non-staff: is_platform_staff() is false');
select is(public.has_platform_permission('manage_voice'), false, 'signed-in non-staff: has_platform_permission(manage_voice) is false');
-- A policy that calls the helper still decides: a manage_voice table read by its holder and by staff without the key.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e602';
select isnt_empty($$select key from public.voice_purposes$$, 'manage_voice holder: voice_purposes rows are visible through the helper');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000e603';
select is_empty($$select key from public.voice_purposes$$, 'staff holding no key: voice_purposes rows are hidden by the helper');
set local role anon;
select throws_ok(
  $$select public.has_platform_permission('manage_voice')$$,
  '42501',
  'permission denied for function has_platform_permission',
  'anon cannot call has_platform_permission'
);

reset role;
select * from finish();
rollback;
