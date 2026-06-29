-- webhook_inbox: durable persist-then-process intake for provider webhooks
-- (WhatsApp/Meta first). The route verifies the signature, normalizes, inserts
-- here, and returns 200 fast; a pg-boss worker processes rows out-of-band so the
-- economic logic never depends on the HTTP request lifetime. Raw payloads hold
-- PII (phones/names) → admin-only RLS + service-role writes; never logged.
create table if not exists public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'whatsapp',
  event_kind text not null,                 -- 'message' | 'status'
  dedupe_key text not null,                 -- 'wa-msg:<wamid>' | 'wa-status:<wamid>:<status>'
  message_id text,                          -- wamid
  context_message_id text,                  -- inbound context.id (reply target)
  phone_number_id text,
  event_at timestamptz,
  payload jsonb not null,                   -- raw event (PII)
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text,
  unique (provider, dedupe_key)
);

-- Worker poll path: unprocessed rows, oldest first.
create index if not exists webhook_inbox_unprocessed_idx
  on public.webhook_inbox (received_at) where processed_at is null;

-- Admin inspector list path: newest first across all rows.
create index if not exists webhook_inbox_received_idx
  on public.webhook_inbox (received_at desc);

alter table public.webhook_inbox enable row level security;

-- Admin-only access. The reader uses the service-role client (bypasses RLS); this
-- policy is defense-in-depth and mirrors app_settings_admin_all. Without ANY
-- policy, RLS-enabled returns zero rows to the cookie/authenticated role.
do $$ begin
  create policy webhook_inbox_admin_all on public.webhook_inbox
    for all
    using (public.has_role(auth.uid(), 'admin'::public.app_role))
    with check (public.has_role(auth.uid(), 'admin'::public.app_role));
exception when duplicate_object then null; end $$;

-- contact_interactions: extend in place (NO parallel outbound table — the
-- outbound wamid is already stored as provider_id; reuse it). guest_id enables
-- RSVP-from-button; context_message_id links an inbound reply to its outbound;
-- delivery_* carry the latest message delivery status + raw Meta error code.
alter table public.contact_interactions
  add column if not exists guest_id uuid references public.guests(id),
  add column if not exists context_message_id text,
  add column if not exists delivery_status text,
  add column if not exists delivery_error_code text;
