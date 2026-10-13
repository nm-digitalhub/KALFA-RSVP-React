-- Minimal reproduction, run as role "postgres" in a brand-new scratch database.
-- Supabase guide "Database functions > Function privileges" (option 2), statements copied verbatim:
\echo '--- STEP 0: baseline, a function created before any default-privilege change'
create function public.f0() returns int language sql as 'select 1';
select 'f0 proacl='||coalesce(proacl::text,'NULL')||'  anon_can_execute='||has_function_privilege('anon','public.f0()','execute') from pg_proc where proname='f0';

\echo '--- STEP 1: the two statements from the guide'
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
select 'pg_default_acl rows now: '||coalesce(string_agg(coalesce(n.nspname,'(global)')||' '||d.defaclobjtype::text||'='||d.defaclacl::text, ' ; '),'none') from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace;
create function public.f1() returns int language sql as 'select 1';
select 'f1 (created AFTER step 1) proacl='||coalesce(proacl::text,'NULL')||'  anon_can_execute='||has_function_privilege('anon','public.f1()','execute')||'  authenticated_can_execute='||has_function_privilege('authenticated','public.f1()','execute') from pg_proc where proname='f1';

\echo '--- STEP 2: the same revoke WITHOUT "in schema" (global form)'
alter default privileges revoke execute on functions from public;
create function public.f2() returns int language sql as 'select 1';
select 'f2 (created AFTER step 2) proacl='||coalesce(proacl::text,'NULL')||'  anon_can_execute='||has_function_privilege('anon','public.f2()','execute')||'  authenticated_can_execute='||has_function_privilege('authenticated','public.f2()','execute') from pg_proc where proname='f2';
