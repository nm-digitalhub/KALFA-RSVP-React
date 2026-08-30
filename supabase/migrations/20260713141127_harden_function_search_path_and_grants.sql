-- Security hardening (defense-in-depth) — NO behavior change.
-- Source: full RLS + function audit 2026-07-13 (all 38 tables CORRECT/BY-DESIGN;
-- zero real security holes). This migration covers only the non-table hygiene:
--   5a. pin search_path=public on two of our own trigger functions (lint 0011).
--   5b/5c. remove the EXECUTE surface of five functions from anon (and, for the
--          two internal trigger/maintenance functions, from authenticated too).
--
-- IMPORTANT — why REVOKE FROM PUBLIC (not just anon): pg_proc ACL shows these
-- functions carry a PUBLIC EXECUTE grant (=X), so `REVOKE ... FROM anon` alone is
-- a NO-OP (anon still executes via PUBLIC). We revoke PUBLIC + anon together.
-- All five functions already fail closed for anon (they RAISE when auth.uid() is
-- NULL), and handle_new_user is an AFTER-INSERT trigger (trigger execution does
-- not check EXECUTE), so this changes no runtime behavior — it only shrinks the
-- directly-callable API surface. Kept callable: authenticated + service_role for
-- the three genuine RPCs; postgres/service_role only for the two internal ones.

-- Shadow-DB replay repair (27.8.2026): `public.profiles` was never created
-- either — handle_new_user() below inserts into it, and 20260713143941's own
-- documentation shows own_profile_read/own_profile_write/profiles_admin_read
-- as pre-existing. All verbatim from `supabase db dump` / that file's
-- comments.
create table if not exists public.profiles (
  id uuid primary key,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sales_referral_attempt_id uuid
);

alter table public.profiles enable row level security;

create policy own_profile_read on public.profiles for select
  using (auth.uid() = id);

create policy own_profile_write on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy profiles_admin_read on public.profiles for select
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Shadow-DB replay repair (27.8.2026): `public.claim_first_admin()` was never
-- created by any migration (same drift as the rest bootstrapped this
-- session) — this file only REVOKEs on it. Verbatim from `supabase db dump`.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql security definer
set search_path to 'public'
as $$
declare
  admin_count int;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  select count(*) into admin_count from public.user_roles where role = 'admin';
  if admin_count > 0 then
    return false;
  end if;
  insert into public.user_roles(user_id, role) values (auth.uid(), 'admin')
    on conflict do nothing;
  return true;
end;
$$;

-- Same drift, same fix: `public.handle_new_user()` was never created either
-- (this file only REVOKEs on it, below in 5c). Verbatim from `supabase db
-- dump`. References public.profiles, which the function body does not need
-- to exist yet to be CREATEd (plpgsql bodies aren't validated against object
-- existence until executed) — profiles is bootstrapped separately if/when a
-- later migration references it directly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  ref_text text;
  ref_uuid uuid;
begin
  ref_text := new.raw_user_meta_data->>'sales_referral_attempt_id';
  if ref_text is not null and ref_text <> '' then
    begin
      ref_uuid := ref_text::uuid;
    exception when others then
      ref_uuid := null;
    end;
  end if;

  insert into public.profiles (id, full_name, phone, sales_referral_attempt_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    ref_uuid
  );
  return new;
end;
$$;

-- Same drift, same fix: `public.rls_auto_enable()` (an event-trigger function
-- that auto-enables RLS on newly created public tables) was never created
-- either. Verbatim from `supabase db dump`.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog', 'information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

-- == 5a. Pin search_path on our SECURITY INVOKER trigger functions ============
alter function public.set_updated_at() set search_path = public;
alter function public.campaign_authorized_set_audit_no_mutate() set search_path = public;

-- == 5b. Genuine RPCs -- remove anon; keep authenticated + service_role =======
revoke execute on function public.accept_invitation(_token text)   from public, anon;
revoke execute on function public.create_organization(_name text)  from public, anon;
revoke execute on function public.claim_first_admin()              from public, anon;

-- == 5c. Internal trigger / maintenance functions -- remove anon + authenticated
--        (not meant to be called via the Data API at all) =====================
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
