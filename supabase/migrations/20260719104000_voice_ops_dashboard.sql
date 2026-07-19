-- Voice-ops dashboard + account-callback (B5) + log export (A4) — schema.
--
-- Additive + dark-safe: adds app_settings columns (all nullable — populated by
-- the wiring action, never defaulted on), one tracking table, and one private
-- Storage bucket. Nothing here changes existing behavior; the callback route
-- stays "dark" (404 to everything) until an admin wires it, and the export cron
-- is a no-op until it runs. Verified against the live schema patterns in
-- 20260714160000_voximplant_bridge.sql (app_settings + call_attempts + RLS),
-- 202606240008_id_documents_bucket.sql (private bucket, no object policies), and
-- the initplan-optimized RLS style from 20260713143941.
--
-- No RPC here by design (owner directive): the per-event aggregation ships as a
-- JS-first DAL query; an RPC is added only after EXPLAIN ANALYZE proves need
-- (plan stage 4).

-- ---------------------------------------------------------------------------
-- 1. app_settings — B5 account-callback wiring (secrets stored as HASH only).
-- ---------------------------------------------------------------------------
-- The raw callback token is NEVER persisted: only its SHA-256 hex digest, which
-- the public route compares in constant time. The raw token lives only in the
-- URL registered at Voximplant and is shown to the admin once at wiring time.
-- The previous callback_url/salt are snapshotted so a rollback RESTORES them
-- (never blind-resets). `elevenlabs_api_key` is a write-only secret (stage 7).
alter table public.app_settings
  add column if not exists voximplant_account_callback_token_hash text,   -- SHA-256 hex of the raw token
  add column if not exists voximplant_account_callback_salt       text,   -- SECRET: callback_salt sent to Voximplant
  add column if not exists voximplant_account_callback_state      text
    not null default 'unwired',
    -- unwired|pending|wired|failed|rollback_pending|rolled_back
  add column if not exists voximplant_account_callback_prev       jsonb,  -- {callback_url, callback_salt} pre-wiring snapshot (nullable fields)
  add column if not exists voximplant_account_callback_wired_at   timestamptz,
  add column if not exists voximplant_balance_callback_at         timestamptz,  -- last verified poke received
  add column if not exists elevenlabs_api_key                     text;   -- SECRET (stage 7)

comment on column public.app_settings.voximplant_account_callback_token_hash is
  'SHA-256 hex of the account-callback URL path token. The raw token is NEVER stored — only shown to the admin once at wiring. The public route compares this in constant time.';
comment on column public.app_settings.voximplant_account_callback_prev is
  'Snapshot of the account callback_url/callback_salt BEFORE wiring, so a rollback restores the prior state instead of blank-resetting.';
comment on column public.app_settings.elevenlabs_api_key is
  'SECRET ElevenLabs xi-api-key for read-only agent/quota/conversation status. Server-only; never returned to the browser.';

-- ---------------------------------------------------------------------------
-- 2. vox_log_exports — one row per exported session log (A4).
-- ---------------------------------------------------------------------------
-- Voximplant session logs expire after ~1 month; this table tracks a durable
-- copy in the private bucket. The UNIQUE(call_attempt_id) is the idempotency
-- guard; leased_until + status='processing' give an ATOMIC per-row lease so a
-- manual run and the cron never double-process the same row (the cron's
-- singleton policy is a second layer, not the only one).
create table if not exists public.vox_log_exports (
  id                          uuid primary key default gen_random_uuid(),
  call_attempt_id             uuid not null unique references public.call_attempts(id) on delete cascade,
  event_id                    uuid references public.events(id) on delete set null,
  vox_call_session_history_id text,
  attempt_created_at          timestamptz,           -- snapshot: bounds the GetCallHistory window
  status                      text not null default 'pending',
    -- pending|processing|stored|no_log|failed
  leased_until                timestamptz,           -- atomic lease: NULL or past = claimable
  attempts                    integer not null default 0,
  storage_path                text,                  -- {event_id}/{attempt_id}.log in the private bucket
  content_sha256              text,                  -- integrity of the stored bytes
  size_bytes                  integer,
  content_type                text,
  source_url_hash             text,                  -- SHA-256 of the log_file_url (audit, no raw URL)
  last_error                  text,                  -- capped reason on failure
  exported_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Partial index over the claimable work set (mirrors call_attempts_stale_idx style).
create index if not exists vox_log_exports_work_idx on public.vox_log_exports (status, created_at)
  where status in ('pending', 'failed');
create index if not exists vox_log_exports_event_idx on public.vox_log_exports (event_id);

alter table public.vox_log_exports enable row level security;
-- Service-role (worker) bypasses RLS for all writes. A read-only admin policy
-- supports the dashboard's "log export" section. Initplan-optimized form
-- (per 20260713143941): the row-independent auth expression is hoisted.
drop policy if exists vox_log_exports_admin_read on public.vox_log_exports;
create policy vox_log_exports_admin_read on public.vox_log_exports
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

comment on table public.vox_log_exports is
  'Tracks durable copies of Voximplant session logs (which expire ~1 month) in the private vox-call-logs bucket. UNIQUE(call_attempt_id)=idempotency; leased_until=atomic per-row lease. Service-role reachable only; admin read for the dashboard.';

-- ---------------------------------------------------------------------------
-- 3. Private Storage bucket for exported session logs (guest PII).
-- ---------------------------------------------------------------------------
-- Same posture as id-documents (202606240008): PRIVATE, NO storage.objects
-- policies, so no anon/authenticated key can touch objects — all access is
-- server-side via the RLS-exempt service-role client (upload by the export job,
-- admin review via short-lived signed URLs). Logs can embed guest phone numbers
-- and scenario text. Never expose publicly or via NEXT_PUBLIC.
insert into storage.buckets (id, name, public)
values ('vox-call-logs', 'vox-call-logs', false)
on conflict (id) do nothing;
