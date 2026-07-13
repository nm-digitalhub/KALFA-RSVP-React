-- UI-editable, per-role, DB-driven org (customer) RBAC.
-- Spec:  docs/superpowers/specs/2026-07-13-org-rbac-editable-per-role-design.md
-- Plan:  docs/superpowers/specs/2026-07-13-org-rbac-editable-per-role-plan.md
--
-- Additive, copy-on-write. The global `role_permissions` table is KEPT UNTOUCHED
-- and becomes a frozen factory-default template: after this migration
-- `has_org_permission()` reads the new org-scoped `organization_role_permissions`
-- table instead. Existing effective authorization is preserved (see the backfill
-- exclusions below and the spec's §6 verification plan). Mirrors the platform
-- Owner/Staff RBAC in 20260713171233_platform_rbac_owner_staff.sql.
--
-- ROLLBACK (additive forward migration, no data loss — see spec §5):
--   1. drop the 4 org_role_permissions_* triggers;
--   2. `create or replace` has_org_permission() back to its pre-migration body
--      (reads role_permissions — verbatim below for reference);
--   3. revert guests_owner_delete / gg_owner_delete back to `owns_event(event_id)`;
--   4. if Phase 7 (app deleteGuest/deleteGroup gate swap) shipped, revert it in the
--      SAME window (must land together — see spec §5 rollback note).
--   Leave the two new tables in place, unused. role_permissions is never dropped.
-- Pre-migration has_org_permission body (for rollback):
--   select exists (select 1 from organization_members m
--     join role_permissions rp on rp.role_id = m.role_id
--     join permission_definitions p on p.id = rp.permission_id
--     where m.organization_id = _org_id and m.user_id = auth.uid()
--       and p.resource = _resource and p.action = _action);

-- (No explicit begin/commit — the Supabase CLI wraps each migration in a
--  single transaction, matching the convention of 20260713171233 and the
--  other recent migrations.)

-- 1. system_protected flag on the permission catalog ------------------------
alter table public.permission_definitions
  add column if not exists system_protected boolean not null default false;

update public.permission_definitions
  set system_protected = true
  where (resource, action) in (('campaigns','create'), ('campaigns','manage'));

-- 2. org-scoped role->permission matrix -------------------------------------
create table if not exists public.organization_role_permissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  role_id          uuid not null references public.org_roles(id),
  permission_id    uuid not null references public.permission_definitions(id),
  granted_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (organization_id, role_id, permission_id)
);
create index if not exists organization_role_permissions_org_role_idx
  on public.organization_role_permissions (organization_id, role_id);

-- 3. append-only audit log (mirrors platform_role_audit_log) -----------------
--    actor_id nullable: service-role writes carry no auth.uid(); the real actor
--    is additionally recorded via logActivity() in the data layer.
create table if not exists public.organization_role_audit_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  actor_id         uuid,
  action           text not null,
  target_role_id   uuid,
  details          jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists organization_role_audit_log_org_idx
  on public.organization_role_audit_log (organization_id, created_at desc);

-- 4. backfill existing orgs (idempotent) ------------------------------------
--    Seed ALL 4 roles for EVERY org (not only roles that currently have a
--    member) so a later invite/role-change to a previously-unused role already
--    has its grants. Two exclusions:
--      (a) system_protected permission for a non-owner role (permanent
--          invariant, also trigger-enforced);
--      (b) ('guests','delete') for a non-owner role — the §3.9 revoke-with-opt-in
--          rule (one-time backfill decision; an owner may grant it back via UI).
insert into public.organization_role_permissions (organization_id, role_id, permission_id)
select o.id, rp.role_id, rp.permission_id
from public.organizations o
cross join public.role_permissions rp
join public.org_roles r on r.id = rp.role_id
join public.permission_definitions p on p.id = rp.permission_id
where not (p.system_protected and not r.is_owner_role)
  and not (p.resource = 'guests' and p.action = 'delete' and not r.is_owner_role)
on conflict (organization_id, role_id, permission_id) do nothing;

-- 5. new orgs get the same seed (all 4 roles, same 2 exclusions) -------------
create or replace function public.create_organization(_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _org_id uuid; _uid uuid := auth.uid(); _owner_role uuid;
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  if coalesce(btrim(_name), '') = '' then raise exception 'name required'; end if;
  select id into _owner_role from public.org_roles where is_owner_role limit 1;
  if _owner_role is null then raise exception 'owner role missing'; end if;
  insert into public.organizations (name, created_by) values (_name, _uid) returning id into _org_id;
  insert into public.organization_members (organization_id, user_id, role_id)
    values (_org_id, _uid, _owner_role);
  -- seed the org-scoped permission matrix from the frozen template (all 4 roles)
  insert into public.organization_role_permissions (organization_id, role_id, permission_id)
  select _org_id, rp.role_id, rp.permission_id
  from public.role_permissions rp
  join public.org_roles r on r.id = rp.role_id
  join public.permission_definitions p on p.id = rp.permission_id
  where not (p.system_protected and not r.is_owner_role)
    and not (p.resource = 'guests' and p.action = 'delete' and not r.is_owner_role);
  return _org_id;
end; $function$;

-- 6. is_org_owner() — owner-flag check (stricter than organization.manage,
--    which admin also holds). Mirrors is_platform_owner().
create or replace function public.is_org_owner(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.org_roles r on r.id = m.role_id
    where m.organization_id = _org_id
      and m.user_id = (select auth.uid())
      and r.is_owner_role
  );
$$;
revoke all on function public.is_org_owner(uuid) from public;
grant execute on function public.is_org_owner(uuid) to authenticated;

-- 7. has_org_permission() rewrite — reads the org-scoped table now, with the
--    read-time system_protected guard (Q2 belt-and-suspenders).
create or replace function public.has_org_permission(_org_id uuid, _resource text, _action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organization_role_permissions orp
      on orp.organization_id = m.organization_id and orp.role_id = m.role_id
    join public.permission_definitions p on p.id = orp.permission_id
    where m.organization_id = _org_id
      and m.user_id = (select auth.uid())
      and p.resource = _resource
      and p.action = _action
      and (
        not p.system_protected
        or exists (
          select 1 from public.org_roles r
          where r.id = m.role_id and r.is_owner_role
        )
      )
  );
$$;

-- 8. guardrail triggers — created LAST so the backfill/seed above do not fire
--    the audit trigger. 4 triggers (protect_system / protect_owner /
--    no_update / audit).
create or replace function public.org_role_permissions_protect_system()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select p.system_protected from public.permission_definitions p where p.id = new.permission_id)
     and not (select r.is_owner_role from public.org_roles r where r.id = new.role_id)
  then
    raise exception 'הרשאה זו מוגנת ואינה ניתנת להאצלה מעבר לבעלים';
  end if;
  return new;
end; $$;

create or replace function public.org_role_permissions_protect_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select r.is_owner_role from public.org_roles r where r.id = old.role_id) then
    raise exception 'לא ניתן לשנות את הרשאות תפקיד הבעלים — הן קבועות';
  end if;
  return old;
end; $$;

create or replace function public.org_role_permissions_no_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'עדכון ישיר של שורת הרשאה אינו נתמך — השתמש בהענקה או בשלילה';
end; $$;

create or replace function public.org_role_permissions_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.organization_role_audit_log
    (organization_id, actor_id, action, target_role_id, details)
  values (
    coalesce(new.organization_id, old.organization_id),
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'permission_granted' else 'permission_revoked' end,
    coalesce(new.role_id, old.role_id),
    jsonb_build_object('permission_id', coalesce(new.permission_id, old.permission_id))
  );
  return null;
end; $$;

drop trigger if exists org_role_permissions_protect_system on public.organization_role_permissions;
create trigger org_role_permissions_protect_system
  before insert on public.organization_role_permissions
  for each row execute function public.org_role_permissions_protect_system();

drop trigger if exists org_role_permissions_protect_owner on public.organization_role_permissions;
create trigger org_role_permissions_protect_owner
  before delete on public.organization_role_permissions
  for each row execute function public.org_role_permissions_protect_owner();

drop trigger if exists org_role_permissions_no_update on public.organization_role_permissions;
create trigger org_role_permissions_no_update
  before update on public.organization_role_permissions
  for each row execute function public.org_role_permissions_no_update();

drop trigger if exists org_role_permissions_audit on public.organization_role_permissions;
create trigger org_role_permissions_audit
  after insert or delete on public.organization_role_permissions
  for each row execute function public.org_role_permissions_audit();

-- 9a. RLS on the new tables — owner-only read (platform staff retain read) ----
alter table public.organization_role_permissions enable row level security;
drop policy if exists organization_role_permissions_owner_select on public.organization_role_permissions;
create policy organization_role_permissions_owner_select
  on public.organization_role_permissions for select to authenticated
  using (
    public.is_org_owner(organization_id)
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

alter table public.organization_role_audit_log enable row level security;
drop policy if exists organization_role_audit_log_owner_select on public.organization_role_audit_log;
create policy organization_role_audit_log_owner_select
  on public.organization_role_audit_log for select to authenticated
  using (
    public.is_org_owner(organization_id)
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
  );

-- 9b. D4 — RLS DELETE swap: owner-only -> org-permission-aware -----------------
--     (paired with the Phase-7 app-gate swap; init-plan-unsafe by nature —
--     can_access_event is evaluated per-row against event_id, same as the 12
--     existing Phase-3 policies.)
drop policy if exists "guests_owner_delete" on public.guests;
create policy "guests_org_delete" on public.guests
  for delete to authenticated
  using (public.can_access_event(event_id, 'guests', 'delete'));

drop policy if exists "gg_owner_delete" on public.guest_groups;
create policy "gg_org_delete" on public.guest_groups
  for delete to authenticated
  using (public.can_access_event(event_id, 'guests', 'delete'));
