-- =====================================================================
-- Owner WhatsApp business-data agent (Mastra) — storage layer ONLY.
--
-- Plan: whatsapp-business-agent-plan.md, stage 1. Owner decision 2026-09-24:
-- the agent answers on an ADMIN-SELECTED number of our WABA — possibly one
-- that also serves guests. There is no Meta per-number override, no Graph
-- call, no separate intake route and NO provider_number_role enum change.
-- The existing webhook (src/app/api/webhooks/whatsapp/route.ts) diverts one
-- inbound message to the agent only when BOTH hold:
--   metadata.phone_number_id = app_settings.owner_agent_phone_number_id
--   AND the sender normalizes to an ENABLED row of owner_agent_allowlist.
-- Every other event keeps today's path unchanged. This file adds no
-- application behaviour: with the columns at their defaults (switch off,
-- no number selected) nothing reads or writes these objects.
--
-- Every identifier below was read from the LIVE schema on 2026-09-24
-- (read-only introspection, `supabase db query --linked`):
--   * app_settings: singleton (app_settings_singleton CHECK id = true), RLS
--     on, one policy app_settings_admin_all (ALL, authenticated, is_platform_staff()).
--     Cap-column precedent: callback_intake_sms_daily_cap integer NOT NULL
--     DEFAULT 50, CHECK 0..10000.
--   * Meta phone_number_id values live in provider_numbers.provider_ref
--     (meta_whatsapp rows: all-digit, 16 chars) and app_settings.whatsapp_phone_number_id.
--   * platform_staff(user_id UNIQUE -> auth.users ON DELETE CASCADE, role_id),
--     platform_roles(is_owner_role), platform_role_permissions(role_id,
--     permission_id), platform_permission_definitions(key UNIQUE).
--   * public.is_platform_staff() / has_platform_permission(text) /
--     is_platform_owner(): LANGUAGE sql STABLE SECURITY DEFINER, bound to
--     auth.uid(). The *_for_user twins below copy those bodies verbatim with
--     auth.uid() -> _user_id.
--   * provider_numbers_e164_chk: '^\+[1-9][0-9]{6,14}$' (reused as-is).
--   * Default privileges in schema public grant anon AND authenticated full
--     table rights (arwdDxtm) and EXECUTE on every new function, and Postgres
--     itself grants EXECUTE to PUBLIC on CREATE FUNCTION — hence every revoke
--     below names public, anon and authenticated.
--   * Owner-read pattern: ops_errors (20260731075025_ops_debug_layer.sql) —
--     revoke all from anon, authenticated; grant select to authenticated;
--     <table>_owner_select USING (public.is_platform_owner()).
--   * service_role-only SECDEF pattern: signup_reminder_candidates
--     (20260906123802_signup_confirmation_reminder.sql:78-79), search_path ''.
--   * Non-exposed schema precedent: pgboss (owner postgres, ACL NULL, absent
--     from the PostgREST-exposed schemas).
-- =====================================================================


-- --- 1. app_settings: kill switch, selected number, daily cap --------------

alter table public.app_settings
  add column if not exists owner_agent_enabled boolean not null default false,
  add column if not exists owner_agent_phone_number_id text,
  add column if not exists owner_agent_daily_cap integer not null default 50;

-- A Meta phone_number_id is an all-digit id (the live provider_ref values are).
-- The shape check catches the likely mistake — pasting the E.164 number
-- ("+972…") instead of the id — which would otherwise never match any
-- delivery and fail silently.
alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_phone_number_id_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_phone_number_id_check
  check (owner_agent_phone_number_id is null
         or owner_agent_phone_number_id ~ '^[0-9]{1,32}$');

alter table public.app_settings
  drop constraint if exists app_settings_owner_agent_daily_cap_check;
alter table public.app_settings
  add constraint app_settings_owner_agent_daily_cap_check
  check (owner_agent_daily_cap >= 0 and owner_agent_daily_cap <= 10000);

comment on column public.app_settings.owner_agent_enabled is
  'Owner WhatsApp agent kill switch. false = a diverted allow-listed message '
  'gets an ids-only audit row and no reply, no model call, no intake text.';
comment on column public.app_settings.owner_agent_phone_number_id is
  'Meta phone_number_id of the WABA number the owner agent answers on (any of '
  'our numbers, including one that also serves guests). null = no diversion '
  'at all: the webhook behaves exactly as before this feature.';
comment on column public.app_settings.owner_agent_daily_cap is
  'Max agent runs per staff member per day, counted from real rows (not a '
  'per-process counter).';


-- --- 2. Allow-list: which phones may reach the agent, as which staff member --

create table if not exists public.owner_agent_allowlist (
  id            uuid primary key default gen_random_uuid(),
  e164          text not null,
  -- FK to platform_staff(user_id) (UNIQUE, live): only a staff member can be
  -- allow-listed, and removing someone from staff removes their row here.
  -- The gate still re-checks is_platform_staff_for_user() at run time.
  staff_user_id uuid not null
                references public.platform_staff (user_id) on delete cascade,
  -- Creating the row IS the grant; `enabled` is for temporary suspension.
  enabled       boolean not null default true,
  label         text,
  -- Mirrors platform_staff.granted_by (NOT NULL -> auth.users).
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  constraint owner_agent_allowlist_e164_key unique (e164),
  constraint owner_agent_allowlist_e164_chk
    check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint owner_agent_allowlist_label_len
    check (label is null or char_length(label) <= 120)
);

create index if not exists owner_agent_allowlist_staff_user_idx
  on public.owner_agent_allowlist (staff_user_id);

comment on table public.owner_agent_allowlist is
  'Phones (E.164) allowed to reach the owner WhatsApp agent, each bound to one '
  'platform staff member. Written only by the service-role owner DAL '
  '(requirePlatformOwner); the platform owner may read it.';


-- --- 3. Intake: one row per diverted, gate-passing text message -------------

create table if not exists public.owner_agent_intake (
  id              uuid primary key default gen_random_uuid(),
  wamid           text not null,
  -- The business number the message arrived on; the reply is sent from it.
  phone_number_id text not null,
  staff_user_id   uuid not null references auth.users (id) on delete cascade,
  -- The staff member's question. Business data, not guest data. Purged by the
  -- retention job (plan decision 8). Never exposed to `authenticated` (see the
  -- column-level grant in section 5).
  message_text    text not null,
  -- Worker state, code-shaped rather than a closed list so a new state needs
  -- no migration: queued / processing / answered / failed / skipped today.
  status          text not null default 'queued',
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  constraint owner_agent_intake_wamid_key unique (wamid),
  constraint owner_agent_intake_phone_number_id_chk
    check (phone_number_id ~ '^[0-9]{1,32}$'),
  constraint owner_agent_intake_text_len
    check (char_length(message_text) between 1 and 4096),
  constraint owner_agent_intake_status_shape
    check (status ~ '^[a-z][a-z0-9_]{0,31}$')
);

create index if not exists owner_agent_intake_staff_received_idx
  on public.owner_agent_intake (staff_user_id, received_at desc);
create index if not exists owner_agent_intake_received_idx
  on public.owner_agent_intake (received_at);

drop trigger if exists owner_agent_intake_set_updated_at on public.owner_agent_intake;
create trigger owner_agent_intake_set_updated_at
  before update on public.owner_agent_intake
  for each row execute function public.set_updated_at();

comment on table public.owner_agent_intake is
  'Owner WhatsApp agent intake. ON CONFLICT (wamid) DO NOTHING makes a Meta '
  'retry a no-op and gates the single pg-boss enqueue. Holds the question '
  'text; short retention.';


-- --- 4. Audit: ids and codes only — never a phone, never text ---------------

create table if not exists public.owner_agent_audit (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  staff_user_id uuid references auth.users (id) on delete set null,
  intake_id     uuid references public.owner_agent_intake (id) on delete set null,
  -- sha256 hex of the wamid: correlates retries without storing the raw id.
  wamid_sha256  text,
  -- Where the row was written: route / agent / send (code-shaped).
  stage         text not null,
  -- e.g. intake_queued, duplicate, gated, answered, refused, send_failed.
  outcome       text not null,
  -- e.g. kill_switch_off, not_staff, phone_unverified, rate_limited,
  -- daily_cap, non_text, window_closed, run_failed, db_error.
  reason_code   text,
  tool_names    text[],
  steps         smallint,
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  -- The shape checks are what keep this table ids-and-codes-only: none of
  -- them can hold a phone number, a name or free text.
  constraint owner_agent_audit_wamid_sha256_chk
    check (wamid_sha256 is null or wamid_sha256 ~ '^[0-9a-f]{64}$'),
  constraint owner_agent_audit_stage_shape
    check (stage ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint owner_agent_audit_outcome_shape
    check (outcome ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint owner_agent_audit_reason_shape
    check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint owner_agent_audit_tool_names_shape
    check (tool_names is null
           or (cardinality(tool_names) <= 32
               and array_position(tool_names, null) is null
               and array_to_string(tool_names, ',') ~ '^([a-z][a-z0-9_]{0,63}(,[a-z][a-z0-9_]{0,63})*)?$')),
  constraint owner_agent_audit_counts_nonneg
    check (coalesce(steps, 0) >= 0
           and coalesce(input_tokens, 0) >= 0
           and coalesce(output_tokens, 0) >= 0
           and coalesce(latency_ms, 0) >= 0)
);

create index if not exists owner_agent_audit_occurred_idx
  on public.owner_agent_audit (occurred_at desc);
create index if not exists owner_agent_audit_staff_occurred_idx
  on public.owner_agent_audit (staff_user_id, occurred_at desc);
create index if not exists owner_agent_audit_intake_idx
  on public.owner_agent_audit (intake_id) where intake_id is not null;

comment on table public.owner_agent_audit is
  'Owner WhatsApp agent audit: staff id, hashed wamid, codes, tool ids and '
  'counters. Written only for DIVERTED messages (allow-listed sender on the '
  'selected number) — never for guest traffic. No phone, no text.';


-- --- 5. RLS + grants: service_role only, platform owner may read -----------
-- Mirrors ops_errors. Writes happen only through the service-role client,
-- which bypasses RLS; there is deliberately no insert/update/delete policy.

alter table public.owner_agent_allowlist enable row level security;
alter table public.owner_agent_intake    enable row level security;
alter table public.owner_agent_audit     enable row level security;

revoke all on table public.owner_agent_allowlist from public, anon, authenticated;
revoke all on table public.owner_agent_intake    from public, anon, authenticated;
revoke all on table public.owner_agent_audit     from public, anon, authenticated;

grant select on table public.owner_agent_allowlist to authenticated;
grant select on table public.owner_agent_audit     to authenticated;
-- Intake: column-level, so even the owner's session can never read the
-- question text through the Data API — the admin UI shows status only.
grant select (id, wamid, phone_number_id, staff_user_id, status,
              received_at, processed_at, updated_at)
  on table public.owner_agent_intake to authenticated;

drop policy if exists owner_agent_allowlist_owner_select on public.owner_agent_allowlist;
create policy owner_agent_allowlist_owner_select on public.owner_agent_allowlist
  for select to authenticated
  using ((select public.is_platform_owner()));

drop policy if exists owner_agent_intake_owner_select on public.owner_agent_intake;
create policy owner_agent_intake_owner_select on public.owner_agent_intake
  for select to authenticated
  using ((select public.is_platform_owner()));

drop policy if exists owner_agent_audit_owner_select on public.owner_agent_audit;
create policy owner_agent_audit_owner_select on public.owner_agent_audit
  for select to authenticated
  using ((select public.is_platform_owner()));


-- --- 6. Session-free staff/permission checks for the agent process ---------
-- The live is_platform_staff() / has_platform_permission(text) read
-- auth.uid(); a WhatsApp-triggered run has no session. These twins take the
-- user id explicitly and are callable by service_role ONLY — an
-- authorization predicate that accepts an arbitrary user id must never be
-- reachable from a browser session.

create or replace function public.is_platform_staff_for_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_staff s where s.user_id = _user_id
  );
$$;

comment on function public.is_platform_staff_for_user(uuid) is
  'Session-free twin of public.is_platform_staff(): same body with auth.uid() '
  'replaced by _user_id. EXECUTE: service_role only.';

create or replace function public.has_platform_permission_for_user(_user_id uuid, _key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- The owner role holds every permission, present and future, by definition.
    exists (
      select 1
      from public.platform_staff s
      join public.platform_roles r on r.id = s.role_id
      where s.user_id = _user_id
        and r.is_owner_role
    )
    or exists (
      select 1
      from public.platform_staff s
      join public.platform_role_permissions rp on rp.role_id = s.role_id
      join public.platform_permission_definitions p on p.id = rp.permission_id
      where s.user_id = _user_id
        and p.key = _key
    );
$$;

comment on function public.has_platform_permission_for_user(uuid, text) is
  'Session-free twin of public.has_platform_permission(text): same body with '
  'auth.uid() replaced by _user_id. EXECUTE: service_role only.';

-- EXECUTE is granted to PUBLIC on CREATE and anon/authenticated also receive
-- it through the schema-public default privileges, so all three come off
-- before the one grant is made (see revoke-from-anon-leaves-public).
revoke all on function public.is_platform_staff_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.is_platform_staff_for_user(uuid) to service_role;

revoke all on function public.has_platform_permission_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.has_platform_permission_for_user(uuid, text) to service_role;


-- --- 7. Mastra storage schema: not exposed, owner-only ----------------------
-- @mastra/pg PostgresStore defaults to schema `public`, which the Data API
-- exposes. This schema follows the pgboss precedent: owned by the migration
-- role (postgres), no grant to anon, authenticated or service_role, and never
-- added to the API's exposed schemas. The agent process reaches it over the
-- session pooler as the same role that owns pgboss, so it needs no grant.
-- Table DDL is NOT created here: it comes from one approved PostgresStore
-- init() (or a later captured migration), after which disableInit: true.

create schema if not exists owner_agent_mastra;
revoke all on schema owner_agent_mastra from public, anon, authenticated, service_role;

comment on schema owner_agent_mastra is
  'Mastra memory/storage for the owner WhatsApp agent. Not exposed through the '
  'Data API; no grants beyond the owner role.';


-- =====================================================================
-- DRY RUN — not executed by this file. Run it from the MAIN tree after this
-- file lands there under its CLI-generated name (unchanged), over a direct
-- pg connection in ONE transaction ending in ROLLBACK. `supabase db query`
-- is single-statement and cannot do a reversible dry run.
--
--   begin;
--   -- (the statements of this file)
--
--   -- a) function ACLs. Expect anon=f, authenticated=f, public=f,
--   --    public_in_acl=f, service_role=t, prosecdef=t, proconfig={search_path=""}.
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('public', p.oid, 'execute')        as public,
--          exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_in_acl,
--          has_function_privilege('service_role', p.oid, 'execute')  as service_role,
--          p.prosecdef, p.proconfig, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('is_platform_staff_for_user', 'has_platform_permission_for_user');
--
--   -- b) behaviour parity with the live roster (counts only, no ids printed).
--   --    Expect staff = staff_true, owners = owner_true_for_unknown_key,
--   --    null_user = false.
--   select count(*) as staff,
--          count(*) filter (where public.is_platform_staff_for_user(s.user_id)) as staff_true,
--          count(*) filter (where r.is_owner_role) as owners,
--          count(*) filter (where public.has_platform_permission_for_user(s.user_id, '__no_such_key__'))
--            as owner_true_for_unknown_key,
--          public.is_platform_staff_for_user(null)
--            or public.has_platform_permission_for_user(null, 'view_events') as null_user
--     from public.platform_staff s join public.platform_roles r on r.id = s.role_id;
--
--   -- c) table privileges and RLS. Expect rls=t, every anon_* = f,
--   --    auth_write = f, auth_select = t for allowlist/audit and f for intake,
--   --    auth_intake_text = f, auth_intake_status = t.
--   select c.relname, c.relrowsecurity as rls,
--          has_table_privilege('anon', c.oid, 'select')                                as anon_select,
--          has_table_privilege('anon', c.oid, 'insert,update,delete,truncate')         as anon_write,
--          has_table_privilege('authenticated', c.oid, 'select')                       as auth_select,
--          has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate') as auth_write,
--          has_table_privilege('public', c.oid, 'select,insert,update,delete')         as public_any
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname like 'owner\_agent\_%';
--   select has_column_privilege('authenticated', 'public.owner_agent_intake'::regclass,
--                               'message_text', 'select') as auth_intake_text,
--          has_column_privilege('authenticated', 'public.owner_agent_intake'::regclass,
--                               'status', 'select')       as auth_intake_status,
--          has_column_privilege('anon', 'public.owner_agent_intake'::regclass,
--                               'status', 'select')       as anon_intake_status;
--
--   -- d) policies. Expect exactly three rows: *_owner_select, SELECT,
--   --    {authenticated}, qual ( SELECT is_platform_owner() ...), no with_check.
--   select tablename, policyname, cmd, roles::text, qual, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename like 'owner\_agent\_%'
--    order by tablename;
--
--   -- e) Mastra schema. Expect owner postgres and every usage/create = f.
--   select n.nspname, pg_get_userbyid(n.nspowner) as owner, n.nspacl::text,
--          has_schema_privilege('anon', n.oid, 'usage,create')          as anon,
--          has_schema_privilege('authenticated', n.oid, 'usage,create') as authenticated,
--          has_schema_privilege('service_role', n.oid, 'usage,create')  as service_role
--     from pg_namespace n where n.nspname = 'owner_agent_mastra';
--
--   -- f) app_settings defaults. Expect false, true, 50.
--   select owner_agent_enabled, owner_agent_phone_number_id is null as no_number,
--          owner_agent_daily_cap
--     from public.app_settings;
--
--   rollback;
--
-- Then, with approval, from the main tree:
--   npx supabase db push --linked --dry-run   (must list ONLY this file)
--   npx supabase db push --linked
--   npx supabase db advisors --linked --type security
--   npm run gen:types && npm run types:check  (types.ts only via gen types)
--
-- ROLLBACK (manual, approval required; nothing here depends on these yet):
--   drop schema if exists owner_agent_mastra;            -- no CASCADE: only while empty
--   drop function if exists public.has_platform_permission_for_user(uuid, text);
--   drop function if exists public.is_platform_staff_for_user(uuid);
--   drop table if exists public.owner_agent_audit;
--   drop table if exists public.owner_agent_intake;
--   drop table if exists public.owner_agent_allowlist;
--   alter table public.app_settings
--     drop constraint if exists app_settings_owner_agent_daily_cap_check,
--     drop constraint if exists app_settings_owner_agent_phone_number_id_check,
--     drop column if exists owner_agent_daily_cap,
--     drop column if exists owner_agent_phone_number_id,
--     drop column if exists owner_agent_enabled;
-- =====================================================================
