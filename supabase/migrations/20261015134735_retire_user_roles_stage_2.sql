-- STAGE 2 of the legacy user_roles retirement: drop has_role(), user_roles and the app_role enum.
--
-- STATUS: APPLIED to the live database on 15.10.2026 by the owner (supabase db push). This header was a "NOT APPLIED / do not
-- push" warning until then; only these comment lines were edited afterwards, no SQL statement was touched.
-- This migration deletes a table. After applying: `npm run gen:types` (the deploy gate `types:check` compares the committed
-- types with the LIVE database), then update docs/project/02-auth-and-authorization.md 6.1 and 03-database-schema.md.
-- Review notes and the test results: plans/user-roles-retirement-stage-2.md
--
-- Stage 1 is live (20261015114659) and its build was deployed 15.10.2026 15:59: no policy, function, view, trigger, FK or
-- application code reads these objects any more. Measured on the live catalog before this migration (15.10.2026):
--   user_roles : 4 columns (id, user_id, role app_role, created_at); PK; UNIQUE (user_id, role);
--                FK user_id -> auth.users ON DELETE CASCADE (an OUTGOING key - dropping this table does not touch auth.users);
--                no FK pointing INTO it; no triggers; one policy (ur_self_read); no dependent view.
--   has_role   : SQL SECURITY DEFINER; no pg_depend dependents; the only function using the app_role type.
--   app_role   : enum ('admin','user'); only user_roles.role uses it.
--   rows       : 3, all role = admin (2 of the 3 users also hold a platform_staff row; the third never signed in).
--   code       : no reference in src/, scripts/, worker/, supabase/functions, the relocation wizard, tests or seeds;
--                only the generated types and historical migrations (which replay in order, so they still work).
--
-- NO CASCADE anywhere below: if a dependency was missed, the statement fails and the whole migration rolls back.
-- The three rows are backed up OUTSIDE the database (local, not in git): ops-evidence/user_roles-backup-20261015.sql.
--
-- ROLLBACK (re-create, then restore the rows from the backup file above):
--   create type public.app_role as enum ('admin', 'user');
--   create table public.user_roles (
--     id         uuid primary key default gen_random_uuid(),
--     user_id    uuid not null references auth.users (id) on delete cascade,
--     role       public.app_role not null,
--     created_at timestamptz not null default now(),
--     constraint user_roles_user_id_role_key unique (user_id, role)
--   );
--   alter table public.user_roles enable row level security;
--   create policy ur_self_read on public.user_roles for select to authenticated
--     using (user_id = (select auth.uid()));
--   grant select, references, trigger on public.user_roles to authenticated;
--   grant all on public.user_roles to service_role;
--   create or replace function public.has_role(_user_id uuid, _role public.app_role)
--     returns boolean language sql stable security definer set search_path to 'public' as $$
--       select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
--     $$;
--   grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
--   -- then run ops-evidence/user_roles-backup-20261015.sql
-- Nothing else needs restoring: no policy, function or code uses these objects after stage 1.

-- 0. Preconditions: refuse to drop anything that is still in use.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename <> 'user_roles'
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(has_role\(|user_roles)';
  if n <> 0 then
    raise exception 'stage 2 aborted: % policy(ies) still reference has_role / user_roles', n;
  end if;

  select count(*) into n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'has_role'
     and (pg_get_functiondef(p.oid) ~* 'has_role\(' or pg_get_functiondef(p.oid) ilike '%user_roles%');
  if n <> 0 then
    raise exception 'stage 2 aborted: % function(s) still reference has_role / user_roles', n;
  end if;

  select count(distinct v.oid) into n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v on v.oid = r.ev_class
   where d.refobjid = 'public.user_roles'::regclass and v.oid <> 'public.user_roles'::regclass;
  if n <> 0 then
    raise exception 'stage 2 aborted: % view(s) depend on user_roles', n;
  end if;

  select count(*) into n from pg_constraint where confrelid = 'public.user_roles'::regclass;
  if n <> 0 then
    raise exception 'stage 2 aborted: % foreign key(s) point into user_roles', n;
  end if;

  select count(*) into n
    from pg_trigger where tgrelid = 'public.user_roles'::regclass and not tgisinternal;
  if n <> 0 then
    raise exception 'stage 2 aborted: % trigger(s) on user_roles', n;
  end if;

  select count(*) into n
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_type t on t.oid = a.atttypid
   where t.typname = 'app_role' and a.attnum > 0 and not a.attisdropped
     and c.relkind in ('r', 'v', 'm', 'p') and c.relnamespace = 'public'::regnamespace
     and c.relname <> 'user_roles';
  if n <> 0 then
    raise exception 'stage 2 aborted: % column(s) outside user_roles use the app_role type', n;
  end if;

  select count(*) into n from public.user_roles where role <> 'admin';
  if n <> 0 then
    raise exception 'stage 2 aborted: user_roles holds % non-admin row(s) - the backup file only covers the 3 admin rows', n;
  end if;
end $$;

-- 1. The drops. Order: the function (uses the table and the type), then the table (uses the type, takes its
--    ur_self_read policy and indexes with it), then the type. No CASCADE.
drop function public.has_role(uuid, public.app_role);
drop table public.user_roles;
drop type public.app_role;

-- 2. Proof, in the same transaction.
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'has_role') then
    raise exception 'has_role still exists';
  end if;
  if to_regclass('public.user_roles') is not null then
    raise exception 'user_roles still exists';
  end if;
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'app_role') then
    raise exception 'app_role still exists';
  end if;
end $$;
