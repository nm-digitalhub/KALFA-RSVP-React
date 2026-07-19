-- =====================================================================
-- call_analysis — post-call QA + billing SIGNAL sink for ElevenLabs webhooks.
--
-- One row per ElevenLabs post-call analysis event. This is a METADATA-ONLY
-- sink: no guest PII (no phone/name/transcript) — only scores, status codes,
-- credit cost, and provider identifiers. The HMAC-authed webhook route verifies
-- the signature server-side and writes via the service-role client (which
-- bypasses RLS). call_attempt_id / event_id start NULL and are filled later by
-- a linker (event_id enables owner RLS scoping); orphan rows (event_id IS NULL)
-- are simply invisible to owners by construction.
--
-- Conventions verified against the live schema:
--   * 202606290035_webhook_inbox.sql        — admin-only RLS + service-role writes
--   * 20260719104000_voice_ops_dashboard.sql — vox_log_exports: initplan-optimized
--                                              admin SELECT, partial-index style
--   * campaigns.camp_org_select              — can_access_event(event_id, ...) is
--                                              the CURRENT org-aware owner convention
--   * 20260713183221_support_access_log.sql  — revoke broad default grants; grant
--                                              only SELECT to authenticated
--
-- RLS: enabled. SELECT-only for cookie/authenticated roles (owner via
-- can_access_event, admin via has_role); NO insert/update/delete policy — every
-- write is service-role (RLS-exempt) after HMAC verification. There is
-- deliberately no anon path at either the GRANT or the policy layer.
--
-- Rollback:
--   drop table if exists public.call_analysis;
--   (drops its indexes, policies, and grants with it; nothing else references it.)
-- =====================================================================

create table if not exists public.call_analysis (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'elevenlabs',
  conversation_id    text not null,                 -- ElevenLabs conversation id
  agent_id           text,
  call_successful    text,                           -- app coerces to success|failure|unknown
  status             text,                           -- app coerces to done|failed|unknown
  overall_score      numeric,                        -- nullable QA score
  call_duration_secs integer,
  cost_credits       integer,                        -- ElevenLabs credits consumed (billing signal)
  termination_reason text,                           -- app bounds to <=120 chars
  analysis_at        timestamptz,                    -- provider-reported analysis time
  call_attempt_id    uuid references public.call_attempts(id) on delete set null,  -- filled by linker
  event_id           uuid references public.events(id) on delete set null,         -- filled by linker; owner RLS scope
  linked_at          timestamptz,                    -- when the linker attached attempt/event
  received_at        timestamptz not null default now()
);

-- Idempotency key for the webhook upsert (on conflict (provider, conversation_id)).
create unique index if not exists call_analysis_provider_conversation_key
  on public.call_analysis (provider, conversation_id);

-- FK / linker lookup paths.
create index if not exists call_analysis_call_attempt_idx
  on public.call_analysis (call_attempt_id);
create index if not exists call_analysis_event_idx
  on public.call_analysis (event_id);

-- Linker + orphan-prune scans over the still-unlinked work set.
create index if not exists call_analysis_unlinked_idx
  on public.call_analysis (received_at) where call_attempt_id is null;

alter table public.call_analysis enable row level security;

-- Owner SELECT: a row is visible to the authenticated user who owns the linked
-- event (direct owner_id) or to an org member with campaigns/view on that event.
-- Same org-aware convention as campaigns.camp_org_select. event_id is a per-row
-- column so can_access_event cannot be hoisted to an initplan (mirrors campaigns).
-- NULL event_id matches no event row => orphan rows are invisible to owners.
drop policy if exists call_analysis_owner_select on public.call_analysis;
create policy call_analysis_owner_select on public.call_analysis
  for select to authenticated
  using (public.can_access_event(event_id, 'campaigns', 'view'));

-- Admin SELECT: mirrors webhook_inbox's admin access, in the initplan-optimized
-- form (row-independent auth expression hoisted once per statement).
drop policy if exists call_analysis_admin_select on public.call_analysis;
create policy call_analysis_admin_select on public.call_analysis
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

-- Grants: strip the broad Supabase default grants and expose SELECT only to
-- authenticated (RLS narrows further to owner/admin rows). anon gets nothing;
-- writes are service-role only (service_role keeps its default grants + BYPASSRLS).
revoke all on table public.call_analysis from public;
revoke all on table public.call_analysis from anon;
revoke all on table public.call_analysis from authenticated;
grant select on table public.call_analysis to authenticated;

comment on table public.call_analysis is
  'Post-call QA + billing signal sink for ElevenLabs webhooks. Metadata only (no guest PII). Service-role writes after HMAC verify; UNIQUE(provider, conversation_id)=idempotency. call_attempt_id/event_id filled later by a linker; event_id scopes owner RLS. Owner SELECT via can_access_event(event_id,''campaigns'',''view''); admin SELECT via has_role; no anon path.';
