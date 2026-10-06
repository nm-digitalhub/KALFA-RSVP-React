-- =====================================================================
-- Provider configuration (what KALFA needs to TALK to a provider), plus the
-- two Platform RBAC keys that gate it.
--
-- TWO ENTITIES, NOT ONE TABLE SPLIT IN HALF:
--
--   integration_provider_configs   "can KALFA connect to this provider at all?"
--   integration_connections        "which connection is live right now?"
--
-- The separation also keeps non-secret configuration out of Vault. `client_id`
-- is not a credential — it travels in the authorization URL in plain sight — so
-- putting it in Vault would mean opening a secret to answer an ordinary
-- configuration question. That is the same mistake `integrations_configured_flags()`
-- was written to undo, where five secrets were read on every page load to render
-- five ✔/✘ marks. Only `client_secret` goes to Vault; this table holds the
-- reference.
--
-- `provider` IS AN APPLICATION-LEVEL REFERENCE, NOT FREE TEXT. At the database
-- it is `text` with no constraint, but it must equal a registered
-- `ProviderDefinition.id` (src/lib/integrations/provider.ts). That integrity is
-- deliberately enforced in application code: the registry is the source of truth
-- for which providers exist, and a check constraint here would make adding a
-- provider a migration, which is exactly what this layer is built to avoid.
--
-- NO FOREIGN KEY FROM integration_connections.provider TO THIS TABLE, and the
-- reason is not laziness:
--
--   1. A `static` provider (operator-supplied API key) is a perfectly valid
--      connection with NO platform OAuth client configuration at all. A FK would
--      force an empty config row for every one of them.
--   2. "Which providers exist" is answered by the code registry, not by this
--      table. This table answers the narrower "is an OAuth client configured for
--      this provider, in this deployment".
--   3. A connection legitimately outlives its config: the app is deleted at the
--      provider, and the connection still needs an orderly disconnect.
--
-- The constraint that matters is enforced by physics instead: an OAuth flow
-- cannot complete without a `client_id` to build a Configuration from.
--
-- WHAT `enabled = false` MEANS. Derived from which operations actually need the
-- platform credentials — using a live access token needs nothing from this
-- table, everything else needs both fields:
--
--   new authorization            refused
--   in-flight callback           refused, and the state row is still CONSUMED so
--                                it cannot be replayed if the config is re-enabled
--   use of a valid access token  ALLOWED — this is not a kill switch; revoking
--                                the connection is
--   refresh                      refused  → requires_reauthorization
--   reissue (client_credentials) refused  → requires_reauthorization at the next
--                                expiry, which is the shortest leash and the
--                                right one: such a connection IS the platform
--                                config, with no user grant behind it
--   rotate the client secret     ALLOWED — rotation is an UPDATE of
--                                vault_secret_id, never a disable
--   disconnect                   ALLOWED, but remote revocation is skipped
--                                (it needs client auth) and the reason is
--                                recorded in the connection's last_error
--
-- Disabling does NOT eagerly transition existing connections. One holding a
-- valid token stays `active`; it becomes `requires_reauthorization` when a
-- renewal is actually attempted and refused. An eager transition would lie about
-- connections that are still working.
--
-- WHY `integrations.manage` AND NOT `manage_settings`. `exchange-connections.ts`
-- gates on `manage_settings` today, but that is legacy authorization rather than
-- an architectural precedent: reusing it would permanently couple "may change
-- system settings" to "may manage provider credentials". Measured, every role
-- holding `manage_settings` (owner, ops_engineer) is one we would grant
-- `integrations.manage` to anyway — so the new key costs nothing today and keeps
-- the two grantable apart tomorrow. Migrating exchange-connections onto the new
-- key is a candidate for later and deliberately NOT done here.
--
-- ROLLBACK:
--   delete from public.platform_role_permissions rp using
--     public.platform_permission_definitions p
--     where rp.permission_id = p.id and p.key in ('integrations.read','integrations.manage');
--   delete from public.platform_permission_definitions
--     where key in ('integrations.read','integrations.manage');
--   drop trigger if exists integration_provider_configs_set_updated_at
--     on public.integration_provider_configs;
--   drop table if exists public.integration_provider_configs;
--   Vault secrets named 'oauth_app:%' are NOT removed by this rollback.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Provider configuration
-- ---------------------------------------------------------------------
create table if not exists public.integration_provider_configs (
  -- Application-level reference to ProviderDefinition.id. See the header.
  provider          text        primary key,

  -- NOT a credential. Travels in the authorization URL in plain sight, and is
  -- needed to answer "is this provider configured" without opening a secret.
  client_id         text        not null,

  -- The client secret lives in Vault under 'oauth_app:<provider>'; the unique
  -- partial index on vault.secrets.name makes that singular for free. Null for a
  -- provider whose flow needs no client secret.
  vault_secret_id   uuid,

  -- ⚠️ NON-SECRET PROVIDER CONFIGURATION ONLY — tenant, instance, issuer
  -- override, region. Never secret material. The shape is declared by the
  -- provider's ProviderDefinition and validated at every read/write boundary of
  -- this table, not at registration time: registration sees the schema, only a
  -- read or write sees the values.
  extra             jsonb       not null default '{}'::jsonb,

  enabled           boolean     not null default true,

  created_by        uuid        references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists integration_provider_configs_set_updated_at
  on public.integration_provider_configs;
create trigger integration_provider_configs_set_updated_at
  before update on public.integration_provider_configs
  for each row execute function public.set_updated_at();

comment on table public.integration_provider_configs is
  'Per-deployment OAuth client configuration for a provider. client_id and non-secret settings live here; the client secret lives in Vault and only its uuid is stored. `provider` is an application-level reference to a registered ProviderDefinition.id.';
comment on column public.integration_provider_configs.enabled is
  'false blocks new authorizations, refreshes and reissues. It does NOT stop a valid access token from being used, and does not eagerly change existing connection statuses.';
comment on column public.integration_provider_configs.extra is
  'Non-secret provider configuration only. Shape declared by ProviderDefinition; validated at each read/write boundary. Never secret material.';

-- ---------------------------------------------------------------------
-- 2. Closed-table lockdown.
--
-- THREE statements, not two. `alter default privileges in schema public grants
-- ALL on tables to postgres, anon, authenticated AND service_role`, and a
-- narrower GRANT is additive — it cannot take a privilege away. Revoking from
-- anon/authenticated alone leaves service_role holding arwdDxtm, which is how
-- 20260916002343 silently produced ALL and needed 20260916002651 to correct it.
-- ---------------------------------------------------------------------
alter table public.integration_provider_configs enable row level security;

revoke all on public.integration_provider_configs from anon, authenticated;
revoke all on public.integration_provider_configs from service_role;

-- Derived from the operations that exist: the management surface creates a
-- config and rotates it; the OAuth flow reads client_id and extra. No DELETE —
-- withdrawal is `enabled = false`, so no code path removes a row.
grant select, insert on public.integration_provider_configs to service_role;

-- Column-level, so `provider`, `created_by` and `created_at` are immutable after
-- insert. A config row cannot quietly become a config for a different provider.
grant update (client_id, vault_secret_id, extra, enabled, updated_at)
  on public.integration_provider_configs to service_role;

-- ---------------------------------------------------------------------
-- 3. Platform RBAC keys.
--
-- Two, deliberately. `integrations.use` is NOT created: the Credential Accessor
-- and the worker are not human users, and their authorization is the server
-- trust boundary (service_role / postgres), not Platform RBAC. Conflating the
-- two would mean a panel permission implied a runtime capability. If a human
-- use-case appears — "this workflow author may pick a connection and use it in
-- a node" — that is a real permission, and it gets added when the use-case is
-- demonstrated rather than in anticipation of it.
-- ---------------------------------------------------------------------
insert into public.platform_permission_definitions (key, label, category, sort_order)
values
  -- Metadata and status ONLY. This key must never come to imply visibility of a
  -- client secret, an access or refresh token, or any decrypted Vault material;
  -- the read path selects an explicit column list that excludes them.
  ('integrations.read',   'צפייה בחיבורי אינטגרציה', 'ops', 40),
  ('integrations.manage', 'ניהול חיבורי אינטגרציה',  'ops', 41)
on conflict (key) do nothing;

-- auditor holds read but never manage, matching what it holds today —
-- view_activity_log and view_billing, both read-only, and no manage_* at all.
insert into public.platform_role_permissions (role_id, permission_id)
select r.id, p.id
from public.platform_roles r
join public.platform_permission_definitions p on p.key = 'integrations.read'
where r.name in ('owner', 'ops_engineer', 'auditor')
on conflict (role_id, permission_id) do nothing;

insert into public.platform_role_permissions (role_id, permission_id)
select r.id, p.id
from public.platform_roles r
join public.platform_permission_definitions p on p.key = 'integrations.manage'
where r.name in ('owner', 'ops_engineer')
on conflict (role_id, permission_id) do nothing;
