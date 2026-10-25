-- staff-tables-permission-rls, stage 0 (design D0; requirement "New objects in `public` are closed to client roles by
-- default"), proved as a test rather than by hand: a table, a sequence and a function created by the migration role
-- (postgres) in `public` give anon and authenticated nothing, service_role keeps its usual privileges, and on the
-- existing tables anon holds nothing except SELECT on packages and faq_items.
-- Created with `npx supabase test new database/000-default-privileges`; run with
--   SUPABASE_DB_PORT=54322 npx supabase test db --local supabase/tests/database
-- One transaction, rolled back: the probe objects never survive the run.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- New objects, created as postgres (the role every migration runs as).
create table public.rls_default_probe (id bigint generated always as identity primary key, note text);
create function public.rls_default_probe_fn() returns integer language sql as 'select 1';

select table_privs_are('public', 'rls_default_probe', 'anon', array[]::name[], 'a new table: anon holds no privilege');
select table_privs_are('public', 'rls_default_probe', 'authenticated', array[]::name[], 'a new table: authenticated holds no privilege');
select ok(
  has_table_privilege('service_role', 'public.rls_default_probe', 'SELECT')
    and has_table_privilege('service_role', 'public.rls_default_probe', 'INSERT')
    and has_table_privilege('service_role', 'public.rls_default_probe', 'UPDATE')
    and has_table_privilege('service_role', 'public.rls_default_probe', 'DELETE'),
  'a new table: service_role keeps select, insert, update and delete'
);
select ok(
  not has_sequence_privilege('anon', 'public.rls_default_probe_id_seq', 'USAGE')
    and not has_sequence_privilege('authenticated', 'public.rls_default_probe_id_seq', 'USAGE'),
  'a new sequence: anon and authenticated hold no USAGE'
);
select ok(has_sequence_privilege('service_role', 'public.rls_default_probe_id_seq', 'USAGE'), 'a new sequence: service_role keeps USAGE');
select ok(not has_function_privilege('anon', 'public.rls_default_probe_fn()', 'EXECUTE'), 'a new function: anon cannot execute it');
select ok(not has_function_privilege('authenticated', 'public.rls_default_probe_fn()', 'EXECUTE'), 'a new function: authenticated cannot execute it');
-- A NULL proacl would mean the built-in default (EXECUTE to PUBLIC), so the ACL must exist and name no PUBLIC entry.
select ok(
  (select proacl is not null
            and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
     from pg_proc where oid = 'public.rls_default_probe_fn()'::regprocedure),
  'a new function: PUBLIC holds no EXECUTE'
);
select ok(has_function_privilege('service_role', 'public.rls_default_probe_fn()', 'EXECUTE'), 'a new function: service_role keeps EXECUTE');

-- Existing tables: anon holds nothing anywhere except the two public reads.
select is(
  (select coalesce(string_agg(c.relname || ':' || p, ',' order by c.relname, p), '')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and c.relname <> 'rls_default_probe'
      and has_table_privilege('anon', c.oid, p)),
  'faq_items:SELECT,packages:SELECT',
  'existing tables: anon holds only SELECT on faq_items and packages'
);
-- And the public reads still answer anon (requirement scenario "Existing anonymous access is unchanged").
set local role anon;
select lives_ok($$select count(*) from public.packages where active; select count(*) from public.faq_items where published$$, 'anon still reads active packages and published FAQ items');
reset role;

select * from finish();
rollback;
