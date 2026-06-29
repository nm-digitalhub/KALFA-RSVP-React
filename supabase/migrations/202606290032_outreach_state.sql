-- C1: outreach_state — the per-(campaign,contact) engine cursor + audit.
--
-- The pg-boss worker advances each contact through the §10 schedule; this table
-- is the durable cursor (compare-and-advance idempotency) + an owner-visible
-- audit. billed_results stays the billing source of truth; contacts.op_status
-- stays the §11 operational status — this table is ONLY the engine's progress.
--
-- Additive (verified: table absent live, 0 active campaigns, 0 rows it touches).
-- RLS mirrors billed_results: owner SELECT via owns_event; admin ALL; the worker
-- writes via the service-role client (RLS-bypassing).

create table if not exists public.outreach_state (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events(id) on delete cascade,
  campaign_id         uuid not null references public.campaigns(id) on delete cascade,
  contact_id          uuid not null references public.contacts(id) on delete cascade,
  status              text not null default 'active',   -- active|reached|stopped|exhausted|not_eligible
  current_step_index  integer not null default 0,       -- compare-and-advance cursor
  whatsapp_sent_count integer not null default 0,
  call_request_count  integer not null default 0,
  next_run_at         timestamptz,
  reached_at          timestamptz,
  reached_channel     public.campaign_channel,
  stop_reason         text,                              -- reached|closed|removal_requested|consent_revoked
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint outreach_state_campaign_contact_unique unique (campaign_id, contact_id)
);

create index if not exists outreach_state_campaign_status_idx
  on public.outreach_state (campaign_id, status);

alter table public.outreach_state enable row level security;

drop policy if exists outreach_state_owner_select on public.outreach_state;
create policy outreach_state_owner_select on public.outreach_state for select
  using (public.owns_event(event_id));

drop policy if exists outreach_state_admin_all on public.outreach_state;
create policy outreach_state_admin_all on public.outreach_state for all
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop trigger if exists set_outreach_state_updated_at on public.outreach_state;
create trigger set_outreach_state_updated_at
  before update on public.outreach_state
  for each row execute function public.set_updated_at();
