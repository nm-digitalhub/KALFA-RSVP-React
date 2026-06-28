-- =====================================================================
-- Multi-tenant org layer (Phase 1 — ADDITIVE, backward-compatible).
-- Adds organizations + members + invitations, FOUR FIXED global roles whose
-- permissions are DATA (permission_definitions + role_permissions), a single
-- authorization function has_org_permission(), an org_id on events, and an
-- idempotent backfill of one "personal org" per existing event owner.
--
-- NOTHING destructive: events.owner_id is kept, and the existing event-scoped
-- RLS policies (owns_event/has_role) are left UNTOUCHED. Switching those to
-- org membership is a later phase that first introspects their exact names.
--
-- Principles:
--   * NO hardcoded authorization facts: roles, the permission catalog, and the
--     role→permission mapping are seeded as DATA here and read at runtime via
--     has_org_permission(). No permission list lives in application code.
--   * Two role layers stay separate: platform staff = user_roles+has_role('admin')
--     (unchanged, sees all); customer org roles = this file.
--   * Two-tier enforcement: DB RLS = tenant isolation; fine-grained verbs are
--     enforced in the app/DAL layer via has_org_permission().
--   * Billing unchanged (no seat/subscription/entitlement).
-- All guards (if not exists / on conflict) make the file safe to re-run.
-- =====================================================================

-- ---------- A. tables ----------

-- Global permission catalog (resource × action). DATA, seeded below.
create table if not exists public.permission_definitions (
  id         uuid primary key default gen_random_uuid(),
  resource   text not null,
  action     text not null,
  label      text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  constraint permission_definitions_resource_action_unique unique (resource, action)
);

-- The four FIXED global roles. DATA, seeded below. No organization_id (global).
create table if not exists public.org_roles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,           -- owner | admin | member | viewer
  label         text not null,
  description   text,
  is_owner_role boolean not null default false, -- protected role (last-owner checks)
  rank          int not null default 0,         -- owner>admin>member>viewer (anti-escalation)
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- Global role → permission mapping. DATA, seeded below.
create table if not exists public.role_permissions (
  id            uuid primary key default gen_random_uuid(),
  role_id       uuid not null references public.org_roles(id) on delete cascade,
  permission_id uuid not null references public.permission_definitions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint role_permissions_role_permission_unique unique (role_id, permission_id)
);

-- Organizations (the tenant container).
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- Org membership (user + fixed role per org).
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role_id         uuid not null references public.org_roles(id),
  created_at      timestamptz not null default now(),
  constraint organization_members_org_user_unique unique (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);
create index if not exists organization_members_org_idx  on public.organization_members (organization_id);

-- Invitations (opaque-token, RSVP-style posture).
create table if not exists public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role_id         uuid not null references public.org_roles(id),
  token           text not null unique,
  invited_by      uuid not null references auth.users(id),
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users(id),
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists organization_invitations_org_idx on public.organization_invitations (organization_id);
create unique index if not exists organization_invitations_active_uniq
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- Audit log for membership/role changes (written via service-role).
create table if not exists public.organization_audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid not null references auth.users(id),
  action          text not null,
  target_user_id  uuid references auth.users(id),
  target_role_id  uuid references public.org_roles(id),
  details         jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists organization_audit_log_org_idx on public.organization_audit_log (organization_id, created_at desc);

-- ---------- B. events.org_id (additive; owner_id KEPT) ----------
alter table public.events
  add column if not exists org_id uuid references public.organizations(id);
create index if not exists events_org_idx on public.events (org_id);

-- ---------- C. seed catalog + roles + mapping (DATA) ----------
insert into public.permission_definitions (resource, action, label, sort_order) values
  ('events','view','אירועים — צפייה',10),
  ('events','create','אירועים — יצירה',11),
  ('events','edit','אירועים — עריכה',12),
  ('events','delete','אירועים — מחיקה',13),
  ('guests','view','אורחים — צפייה',20),
  ('guests','create','אורחים — יצירה',21),
  ('guests','edit','אורחים — עריכה',22),
  ('guests','delete','אורחים — מחיקה',23),
  ('contacts','view','אנשי קשר — צפייה',30),
  ('contacts','create','אנשי קשר — יצירה',31),
  ('contacts','edit','אנשי קשר — עריכה',32),
  ('contacts','delete','אנשי קשר — מחיקה',33),
  ('campaigns','view','קמפיינים — צפייה',40),
  ('campaigns','create','קמפיינים — יצירה',41),
  ('campaigns','edit','קמפיינים — עריכה',42),
  ('campaigns','delete','קמפיינים — מחיקה',43),
  ('campaigns','manage','קמפיינים — ניהול',44),
  ('reports','view','דוחות — צפייה',50),
  ('billing','view','חיוב — צפייה',60),
  ('members','view','חברי צוות — צפייה',70),
  ('members','manage','חברי צוות — ניהול',71),
  ('organization','view','ארגון — צפייה',80),
  ('organization','edit','ארגון — עריכה',81),
  ('organization','manage','ארגון — ניהול',82)
on conflict (resource, action) do nothing;

insert into public.org_roles (name, label, description, is_owner_role, rank, sort_order) values
  ('owner','בעלים','בעל הארגון — שליטה מלאה',true,40,40),
  ('admin','מנהל','ניהול הצוות, האירועים והאורחים',false,30,30),
  ('member','חבר','עריכת אירועים ואורחים',false,20,20),
  ('viewer','צופה','צפייה בלבד',false,10,10)
on conflict (name) do nothing;

-- owner → all permissions
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.org_roles r, public.permission_definitions p
  where r.name = 'owner'
on conflict (role_id, permission_id) do nothing;

-- admin → all except organization.edit (only the owner renames the org)
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.org_roles r, public.permission_definitions p
  where r.name = 'admin'
    and not (p.resource = 'organization' and p.action = 'edit')
on conflict (role_id, permission_id) do nothing;

-- member → curated edit set
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.org_roles r
  join public.permission_definitions p on true
  join (values
    ('events','view'),('events','create'),('events','edit'),
    ('guests','view'),('guests','create'),('guests','edit'),
    ('contacts','view'),('contacts','create'),('contacts','edit'),
    ('campaigns','view'),('campaigns','create'),('campaigns','edit'),
    ('reports','view'),('billing','view'),('members','view'),('organization','view')
  ) as allowed(resource, action)
    on allowed.resource = p.resource and allowed.action = p.action
  where r.name = 'member'
on conflict (role_id, permission_id) do nothing;

-- viewer → every *.view
insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.org_roles r, public.permission_definitions p
  where r.name = 'viewer' and p.action = 'view'
on conflict (role_id, permission_id) do nothing;

-- ---------- D. authorization functions (SECURITY DEFINER → no RLS recursion) ----------

-- The single source of truth for fine-grained permissions. Used by the app/DAL
-- layer; available to RLS but event RLS stays verb-free (isolation only).
create or replace function public.has_org_permission(_org_id uuid, _resource text, _action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    join public.permission_definitions p on p.id = rp.permission_id
    where m.organization_id = _org_id
      and m.user_id = auth.uid()
      and p.resource = _resource
      and p.action = _action
  );
$$;

-- Coarse membership primitive — the RLS isolation check.
create or replace function public.is_org_member(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = _org_id and m.user_id = auth.uid()
  );
$$;

-- Org-aware event access gate (used by the DAL). Backward-compatible: the legacy
-- single owner always has full access, even before/without org backfill.
create or replace function public.can_access_event(_event_id uuid, _resource text default 'events', _action text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = _event_id
      and (
        e.owner_id = auth.uid()
        or (e.org_id is not null and public.has_org_permission(e.org_id, _resource, _action))
      )
  );
$$;

-- Role rank for anti-escalation checks in the app layer.
create or replace function public.org_role_rank(_role_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select rank from public.org_roles where id = _role_id;
$$;

-- Create an org and make the caller its first owner member, atomically.
create or replace function public.create_organization(_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _org_id uuid; _uid uuid := auth.uid(); _owner_role uuid;
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  if coalesce(btrim(_name), '') = '' then raise exception 'name required'; end if;
  select id into _owner_role from public.org_roles where is_owner_role limit 1;
  if _owner_role is null then raise exception 'owner role missing'; end if;
  insert into public.organizations (name, created_by) values (_name, _uid) returning id into _org_id;
  insert into public.organization_members (organization_id, user_id, role_id)
    values (_org_id, _uid, _owner_role);
  return _org_id;
end; $$;

-- Accept a pending, unexpired, non-revoked invitation. Single-use; email-matched.
create or replace function public.accept_invitation(_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _inv public.organization_invitations; _uid uuid := auth.uid(); _email text;
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  select * into _inv from public.organization_invitations
    where token = _token and accepted_at is null and revoked_at is null and expires_at > now()
    for update;
  if not found then raise exception 'invitation invalid'; end if;
  select email into _email from auth.users where id = _uid;
  if _email is not null and lower(_email) <> lower(_inv.email) then
    raise exception 'invitation email mismatch';
  end if;
  insert into public.organization_members (organization_id, user_id, role_id)
    values (_inv.organization_id, _uid, _inv.role_id)
    on conflict (organization_id, user_id) do nothing;
  update public.organization_invitations
    set accepted_at = now(), accepted_by = _uid
    where id = _inv.id;
  return _inv.organization_id;
end; $$;

-- ---------- E. RLS for the new tables ----------

-- Global catalog tables: readable by any authenticated user; only platform staff
-- may change them (customers never edit roles → reinforces "fixed roles").
alter table public.permission_definitions enable row level security;
drop policy if exists permission_definitions_select on public.permission_definitions;
create policy permission_definitions_select on public.permission_definitions for select
  using (auth.uid() is not null);
drop policy if exists permission_definitions_admin_all on public.permission_definitions;
create policy permission_definitions_admin_all on public.permission_definitions for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

alter table public.org_roles enable row level security;
drop policy if exists org_roles_select on public.org_roles;
create policy org_roles_select on public.org_roles for select
  using (auth.uid() is not null);
drop policy if exists org_roles_admin_all on public.org_roles;
create policy org_roles_admin_all on public.org_roles for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

alter table public.role_permissions enable row level security;
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select
  using (auth.uid() is not null);
drop policy if exists role_permissions_admin_all on public.role_permissions;
create policy role_permissions_admin_all on public.role_permissions for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- organizations: members read; org 'organization.edit' (owner) renames; staff ALL.
alter table public.organizations enable row level security;
drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations for select
  using (public.is_org_member(id) or public.has_role(auth.uid(),'admin'::app_role));
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update
  using (public.has_org_permission(id,'organization','edit') or public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_org_permission(id,'organization','edit') or public.has_role(auth.uid(),'admin'::app_role));
drop policy if exists organizations_admin_all on public.organizations;
create policy organizations_admin_all on public.organizations for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- organization_members: members read the roster; 'members.manage' manages it.
alter table public.organization_members enable row level security;
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members for select
  using (public.is_org_member(organization_id) or public.has_role(auth.uid(),'admin'::app_role));
drop policy if exists organization_members_manage on public.organization_members;
create policy organization_members_manage on public.organization_members for all
  using (public.has_org_permission(organization_id,'members','manage') or public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_org_permission(organization_id,'members','manage') or public.has_role(auth.uid(),'admin'::app_role));

-- organization_invitations: 'members.manage' manages; acceptance is via RPC.
alter table public.organization_invitations enable row level security;
drop policy if exists organization_invitations_manage on public.organization_invitations;
create policy organization_invitations_manage on public.organization_invitations for all
  using (public.has_org_permission(organization_id,'members','manage') or public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_org_permission(organization_id,'members','manage') or public.has_role(auth.uid(),'admin'::app_role));

-- organization_audit_log: 'organization.manage' reads; writes via service-role only.
alter table public.organization_audit_log enable row level security;
drop policy if exists organization_audit_log_select on public.organization_audit_log;
create policy organization_audit_log_select on public.organization_audit_log for select
  using (public.has_org_permission(organization_id,'organization','manage') or public.has_role(auth.uid(),'admin'::app_role));
drop policy if exists organization_audit_log_admin_all on public.organization_audit_log;
create policy organization_audit_log_admin_all on public.organization_audit_log for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ---------- F. backfill: one personal org per existing owner (idempotent) ----------
-- Iterates only owners that still have un-orged events, so re-running is safe.
do $$
declare r record; _org_id uuid; _owner_role uuid;
begin
  select id into _owner_role from public.org_roles where is_owner_role limit 1;
  if _owner_role is null then raise exception 'owner role missing — seed roles first'; end if;
  for r in
    select distinct owner_id from public.events
    where owner_id is not null and org_id is null
  loop
    insert into public.organizations (name, created_by)
      values ('הארגון שלי', r.owner_id)
      returning id into _org_id;
    insert into public.organization_members (organization_id, user_id, role_id)
      values (_org_id, r.owner_id, _owner_role)
      on conflict (organization_id, user_id) do nothing;
    update public.events set org_id = _org_id
      where owner_id = r.owner_id and org_id is null;
  end loop;
end $$;

-- NOTE: events.org_id is left NULLABLE here on purpose. A follow-up migration
-- sets NOT NULL only after backfill is verified (no events with null org_id).
