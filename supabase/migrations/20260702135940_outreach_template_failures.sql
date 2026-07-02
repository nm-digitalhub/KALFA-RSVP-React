-- Runtime template integrity sink for the outreach engine (C1).
-- Plan: plans/admin-packages-operational-fields-plan.md §5.6.
--
-- A campaign's outreach_schedule touchpoint whose message_key does not
-- resolve to an active message_templates row (or resolves to the wrong
-- channel) currently fails SILENTLY (outreach-engine.ts returns
-- {action:'skipped'}, no log/event). This table gives that failure a
-- durable, deduplicated record. Writes go through the pg-boss worker's
-- service-role client (request-free, no cookie/session) via an atomic
-- upsert with ignoreDuplicates — never a select-then-insert, since two
-- workers can race on the same broken touchpoint across different
-- recipients (claimStep advances a PER-RECIPIENT cursor, so this branch
-- is evaluated independently per contact).
create table public.outreach_template_failures (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  touchpoint_index int not null,
  reason text not null, -- 'template_missing' | 'channel_mismatch'
  message_key text not null,
  channel campaign_channel not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, touchpoint_index, reason)
);

alter table public.outreach_template_failures enable row level security;

-- Admin-only diagnostic data (mirrors webhook_inbox_admin_all — an internal
-- operational table with no owner-facing read need, not
-- campaign_authorized_contacts' owner-visible pattern). All writes are via
-- the worker's service-role client, which bypasses RLS regardless; this
-- policy is defense-in-depth against any other access path.
create policy outreach_template_failures_admin_all on public.outreach_template_failures
  for all using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
