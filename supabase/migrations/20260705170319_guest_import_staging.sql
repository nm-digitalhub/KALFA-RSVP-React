-- WhatsApp guest-file import — staging layer (plan discussed 2026-07-05,
-- owner approved "הפיצ'ר המלא"). Files/contact-shares sent to the business
-- number are parsed by the worker into PENDING staging rows; guests are
-- created ONLY when the owner confirms in the app (never silently).
create table if not exists public.guest_import_staging (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source text not null
    constraint staging_source check (source in ('whatsapp_document', 'whatsapp_contacts')),
  -- E.164 of the VERIFIED sender (matched against profiles.phone) — audit,
  -- not authorization; the confirm step re-checks event access in-app.
  sender_phone text not null,
  file_name text,
  -- Parsed candidate rows, exactly the bulk-import input shape:
  -- [{full_name, phone, expected_count, group}] — PII lives here, so rows are
  -- purged on confirm/discard and pending rows expire (worker TTL cleanup).
  rows jsonb not null,
  row_count integer not null,
  error_rows jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    constraint staging_status check (status in ('pending', 'confirmed', 'discarded')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists guest_import_staging_event_pending
  on public.guest_import_staging (event_id, created_at desc)
  where status = 'pending';

alter table public.guest_import_staging enable row level security;

-- Reads/updates follow the phase-3 permission model (guests.view / create);
-- INSERTs come only from the worker (service-role — no insert policy).
create policy staging_org_select on public.guest_import_staging
  for select to authenticated
  using (public.can_access_event(event_id, 'guests', 'view'));

create policy staging_org_update on public.guest_import_staging
  for update to authenticated
  using (public.can_access_event(event_id, 'guests', 'create'))
  with check (public.can_access_event(event_id, 'guests', 'create'));
