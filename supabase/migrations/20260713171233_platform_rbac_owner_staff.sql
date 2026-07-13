-- =====================================================================
-- Platform (Owner/Staff) RBAC — UI-editable, ADDITIVE.
--
-- A SECOND role layer for KALFA *platform* staff, mirroring the existing
-- customer ORG RBAC (org_roles / role_permissions / permission_definitions /
-- has_org_permission). This layer governs who inside the operating company may
-- see customer data, manage billing, edit platform settings, manage staff, edit
-- roles, and read the activity log — as DATA, editable from an admin UI.
--
-- Relationship to the existing platform gate: user_roles + has_role('admin') and
-- all of its RLS policies remain UNTOUCHED. This file only ADDS new objects; it
-- never ALTERs/DROPs any pre-existing table, policy, function, or trigger. The
-- backfill seeds a platform_staff 'owner' row for every current has_role('admin')
-- user, so nobody loses access.
--
-- Two role layers already exist and stay separate:
--   * customer org roles  = org_roles + has_org_permission()   (202606280021)
--   * platform admin flag = user_roles + has_role('admin')     (baseline)
-- This adds a THIRD, finer platform layer that is UI-editable (data, not code),
-- reusing the same "permissions are DATA" pattern.
--
-- Principles (identical to the org layer):
--   * NO hardcoded authorization facts: the permission catalog, roles, and the
--     role->permission mapping are seeded as DATA and read at runtime via
--     has_platform_permission(). No permission list lives in application code.
--   * SECURITY DEFINER helpers avoid RLS recursion (mirror has_org_permission /
--     is_org_member). (select auth.uid()) keeps the RLS init-plan cached.
--   * Writes go through the service-role client behind a requirePlatformOwner()
--     app gate (mirrors admin/users.ts). RLS here is owner-only *read* visibility
--     — an additional defense layer, not the primary gate.
--
-- DELIBERATE DEVIATION FROM THE DRAFT CONTRACT (documented):
--   platform_role_audit_log.actor_id is NULLABLE, not NOT NULL. The audit rows
--   are written by AFTER-triggers, but the app's write path is the service-role
--   client (createAdminClient) which carries NO session, so auth.uid() is NULL
--   inside the trigger. Forcing NOT NULL would make every setRolePermission()
--   write FAIL (null actor). Instead the trigger resolves the best actor it can
--   — auth.uid(), else the row's granted_by (staff changes), else the optional
--   `app.actor_id` GUC — and records the action either way. The data layer also
--   calls logActivity() with the real requirePlatformOwner() actor, so the true
--   actor is never lost even when the structured row's actor_id is null.
-- =====================================================================

-- ---------- A. tables (all additive) ----------

-- Platform permission catalog. DATA, seeded below. UI-editable role mapping.
create table if not exists public.platform_permission_definitions (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  category   text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- Platform roles. DATA. 'owner' is the protected, all-permissions role.
create table if not exists public.platform_roles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  label         text not null,
  description   text,
  is_owner_role boolean not null default false,
  rank          int not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- Platform role -> permission mapping. DATA, UI-editable per matrix cell.
create table if not exists public.platform_role_permissions (
  id            uuid primary key default gen_random_uuid(),
  role_id       uuid not null references public.platform_roles(id) on delete cascade,
  permission_id uuid not null references public.platform_permission_definitions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint platform_role_permissions_role_permission_unique unique (role_id, permission_id)
);
create index if not exists platform_role_permissions_role_idx on public.platform_role_permissions (role_id);
create index if not exists platform_role_permissions_permission_idx on public.platform_role_permissions (permission_id);

-- Platform staff — a single role per user (v1). unique(user_id) enforces that.
create table if not exists public.platform_staff (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  role_id    uuid not null references public.platform_roles(id),
  granted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists platform_staff_role_idx on public.platform_staff (role_id);

-- Structured audit log for staff/permission changes (written via AFTER-triggers).
-- actor_id is NULLABLE by design — see the header note.
create table if not exists public.platform_role_audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid,
  action         text not null,
  target_role_id uuid,
  target_user_id uuid,
  details        jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists platform_role_audit_log_created_idx on public.platform_role_audit_log (created_at desc);

-- ---------- B. SECURITY DEFINER authorization helpers ----------

-- Is the caller a PLATFORM OWNER (a staff row whose role is the owner role)?
create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.platform_staff s
    join public.platform_roles r on r.id = s.role_id
    where s.user_id = (select auth.uid())
      and r.is_owner_role
  );
$$;

-- Is the caller ANY platform staff member?
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_staff s where s.user_id = (select auth.uid())
  );
$$;

-- Does the caller hold a specific platform permission (via their role)?
create or replace function public.has_platform_permission(_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.platform_staff s
    join public.platform_role_permissions rp on rp.role_id = s.role_id
    join public.platform_permission_definitions p on p.id = rp.permission_id
    where s.user_id = (select auth.uid())
      and p.key = _key
  );
$$;

revoke all on function public.is_platform_owner() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.has_platform_permission(text) from public;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.has_platform_permission(text) to authenticated;

-- ---------- C. RLS: owner-only READ visibility (writes are service-role) ----------

alter table public.platform_permission_definitions enable row level security;
drop policy if exists platform_permission_definitions_owner_select on public.platform_permission_definitions;
create policy platform_permission_definitions_owner_select on public.platform_permission_definitions
  for select to authenticated using (public.is_platform_owner());

alter table public.platform_roles enable row level security;
drop policy if exists platform_roles_owner_select on public.platform_roles;
create policy platform_roles_owner_select on public.platform_roles
  for select to authenticated using (public.is_platform_owner());

alter table public.platform_role_permissions enable row level security;
drop policy if exists platform_role_permissions_owner_select on public.platform_role_permissions;
create policy platform_role_permissions_owner_select on public.platform_role_permissions
  for select to authenticated using (public.is_platform_owner());

alter table public.platform_staff enable row level security;
drop policy if exists platform_staff_owner_select on public.platform_staff;
create policy platform_staff_owner_select on public.platform_staff
  for select to authenticated using (public.is_platform_owner());

-- audit log: owner-only SELECT; NO update/delete policies (append-only).
alter table public.platform_role_audit_log enable row level security;
drop policy if exists platform_role_audit_log_owner_select on public.platform_role_audit_log;
create policy platform_role_audit_log_owner_select on public.platform_role_audit_log
  for select to authenticated using (public.is_platform_owner());

-- ---------- D. seed catalog + owner role + owner=all mapping (DATA) ----------

insert into public.platform_permission_definitions (key, label, category, sort_order) values
  ('view_customer_data', 'צפייה בנתוני לקוחות',    'support',  10),
  ('manage_billing',     'ניהול חיוב',              'billing',  20),
  ('manage_settings',    'ניהול הגדרות מערכת',      'platform', 30),
  ('manage_staff',       'ניהול צוות',              'platform', 40),
  ('roles.manage',       'ניהול תפקידים והרשאות',   'platform', 50),
  ('view_activity_log',  'צפייה ביומן פעילות',      'ops',      60)
on conflict (key) do nothing;

insert into public.platform_roles (name, label, description, is_owner_role, rank, sort_order) values
  ('owner', 'בעל מערכת', 'בעל המערכת — כל ההרשאות, קבוע', true, 100, 100)
on conflict (name) do nothing;

-- owner -> every permission (immutable; enforced by trigger below)
insert into public.platform_role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.platform_roles r, public.platform_permission_definitions p
  where r.is_owner_role
on conflict (role_id, permission_id) do nothing;

-- ---------- E. backfill: one owner staff row per current has_role('admin') ----------
-- Runs BEFORE the audit triggers are created, so the backfill produces no noise.
insert into public.platform_staff (user_id, role_id, granted_by)
  select ur.user_id, (select id from public.platform_roles where is_owner_role limit 1), ur.user_id
  from public.user_roles ur
  where ur.role = 'admin'::app_role
on conflict (user_id) do nothing;

-- ---------- F. guardrail + audit triggers (created LAST, after seed/backfill) ----------

-- Never let the last platform owner be removed.
create or replace function public.platform_staff_prevent_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select r.is_owner_role from public.platform_roles r where r.id = OLD.role_id)
     and (
       select count(*) from public.platform_staff s
       join public.platform_roles r on r.id = s.role_id
       where r.is_owner_role
     ) <= 1
  then
    raise exception 'חייב להישאר לפחות בעל מערכת אחד';
  end if;
  return OLD;
end; $$;

-- Owner permissions are immutable (owner is always all-permissions).
create or replace function public.platform_role_permissions_protect_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select r.is_owner_role from public.platform_roles r where r.id = OLD.role_id) then
    raise exception 'לא ניתן לשנות את הרשאות בעל המערכת — הן קבועות';
  end if;
  return OLD;
end; $$;

-- Structured audit for staff + permission changes. SECURITY DEFINER so the
-- append into the RLS-protected audit table succeeds regardless of caller role.
create or replace function public.platform_rbac_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _actor       uuid := (select auth.uid());
  _action      text;
  _target_role uuid;
  _target_user uuid;
  _details     jsonb;
begin
  if TG_TABLE_NAME = 'platform_staff' then
    if TG_OP = 'INSERT' then
      _action := 'staff_assigned';
      _target_user := NEW.user_id;
      _target_role := NEW.role_id;
      _details := jsonb_build_object('granted_by', NEW.granted_by);
      _actor := coalesce(_actor, NEW.granted_by);
    else
      _action := 'staff_revoked';
      _target_user := OLD.user_id;
      _target_role := OLD.role_id;
      _details := jsonb_build_object('granted_by', OLD.granted_by);
      _actor := coalesce(_actor, OLD.granted_by);
    end if;
  elsif TG_TABLE_NAME = 'platform_role_permissions' then
    if TG_OP = 'INSERT' then
      _action := 'permission_granted';
      _target_role := NEW.role_id;
      _details := jsonb_build_object('permission_id', NEW.permission_id);
    else
      _action := 'permission_revoked';
      _target_role := OLD.role_id;
      _details := jsonb_build_object('permission_id', OLD.permission_id);
    end if;
    _actor := coalesce(_actor, nullif(current_setting('app.actor_id', true), '')::uuid);
  end if;

  insert into public.platform_role_audit_log
    (actor_id, action, target_role_id, target_user_id, details)
  values
    (_actor, _action, _target_role, _target_user, _details);

  return null;
end; $$;

drop trigger if exists platform_staff_last_owner on public.platform_staff;
create trigger platform_staff_last_owner
  before delete on public.platform_staff
  for each row execute function public.platform_staff_prevent_last_owner();

drop trigger if exists platform_role_permissions_owner_lock on public.platform_role_permissions;
create trigger platform_role_permissions_owner_lock
  before delete on public.platform_role_permissions
  for each row execute function public.platform_role_permissions_protect_owner();

drop trigger if exists platform_staff_audit on public.platform_staff;
create trigger platform_staff_audit
  after insert or delete on public.platform_staff
  for each row execute function public.platform_rbac_audit();

drop trigger if exists platform_role_permissions_audit on public.platform_role_permissions;
create trigger platform_role_permissions_audit
  after insert or delete on public.platform_role_permissions
  for each row execute function public.platform_rbac_audit();
