-- Contact-quota package, step 1: FOUNDATION ONLY (no behaviour change).
--
-- Plan: docs/superpowers/plans/2026-09-30-contact-quota-package.md (§4.3, §4.5, §4.6, §5 step 1).
-- Owner decisions 2026-09-30 / 2026-10-04: a campaign is sold as a fixed-price package with a
-- QUOTA OF CONTACTS APPROACHED (answered or not). When the quota is full, approaches stop
-- until the owner upgrades; an upgrade raises the quota and keeps progress.
--
-- THIS MIGRATION ONLY ADDS STORAGE. Nothing reads or writes it yet, so no send, call,
-- billing or RSVP path changes:
--   1. campaigns.contact_quota               the quota itself. NULL = no limit, which is what
--                                            every existing campaign keeps (nothing is capped).
--   2. campaign_quota_changes                append-only log of every change to the quota
--                                            (who, when, from what to what, payment reference,
--                                            reason) with an idempotency key so a repeated
--                                            upgrade request cannot be applied twice.
--   3. campaign_quota_alerts                 outbox of threshold alerts (80% / 100% ...). The
--                                            unique key makes each (campaign, quota level,
--                                            threshold) fire once, and it survives a restart.
--
-- NAMING: contact_quota is deliberately NOT included_reached (= "included in the price,
-- overage above it") and NOT max_contacts (= the charge-ceiling input). It counts contacts
-- approached, nothing else.
--
-- WHO MAY WRITE: nobody but the service role. Every app write uses the service-role client
-- (campaigns already has RLS with a SELECT-only policy, so an owner cannot set their own
-- quota through PostgREST); the new tables follow the same closed-table pattern as
-- 20260924034054_owner_agent_whatsapp.sql: revoke everything from public/anon/authenticated,
-- grant SELECT back to authenticated, and let an RLS policy decide which rows. service_role
-- keeps the Supabase defaults, as on the other money tables (owner decision 2026-09-25).
--
-- NO IMMUTABILITY TRIGGER on campaign_quota_changes. campaign_authorized_set_audit has one,
-- but it needs a GUC gate and an explicit delete inside purge_test_event, because the FK
-- cascade from events would otherwise be blocked. Append-only is enforced by privileges
-- here (like billed_results / billing_credits); a trigger can be added together with the
-- purge integration if the owner wants it.
--
-- ROLLBACK (nothing depends on any of this yet):
--   drop table if exists public.campaign_quota_alerts;
--   drop table if exists public.campaign_quota_changes;
--   alter table public.campaigns drop constraint if exists campaigns_contact_quota_nonneg;
--   alter table public.campaigns drop column if exists contact_quota;

-- 1. The quota ---------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists contact_quota integer;

alter table public.campaigns
  add constraint campaigns_contact_quota_nonneg
  check (contact_quota is null or contact_quota >= 0);

comment on column public.campaigns.contact_quota is
  'Package quota: how many contacts this campaign may approach (answered or not). NULL = no limit (every campaign that predates the package model). Raised only by an upgrade, logged in campaign_quota_changes. Not included_reached (included-in-price, overage above) and not max_contacts (charge-ceiling input).';

-- 2. Quota change log --------------------------------------------------------------------
create table if not exists public.campaign_quota_changes (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  -- NULL on either side = "no limit" (previous: the campaign had none; new: the limit was lifted).
  previous_quota  integer,
  new_quota       integer,
  -- Free text on purpose (no closed list, so a new kind never needs a migration). Known today:
  -- 'initial' (set at purchase), 'upgrade' (paid), 'adjustment' (staff, reason required by the
  -- function that writes it).
  kind            text not null,
  reason          text,
  -- The payment's own reference (SUMIT payment / document id), as text. NULL for a change that
  -- involved no payment.
  payment_ref     text,
  -- Caller-supplied, e.g. the payment reference. A repeat of the same request hits the unique
  -- constraint below instead of raising the quota twice.
  idempotency_key text not null,
  -- Who did it: 'user:<uuid>', 'staff:<uuid>' or 'system'. Text, no FK: the row must outlive
  -- the account it names.
  actor           text,
  created_at      timestamptz not null default now(),
  constraint campaign_quota_changes_kind_nonempty check (btrim(kind) <> ''),
  constraint campaign_quota_changes_key_nonempty check (btrim(idempotency_key) <> ''),
  constraint campaign_quota_changes_nonneg
    check ((previous_quota is null or previous_quota >= 0) and (new_quota is null or new_quota >= 0)),
  constraint campaign_quota_changes_is_a_change check (new_quota is distinct from previous_quota),
  constraint campaign_quota_changes_idempotency unique (campaign_id, idempotency_key)
);

comment on table public.campaign_quota_changes is
  'Append-only log of every change to campaigns.contact_quota. Closed table: written by service-role code only; owners read their own rows through RLS. unique(campaign_id, idempotency_key) is the idempotency guard against applying one upgrade twice.';

-- The unique constraint above already serves lookups by campaign_id; this one serves the
-- ON DELETE CASCADE from events.
create index if not exists campaign_quota_changes_event_idx
  on public.campaign_quota_changes (event_id);

-- 3. Threshold alert outbox --------------------------------------------------------------
create table if not exists public.campaign_quota_alerts (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  -- The quota in force when the threshold was crossed. A later upgrade changes it, so the same
  -- percentage fires again for the new quota (and only once for each).
  quota             integer not null,
  threshold_percent smallint not null,
  -- Contacts approached at that moment (evidence; not used to decide anything).
  used              integer not null,
  created_at        timestamptz not null default now(),
  -- NULL until the alert has been delivered to the owner. The sweep reads the NULL rows.
  delivered_at      timestamptz,
  constraint campaign_quota_alerts_quota_nonneg check (quota >= 0),
  constraint campaign_quota_alerts_threshold_range check (threshold_percent between 1 and 100),
  constraint campaign_quota_alerts_used_nonneg check (used >= 0),
  constraint campaign_quota_alerts_once unique (campaign_id, quota, threshold_percent)
);

comment on table public.campaign_quota_alerts is
  'Outbox of quota threshold alerts. Closed table: service-role code inserts a row in the same transaction that crosses the threshold and a worker marks delivered_at. unique(campaign_id, quota, threshold_percent) makes each alert fire once per quota level and survive a restart.';

create index if not exists campaign_quota_alerts_event_idx
  on public.campaign_quota_alerts (event_id);

-- The sweep only ever looks at undelivered rows; keep that lookup a single probe.
create index if not exists campaign_quota_alerts_undelivered_idx
  on public.campaign_quota_alerts (created_at)
  where delivered_at is null;

-- 4. Access ------------------------------------------------------------------------------
alter table public.campaign_quota_changes enable row level security;
alter table public.campaign_quota_alerts  enable row level security;

-- Supabase's default privileges hand every new public table to anon and authenticated.
revoke all on table public.campaign_quota_changes from public, anon, authenticated;
revoke all on table public.campaign_quota_alerts  from public, anon, authenticated;

grant select on table public.campaign_quota_changes to authenticated;
grant select on table public.campaign_quota_alerts  to authenticated;

-- A change carries the payment reference, so it follows the billing permission; an alert is
-- a campaign notice, so it follows the campaigns permission (same as billing_credits and
-- campaign_authorized_set_audit). Owner and org members only: staff read these through the
-- service-role admin pages, not through RLS.
drop policy if exists campaign_quota_changes_org_select on public.campaign_quota_changes;
create policy campaign_quota_changes_org_select
  on public.campaign_quota_changes
  for select
  to authenticated
  using (public.can_access_event(event_id, 'billing', 'view'));

drop policy if exists campaign_quota_alerts_org_select on public.campaign_quota_alerts;
create policy campaign_quota_alerts_org_select
  on public.campaign_quota_alerts
  for select
  to authenticated
  using (public.can_access_event(event_id, 'campaigns', 'view'));
