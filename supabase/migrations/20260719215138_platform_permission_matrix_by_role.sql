-- Staff permission matrix by role type.
--
-- Context: five of the six existing permission keys were wired to nothing —
-- /admin/roles rendered toggles that changed no behaviour. This migration makes the
-- catalogue complete and correct at the DATA layer; the code wiring
-- (requirePlatformPermission per page + DAL) lands alongside it.
--
-- Nothing here invents a mechanism. Permissions are rows in
-- platform_permission_definitions, roles are rows in platform_roles, grants are rows
-- in platform_role_permissions, and the matrix UI reads all three dynamically. The
-- only code-level primitive used is has_platform_permission(), which already exists.

-- ---------------------------------------------------------------------------
-- 1. THE OWNER LOCKOUT TRAP — fix it structurally, before adding any permission.
--
-- has_platform_permission() resolves purely through platform_role_permissions and
-- has NO owner branch. The owner currently passes only because six explicit grant
-- rows exist. Adding a 7th permission and gating a page on it would therefore lock
-- the owner out of their own page.
--
-- The UI already promises "כל ההרשאות (קבוע)" and refuses to edit the owner's row
-- (platform-roles.ts: "לא ניתן לשנות את הרשאות בעל המערכת — הן קבועות"). The
-- database is the layer that does not implement that promise. Fix it there.
-- ---------------------------------------------------------------------------
create or replace function public.has_platform_permission(_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- The owner role holds every permission, present and future, by definition.
    exists (
      select 1
      from public.platform_staff s
      join public.platform_roles r on r.id = s.role_id
      where s.user_id = (select auth.uid())
        and r.is_owner_role
    )
    or exists (
      select 1
      from public.platform_staff s
      join public.platform_role_permissions rp on rp.role_id = s.role_id
      join public.platform_permission_definitions p on p.id = rp.permission_id
      where s.user_id = (select auth.uid())
        and p.key = _key
    );
$function$;

-- Keep the MATRIX truthful too: the UI ticks a box from platform_role_permissions,
-- so without a row the owner column would render unchecked while the function says
-- yes. This trigger grants every newly-catalogued permission to the owner role, so
-- data and behaviour can never drift apart again — and no future migration has to
-- remember this step.
create or replace function public.grant_new_permission_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.platform_role_permissions (role_id, permission_id)
  select r.id, new.id from public.platform_roles r where r.is_owner_role
  on conflict (role_id, permission_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists platform_permission_grant_owner on public.platform_permission_definitions;
create trigger platform_permission_grant_owner
  after insert on public.platform_permission_definitions
  for each row execute function public.grant_new_permission_to_owner();

-- ---------------------------------------------------------------------------
-- 2. New permissions — each one exists because a real admin surface has no key.
-- ---------------------------------------------------------------------------
insert into public.platform_permission_definitions (key, label, category, sort_order)
values
  -- /admin/recordings exposes recording_url: guest VOICE. The most sensitive PII we
  -- hold, and the guest never consented to it being retained, let alone replayed.
  -- Deliberately NOT folded into view_customer_data: reading a name and listening to
  -- a person's voice are different thresholds, and support must be grantable one
  -- without the other.
  ('view_recordings', 'האזנה להקלטות שיחה', 'support', 15),

  -- Split out of manage_billing so an external accountant can SEE billing without
  -- being able to price packages or run a real charge through /admin/sumit-test.
  ('view_billing', 'צפייה בחיוב', 'billing', 25),

  -- /admin/voice/platform can WRITE to Voximplant (SetAccountInfo) and trigger log
  -- exports; the voice pages place real, billable, legally-regulated calls.
  -- Deliberately NOT folded into manage_settings: changing an alert threshold and
  -- rewiring the telephony account are not the same authority.
  ('manage_voice', 'ניהול מוקד שיחות AI', 'ops', 70),

  -- /admin/webhooks exposes webhook_inbox, whose payloads carry guest PII
  -- (phones/names — stated in webhooks.ts). A data-access key, not a config key.
  ('view_webhooks', 'צפייה ביומן וובהוקים', 'ops', 80)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Roles by team function. Ranks are ordering only — rank is NOT enforced
--    anywhere in code, so it must not be relied on as a guard.
-- ---------------------------------------------------------------------------
insert into public.platform_roles (name, label, description, is_owner_role, rank, sort_order)
values
  ('ops_engineer',  'תפעול טכני',  'ערוצים, מוקד שיחות, וובהוקים והגדרות מערכת', false, 50, 50),
  ('billing_clerk', 'חיוב וגבייה', 'חבילות, חיובים וחשבוניות',                    false, 40, 40),
  ('auditor',       'צופה',        'פיקוח בלבד — ללא כל הרשאת כתיבה',              false, 10, 10)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The matrix. Least privilege: each role receives only what its job requires.
--    The owner is intentionally absent — §1 grants it everything by definition.
-- ---------------------------------------------------------------------------
insert into public.platform_role_permissions (role_id, permission_id)
select r.id, p.id
from public.platform_roles r
join public.platform_permission_definitions p
  on (r.name, p.key) in (
    -- תפעול טכני: runs the platform, never sees customers.
    ('ops_engineer',  'manage_settings'),
    ('ops_engineer',  'manage_voice'),
    ('ops_engineer',  'view_webhooks'),
    ('ops_engineer',  'view_activity_log'),

    -- חיוב וגבייה: needs the customer's identity to bill them, and full billing.
    ('billing_clerk', 'manage_billing'),
    ('billing_clerk', 'view_billing'),
    ('billing_clerk', 'view_customer_data'),
    ('billing_clerk', 'view_activity_log'),

    -- נציג תמיכה: answers customers. No settings, no billing, no recordings.
    ('support_agent', 'view_customer_data'),
    ('support_agent', 'view_activity_log'),

    -- צופה: read-only oversight (e.g. an external accountant).
    ('auditor',       'view_billing'),
    ('auditor',       'view_activity_log')
  )
where not r.is_owner_role
on conflict (role_id, permission_id) do nothing;
