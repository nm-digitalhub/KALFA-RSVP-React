-- Audit log for Web Push delivery attempts.
-- This table records every server-side attempt to send a Web Push notification.
-- It does not prove that the user saw the notification; it proves the push
-- provider accepted/rejected the delivery request.

create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),

  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,

  notification_type text not null default 'web_push',
  payload jsonb not null default '{}'::jsonb,

  success boolean not null,
  status_code integer,
  endpoint_host text,
  error_message text,

  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint push_delivery_log_notification_type_not_blank
    check (btrim(notification_type) <> ''),

  constraint push_delivery_log_status_code_valid
    check (status_code is null or (status_code >= 100 and status_code <= 599))
);

create index if not exists push_delivery_log_subscription_id_created_at_idx
  on public.push_delivery_log(subscription_id, created_at desc);

create index if not exists push_delivery_log_user_id_created_at_idx
  on public.push_delivery_log(user_id, created_at desc);

create index if not exists push_delivery_log_org_id_created_at_idx
  on public.push_delivery_log(org_id, created_at desc);

create index if not exists push_delivery_log_event_id_created_at_idx
  on public.push_delivery_log(event_id, created_at desc);

create index if not exists push_delivery_log_success_created_at_idx
  on public.push_delivery_log(success, created_at desc);

alter table public.push_delivery_log enable row level security;

revoke all on public.push_delivery_log from public;
revoke all on public.push_delivery_log from anon;
revoke all on public.push_delivery_log from authenticated;

grant select, insert, update, delete on public.push_delivery_log to service_role;
