-- P0-1 (Workstream A5): append-only audit ledger for authorized-set changes.
create table if not exists public.campaign_authorized_set_audit (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  -- INTENTIONALLY no FK: the audit row must outlive the contact it names.
  contact_id      uuid,
  prev_contact_id uuid,
  action          text check (action in ('in', 'out', 'kept_exposed')),
  reason          text check (reason in ('add', 'repoint', 'delete', 'snapshot')),
  actor           text,
  resulting_size  int,
  at              timestamptz not null default now()
);

create index if not exists campaign_authorized_set_audit_campaign_at_idx
  on public.campaign_authorized_set_audit (campaign_id, at desc);

alter table public.campaign_authorized_set_audit enable row level security;

drop policy if exists campaign_authorized_set_audit_service_insert
  on public.campaign_authorized_set_audit;
create policy campaign_authorized_set_audit_service_insert
  on public.campaign_authorized_set_audit
  for insert
  to service_role
  with check (true);

drop policy if exists campaign_authorized_set_audit_org_select
  on public.campaign_authorized_set_audit;
create policy campaign_authorized_set_audit_org_select
  on public.campaign_authorized_set_audit
  for select
  using (
    public.can_access_event(event_id, 'campaigns', 'view')
    or public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Genuine immutability: block UPDATE/DELETE for EVERY DML role (service_role
-- bypasses RLS). Fires regardless of rolbypassrls.
create or replace function public.campaign_authorized_set_audit_no_mutate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'campaign_authorized_set_audit is append-only (% blocked)', tg_op;
end;
$$;

drop trigger if exists campaign_authorized_set_audit_immutable
  on public.campaign_authorized_set_audit;
create trigger campaign_authorized_set_audit_immutable
  before update or delete on public.campaign_authorized_set_audit
  for each row execute function public.campaign_authorized_set_audit_no_mutate();
