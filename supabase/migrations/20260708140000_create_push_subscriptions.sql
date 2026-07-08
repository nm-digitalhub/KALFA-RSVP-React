-- =====================================================================
-- Web Push subscriptions for authenticated KALFA users.
--
-- Stores browser Push API subscriptions in Supabase instead of process memory.
-- This is required for production because Next.js Server Actions do not keep
-- durable in-memory state across restarts or deployments.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  expiration_time timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_endpoint_not_blank check (btrim(endpoint) <> ''),
  constraint push_subscriptions_p256dh_not_blank check (btrim(p256dh_key) <> ''),
  constraint push_subscriptions_auth_not_blank check (btrim(auth_key) <> ''),
  constraint push_subscriptions_failure_count_nonnegative check (failure_count >= 0)
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, last_seen_at desc)
  where revoked_at is null;

create index if not exists push_subscriptions_org_active_idx
  on public.push_subscriptions (org_id, last_seen_at desc)
  where revoked_at is null and org_id is not null;

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_owner_select on public.push_subscriptions;
create policy push_subscriptions_owner_select on public.push_subscriptions
  for select
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin'::app_role)
  );

drop policy if exists push_subscriptions_owner_insert on public.push_subscriptions;
create policy push_subscriptions_owner_insert on public.push_subscriptions
  for insert
  with check (
    user_id = auth.uid()
    and (
      org_id is null
      or public.is_org_member(org_id)
      or public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

drop policy if exists push_subscriptions_owner_update on public.push_subscriptions;
create policy push_subscriptions_owner_update on public.push_subscriptions
  for update
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin'::app_role)
  )
  with check (
    (
      user_id = auth.uid()
      and (
        org_id is null
        or public.is_org_member(org_id)
        or public.has_role(auth.uid(), 'admin'::app_role)
      )
    )
    or public.has_role(auth.uid(), 'admin'::app_role)
  );

drop policy if exists push_subscriptions_owner_delete on public.push_subscriptions;
create policy push_subscriptions_owner_delete on public.push_subscriptions
  for delete
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin'::app_role)
  );
