-- Per-person canonical SUMIT customer anchor (plans/sumit-customer-id-
-- reconciliation.md, Phase A). SERVER-ONLY: written on first successful
-- hold, read on every later hold to send Customer:{ID} instead of creating a
-- duplicate SUMIT customer. Keyed 1:1 to the paying account. Same house
-- pattern as console_call_pii (RLS on, zero policies, zero client grants) —
-- verified against Supabase's own "private table for extensive user
-- metadata" guidance (supabase.com/docs/guides/platform/migrating-to-
-- supabase/auth0), fetched live 2026-08-30.
create table public.sumit_customers (
  user_id                 uuid        primary key references auth.users(id) on delete cascade,
  sumit_customer_id       bigint      not null,
  first_seen_campaign_id  uuid        references public.campaigns(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.sumit_customers is
  'SUMIT Customer number per paying account (Data.CustomerID). Server-only; send as Customer:{ID} on every hold once set. Never overwritten by a differing later value — alert instead.';
comment on column public.sumit_customers.first_seen_campaign_id is
  'The hold whose response first produced this id — audit anchor for reconciliation.';

create trigger trg_sumit_customers_updated
  before update on public.sumit_customers
  for each row execute function public.set_updated_at();

alter table public.sumit_customers enable row level security;
-- RLS on with ZERO policies + zero client grants: service-role only.
revoke all on table public.sumit_customers from anon, authenticated;
