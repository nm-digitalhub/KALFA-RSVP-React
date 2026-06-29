-- Billing control: frozen authorized contact set + minimum hold floor.
--
-- Problem (audited): outreach is NOT bounded by max_contacts while the final
-- charge IS capped at the frozen ceiling, so KALFA could reach (incur cost for)
-- more contacts than it can ever bill -> unrecoverable loss. Currently dormant
-- (outreach config-gated off) -> a go-live prerequisite, not a live fire.
--
-- Fix: at the credit-frame hold (J5) step, FREEZE the set of authorized contacts.
-- Every outreach path AND the billing path are bound to that set, so
-- reached ⊆ authorized BY CONSTRUCTION. Single authorization + single charge per
-- event: the hold is SECURITY only; the final amount is settled at campaign close
-- from the contacts actually reached (≤ ceiling). The floor never raises the charge.
--
-- Additive + reversible. The new table mirrors billed_results' RLS posture
-- (owner SELECT via owns_event; admin ALL; the snapshot is written server-side
-- through the service-role client, so no customer INSERT policy is needed).

-- 1. Frozen authorized contact set (snapshot written at the hold step).
create table if not exists public.campaign_authorized_contacts (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- one authorization row per contact per campaign
  constraint campaign_authorized_contacts_campaign_contact_unique
    unique (campaign_id, contact_id)
);
create index if not exists campaign_authorized_contacts_campaign_idx
  on public.campaign_authorized_contacts (campaign_id);

alter table public.campaign_authorized_contacts enable row level security;

drop policy if exists campaign_authorized_contacts_owner_select
  on public.campaign_authorized_contacts;
create policy campaign_authorized_contacts_owner_select
  on public.campaign_authorized_contacts for select
  using (public.owns_event(event_id));

drop policy if exists campaign_authorized_contacts_admin_all
  on public.campaign_authorized_contacts;
create policy campaign_authorized_contacts_admin_all
  on public.campaign_authorized_contacts for all
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Hold-sizing config knobs (all admin-editable, NO hardcode).
--    covered_contacts = min( full_unique_contacts , reasonable_coverage_contacts )
--    hold    = max( min_hold_floor , covered_contacts × price × (1 + hold_buffer_pct) )
--    CHARGE CEILING = full_unique_contacts × price (§7 / D1=No), NOT covered_contacts —
--    covered_contacts sizes the HOLD only (security). final charge = min(Σ reached price, ceiling).
--    SAFETY INVARIANT (Phase 2): before the hold is lowered to covered×price, the authorized-SET
--    membership MUST be the binding cap on `reached` (sole outreach+billing path), else the
--    (full−covered) tail becomes an unsecured, unrecoverable charge.
--    Defaults (300 / 400) are wedding-anchored p90 / extreme thresholds in BILLABLE
--    CONTACTS (statistical + business research, 2026-06-29); recalibrate from real
--    per-event distinct-phone data once events accrue. Resolution at the hold step:
--    package override (where present) -> app_settings global.

-- 2a. Global coverage thresholds (app_settings singleton).
alter table public.app_settings
  add column if not exists reasonable_coverage_contacts integer not null default 300;
alter table public.app_settings
  add column if not exists extreme_threshold_contacts integer not null default 400;

-- 2b. Per-package economics. min_hold_floor = minimum viable hold (security floor).
--     hold_buffer_pct = escape hatch for multi-channel pricing where a reached
--     call could cost more than price_per_reached (keep 0 while pricing is uniform).
alter table public.packages
  add column if not exists min_hold_floor numeric not null default 0;
alter table public.packages
  add column if not exists hold_buffer_pct numeric not null default 0;
