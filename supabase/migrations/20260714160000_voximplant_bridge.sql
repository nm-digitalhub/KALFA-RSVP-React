-- Voximplant AI-voice RSVP bridge — schema foundation.
--
-- Additive + dark-safe: adds config columns, the DNC list, and the per-call
-- attempts table. Nothing here changes existing behavior; the feature stays inert
-- until an admin populates app_settings AND the worker consumer/endpoints ship.
--
-- Verified against the LIVE schema (project cklpaxihpyjbhymqtduv, 2026-07-14):
--   * app_settings singleton (id boolean = true, admin-only RLS) — only
--     `outreach_enabled` existed; NO voximplant_* columns. We REUSE outreach_enabled
--     (no per-provider enable flag; per-campaign channel is campaigns.channels[]).
--   * campaign_channel enum already has 'call'; contact_op_status already has the
--     call states (pending_call/call_dialed/no_answer/voicemail/human_interaction_call/
--     wrong_number/reached_billed/not_reached). contact_interactions is channel-generic.
--   * contacts had NO call_consent_at; call_dnc_list / call_attempts did NOT exist.

-- ---------------------------------------------------------------------------
-- 1. app_settings — Voximplant provider config (secrets + tuning).
-- ---------------------------------------------------------------------------
-- Auth is JWT service-account (matches src/lib/voximplant/core.ts), NOT api_key.
-- The whole downloaded service-account JSON is stored in ONE secret column and
-- parsed server-side into {accountId,keyId,privateKey}.
alter table public.app_settings
  add column if not exists voximplant_service_account_json text,      -- SECRET (RSA private key inside)
  add column if not exists voximplant_rule_id                 text,   -- OutCall rule id (live: 1494311)
  add column if not exists voximplant_caller_id               text,   -- purchased/verified 'from' number
  add column if not exists voximplant_callback_secret         text,   -- SECRET: ?k= on ctx/cb URLs
  add column if not exists voximplant_groq_api_key            text,   -- SECRET: scenario 'gk' (Branch A)
  add column if not exists voximplant_low_balance_threshold   numeric not null default 5.0,
  add column if not exists voximplant_min_call_reserve        numeric not null default 0.10,
  add column if not exists voximplant_max_concurrent_calls    integer not null default 5,
  add column if not exists voximplant_max_calls_per_campaign_hour integer not null default 200;

comment on column public.app_settings.voximplant_service_account_json is
  'SECRET Voximplant service-account key JSON (account_id/key_id/private_key). Server-only; never returned to the browser.';
comment on column public.app_settings.voximplant_callback_secret is
  'SECRET shared secret appended as ?k= to the ctx/cb URLs; rotate to invalidate all outstanding call URLs.';

-- ---------------------------------------------------------------------------
-- 2. Call consent + Do-Not-Call suppression.
-- ---------------------------------------------------------------------------
-- call_consent_at: gates whether a contact may be AI-called (legal/DNC posture is
-- a pending product decision — the gate exists so the worker can fail-closed).
alter table public.contacts
  add column if not exists call_consent_at timestamptz;

create table if not exists public.call_dnc_list (
  normalized_phone text primary key,
  reason           text,
  added_by         uuid references auth.users(id),
  created_at       timestamptz not null default now()
);
alter table public.call_dnc_list enable row level security;
-- Admin-managed; service_role (worker) bypasses RLS. Authenticated admins may read/write.
drop policy if exists call_dnc_list_admin_all on public.call_dnc_list;
create policy call_dnc_list_admin_all on public.call_dnc_list
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 3. call_attempts — one row per outbound AI call. Holds the per-call bearer
--    token (URL path secret for ctx/cb) + the call outcome + PII (recording,
--    transcript). Service-role reachable only; admin read for a future call-log UI.
-- ---------------------------------------------------------------------------
create table if not exists public.call_attempts (
  id                          uuid primary key default gen_random_uuid(),
  event_id                    uuid not null references public.events(id) on delete cascade,
  campaign_id                 uuid not null references public.campaigns(id) on delete cascade,
  contact_id                  uuid not null references public.contacts(id) on delete cascade,
  guest_id                    uuid references public.guests(id) on delete set null, -- null when contact backs !=1 guest
  touchpoint_index            integer not null,
  access_token                text not null unique,        -- 32 hex (gen_random_bytes(16)); URL path secret
  token_expires_at            timestamptz not null,        -- created_at + 2h
  status                      text not null default 'queued',
    -- queued|dialing|in_progress|completed|failed|no_answer|no_response|cancelled|failed_to_start|expired
  ctx_delivered_at            timestamptz,
  ctx_read_count              integer not null default 0,
  recording_started_at        timestamptz,
  recording_url               text,                        -- PII
  transcript                  jsonb,                       -- PII
  rsvp_digit                  text,
  rsvp_method                 text,
  call_duration_sec           integer,
  finish_reason               text,                        -- e.g. 'Insufficient funds' (verified value)
  vox_call_session_history_id text,                        -- StartScenarios result; GetCallHistory reconcile
  media_session_access_url    text,                        -- HTTPS control URL (remote hangup)
  callback_count              integer not null default 0,
  last_callback_at            timestamptz,
  billed_outcome              text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (campaign_id, contact_id, touchpoint_index)       -- idempotency: one attempt per touchpoint
);

create index if not exists call_attempts_token_idx on public.call_attempts (access_token);
create index if not exists call_attempts_event_idx on public.call_attempts (event_id);
create index if not exists call_attempts_stale_idx on public.call_attempts (status, created_at)
  where status in ('queued', 'dialing', 'in_progress');

alter table public.call_attempts enable row level security;
-- No anon/authenticated write policy — the worker + webhook routes use service_role
-- (BYPASSRLS). A read-only admin policy supports a future call-log admin UI.
drop policy if exists call_attempts_admin_read on public.call_attempts;
create policy call_attempts_admin_read on public.call_attempts
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

comment on table public.call_attempts is
  'One row per outbound Voximplant AI call. access_token is the URL-path bearer for the ctx/cb endpoints. recording_url + transcript are PII — service-role reachable only.';
