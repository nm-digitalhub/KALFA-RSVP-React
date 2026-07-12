-- P0-1 authored migration drafts (FULL headers/comments), preserved for maintenance.
-- The APPLIED migration files under supabase/migrations/20260712104xxx_*.sql are the
-- byte-parity record of what actually ran via apply_migration (comment-condensed).
-- This file keeps the richer authored commentary. Logic is identical (verified live).
-- Generated 2026-07-12. NOT a migration.

-- ============================================================
-- authored draft: 20260712122456_campaign_authorized_set_audit.sql
-- ============================================================
-- =====================================================================
-- P0-1 (Workstream A5): append-only audit ledger for authorized-set changes.
--
-- Every mutation of a campaign's authorized recipient set (add / repoint /
-- delete, and pin-because-exposed decisions) is recorded here by the
-- `reconcile_authorized_set` RPC. The ledger is the chargeback-defense proof
-- of *why* a historically-touched contact was pinned into the set, and *who*
-- entered or left it.
--
-- Design notes:
--   * contact_id carries NO foreign key on purpose — an audit row MUST survive
--     hard deletion of the contact it references (the whole point is to keep
--     the trail after a guest/contact is removed).
--   * event_id / campaign_id keep FK + ON DELETE CASCADE: if the parent event
--     or campaign is deleted there is nothing left to bill against, so the
--     trail may go with it.
--   * append-only: RLS grants INSERT (service-role) and SELECT (org-aware)
--     only, and NO UPDATE/DELETE policy is ever created. But the writer is
--     `service_role`, which BYPASSES RLS — so RLS alone does not make the row
--     immutable for the actual writer. A BEFORE UPDATE OR DELETE trigger (below)
--     raises unconditionally, giving genuine chargeback-grade immutability for
--     every DML role (only an explicit superuser `DISABLE TRIGGER` can bypass it).
--
-- Idempotent + forward-only (create table if not exists / guarded policies).
-- =====================================================================

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

-- Primary read pattern: latest changes for a campaign, newest first.
create index if not exists campaign_authorized_set_audit_campaign_at_idx
  on public.campaign_authorized_set_audit (campaign_id, at desc);

alter table public.campaign_authorized_set_audit enable row level security;

-- INSERT: server-side only, written by the reconcile RPC through the
-- service-role client. service_role bypasses RLS, but the explicit policy
-- documents the intended writer and keeps the surface auditable.
drop policy if exists campaign_authorized_set_audit_service_insert
  on public.campaign_authorized_set_audit;
create policy campaign_authorized_set_audit_service_insert
  on public.campaign_authorized_set_audit
  for insert
  to service_role
  with check (true);

-- SELECT: org-aware, mirroring campaign_authorized_contacts' live SELECT
-- posture (org_select via can_access_event + admin via has_role). This lets an
-- event's org members and platform admins read the trail for their own events.
drop policy if exists campaign_authorized_set_audit_org_select
  on public.campaign_authorized_set_audit;
create policy campaign_authorized_set_audit_org_select
  on public.campaign_authorized_set_audit
  for select
  using (
    public.can_access_event(event_id, 'campaigns', 'view')
    or public.has_role(auth.uid(), 'admin'::app_role)
  );

-- NOTE: no UPDATE and no DELETE policy — the ledger is append-only for
-- RLS-subject roles. The trigger below enforces it for service_role too.

-- Genuine immutability: block UPDATE/DELETE for EVERY DML role (service_role
-- bypasses RLS, so the policy absence is not enough). Fires regardless of
-- rolbypassrls; only an explicit superuser DISABLE TRIGGER can override.
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

-- ============================================================
-- authored draft: 20260712122457_billing_exposure_predicates.sql
-- ============================================================
-- =====================================================================
-- P0-1 (Workstream A1): two SEPARATE exposure predicates.
--
-- These are the correctness floor of exposure-gated billing. They MUST stay
-- separate — conflating "may we bill this contact" with "did we ever touch
-- this contact" was the bug in the previous design (it let a courtesy /
-- non-billable outbound send flip a contact to billable).
--
--   1. exposed_for_billing()  — narrow, channel-aware. Derives the BILLING
--      gate. Called only by try_record_billed_result (which itself is only
--      invoked by a signed webhook-reach: WhatsApp inbound / call-answered).
--
--   2. has_service_exposure() — broad. Derives the PIN decision inside
--      reconcile_authorized_set (never the billing gate). A contact we have
--      merely *touched* must not be free-swapped, because a billing callback
--      can still arrive late.
--
-- Both are STABLE SECURITY DEFINER with a pinned search_path, and are granted
-- to service_role only (revoked from public/anon/authenticated).
--
-- Derived, not materialized: the signals already persist elsewhere; measuring
-- them inside the RPC transaction (under the campaigns FOR UPDATE lock) avoids
-- TOCTOU, and keeps the contract stable for P1 (where exposed_for_billing's
-- body is swapped for a ledger read).
--
-- Idempotent + forward-only (create or replace).
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) exposed_for_billing — the BILLING gate (narrow, channel-aware).
--
-- TRUE iff, for this contact:
--   * a billed_results row already exists for (event, contact)  [monotonic —
--     once billed, always exposed], OR
--   * WhatsApp: a *billable* inbound contact_interaction exists for this
--     (campaign, contact). billable=true is written BEFORE this RPC runs
--     (webhook-processing) and marks a genuine inbound reply/RSVP — real
--     reach. Outbound sends (direction='out', billable=false) are NOT reach
--     and are excluded, so a courtesy / gift / event-day message never makes a
--     contact billable, OR
--   * Call:  call_request_count > 0 for this (campaign, contact). The call was
--     placed to this contact (written at dispatch, before this RPC); the RPC
--     itself only fires from the call-answered webhook, so dispatch+webhook
--     together mean reach.
--
-- Deliberately does NOT use reached_at (written AFTER this RPC, only on
-- 'billed' — circular), bare op_status (not campaign-scoped), or any
-- direction='out' send.
-- ---------------------------------------------------------------------
create or replace function public.exposed_for_billing(
  p_campaign uuid,
  p_contact  uuid,
  p_event    uuid,
  p_channel  public.campaign_channel
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    -- monotonic: an existing billing row is itself proof of exposure.
    exists (
      select 1
      from public.billed_results br
      where br.event_id = p_event
        and br.contact_id = p_contact
    )
    or (
      p_channel = 'whatsapp'
      and exists (
        select 1
        from public.contact_interactions ci
        where ci.campaign_id = p_campaign
          and ci.contact_id = p_contact
          and ci.billable = true
          -- self-enforcing money gate: only a genuine inbound WhatsApp reply counts,
          -- never a stray/erroneous billable row on an outbound or other-channel record.
          and ci.direction = 'in'
          and ci.channel = 'whatsapp'
      )
    )
    or (
      p_channel = 'call'
      and exists (
        select 1
        from public.outreach_state os
        where os.campaign_id = p_campaign
          and os.contact_id = p_contact
          and os.call_request_count > 0
      )
    );
$$;

revoke all on function public.exposed_for_billing(uuid, uuid, uuid, public.campaign_channel) from public;
revoke all on function public.exposed_for_billing(uuid, uuid, uuid, public.campaign_channel) from anon;
revoke all on function public.exposed_for_billing(uuid, uuid, uuid, public.campaign_channel) from authenticated;
grant execute on function public.exposed_for_billing(uuid, uuid, uuid, public.campaign_channel) to service_role;

-- ---------------------------------------------------------------------
-- (2) has_service_exposure — the PIN decision (broad).
--
-- TRUE iff we have touched this (campaign, contact) in ANY way that could
-- still resolve to a late billing callback:
--   * any contact_interaction, inbound OR outbound, for this campaign+contact,
--   * outreach_state with call_request_count > 0 OR reached_at not null for
--     this campaign+contact,
--   * any billed_results row for this contact.
--
-- Used ONLY by reconcile_authorized_set to decide swap-vs-pin. NEVER used as a
-- billing gate.
-- ---------------------------------------------------------------------
create or replace function public.has_service_exposure(
  p_campaign uuid,
  p_contact  uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    exists (
      select 1
      from public.contact_interactions ci
      where ci.campaign_id = p_campaign
        and ci.contact_id = p_contact
        and ci.direction in ('out', 'in')
    )
    or exists (
      select 1
      from public.outreach_state os
      where os.campaign_id = p_campaign
        and os.contact_id = p_contact
        and (os.call_request_count > 0 or os.reached_at is not null)
    )
    or exists (
      select 1
      from public.billed_results br
      where br.contact_id = p_contact
    );
$$;

revoke all on function public.has_service_exposure(uuid, uuid) from public;
revoke all on function public.has_service_exposure(uuid, uuid) from anon;
revoke all on function public.has_service_exposure(uuid, uuid) from authenticated;
grant execute on function public.has_service_exposure(uuid, uuid) to service_role;

-- ============================================================
-- authored draft: 20260712122458_reconcile_authorized_set.sql
-- ============================================================
-- =====================================================================
-- P0-1 (Workstream A4): reconcile_authorized_set — the single writer of the
-- campaign authorized recipient set (add / repoint / delete).
--
-- Runs under the SAME `campaigns ... FOR UPDATE` lock class as the billing RPC
-- (try_record_billed_result), so add/remove/pin and bill serialize against
-- each other — no free-swap can race a late billing callback.
--
-- The pin decision uses has_service_exposure (broad) — NOT exposed_for_billing
-- — because we must protect any contact we have already *touched* (a billing
-- callback can still arrive), not only one already billed.
--
-- ADMIT ELIGIBILITY (fail-closed): a contact is inserted into the set ONLY if it
-- (a) belongs to this campaign's event, (b) is not removal_requested, and (c) is
-- referenced by a LIVE guest of the event. A contact failing any of these is
-- never admitted → return 'not_eligible'. (Delete/pin paths do not admit, so the
-- gate does not apply to them.) This mirrors listSendableContacts (removal) +
-- snapshotAuthorizedSet (guests!inner) and blocks orphan/foreign/opted-out admits.
--
-- funded_cap = least(max_contacts, floor(auth_amount / price_per_reached)) — but
-- FAIL-CLOSED: if max_contacts / auth_amount / price_per_reached is missing or
-- non-positive there is NO fallback to max_contacts (least() ignores NULLs, which
-- would silently fall back); the cap collapses to 0 so nothing new is admitted
-- until the hold is valid. In P0-1 max_contacts is still the operative billing
-- count cap; funded_cap only ever bounds set GROWTH here.
--
-- Every terminal path that changes set membership OR pins a contact writes
-- exactly one audit row; the pin-and-admit path writes two (kept_exposed for the
-- pinned contact + in for the admitted one). Pure no-ops, ceiling/eligibility
-- rejections with no membership change, and gate failures write no audit row.
-- action ∈ {in,out,kept_exposed} by construction.
--
-- Return codes: added, swapped, pinned_and_added, pinned_kept, ceiling_full,
-- not_eligible, removed, noop, no_campaign, event_mismatch, not_operational.
--
-- SECURITY DEFINER, pinned search_path, granted to service_role only.
-- Idempotent + forward-only (create or replace).
-- =====================================================================
create or replace function public.reconcile_authorized_set(
  p_event        uuid,
  p_campaign     uuid,
  p_op           text,
  p_contact      uuid,
  p_prev_contact uuid default null,
  p_actor        text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event_id       uuid;
  v_status         text;
  v_max            int;
  v_auth           numeric;
  v_price          numeric;
  v_funded_cap     int;
  v_size           int;
  v_new_member     boolean;   -- is p_contact (the NEW / target contact) in the set?
  v_prev_member    boolean;   -- is p_prev_contact (the OLD contact) in the set?
  v_target_ok      boolean;   -- is p_contact ELIGIBLE to be admitted?
begin
  -- Authoritative campaign row under the same lock class as billing.
  select event_id, status::text, max_contacts, auth_amount, price_per_reached
    into v_event_id, v_status, v_max, v_auth, v_price
    from public.campaigns
    where id = p_campaign
    for update;
  if not found then
    return 'no_campaign';
  end if;

  -- The caller-supplied event must match the campaign's event (defensive).
  if p_event is distinct from v_event_id then
    return 'event_mismatch';
  end if;

  -- Gate: only the three known ops, and only while the campaign is in a
  -- reconcilable (operational) status.
  if p_op not in ('add', 'repoint', 'delete') then
    return 'not_operational';
  end if;
  if v_status not in ('approved', 'scheduled', 'active', 'paused') then
    return 'not_operational';
  end if;

  -- funded_cap: FAIL-CLOSED. No money basis (null/non-positive) → 0, never a
  -- silent fallback to max_contacts (which least() would produce on a NULL).
  if v_max is null or v_auth is null or v_price is null
     or v_auth <= 0 or v_price <= 0 then
    v_funded_cap := 0;
  else
    v_funded_cap := least(v_max, floor(v_auth / v_price))::int;
  end if;

  -- Current membership snapshot (measured under the lock).
  select count(*) into v_size
    from public.campaign_authorized_contacts
    where campaign_id = p_campaign;

  v_new_member := exists (
    select 1 from public.campaign_authorized_contacts
    where campaign_id = p_campaign and contact_id = p_contact
  );
  v_prev_member := p_prev_contact is not null and exists (
    select 1 from public.campaign_authorized_contacts
    where campaign_id = p_campaign and contact_id = p_prev_contact
  );

  -- Admit eligibility of the TARGET contact (p_contact): belongs to this event,
  -- not opted out, and referenced by a live guest of the event. contact absent
  -- → false (fail-closed).
  select (c.event_id = v_event_id
          and c.removal_requested = false
          and exists (select 1 from public.guests g
                      where g.event_id = v_event_id and g.contact_id = p_contact))
    into v_target_ok
    from public.contacts c
    where c.id = p_contact;
  v_target_ok := coalesce(v_target_ok, false);

  -- ==================================================================
  -- ADD
  -- ==================================================================
  if p_op = 'add' then
    if v_new_member then
      return 'noop';
    end if;
    if not v_target_ok then
      return 'not_eligible';   -- foreign/opted-out/orphan → never admitted
    end if;
    if v_size >= v_funded_cap then
      return 'ceiling_full';   -- no membership change → no audit row
    end if;
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (v_event_id, p_campaign, p_contact)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_contact, null, 'in', 'add', p_actor, v_size);
    return 'added';
  end if;

  -- ==================================================================
  -- REPOINT  (old = p_prev_contact = A, new = p_contact = B)
  -- ==================================================================
  if p_op = 'repoint' then
    -- (a) A was never in the set → behaves like an add of B.
    if not v_prev_member then
      if v_new_member then
        return 'noop';
      end if;
      if not v_target_ok then
        return 'not_eligible';
      end if;
      if v_size >= v_funded_cap then
        return 'ceiling_full';   -- no membership change → no audit row
      end if;
      insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
        values (v_event_id, p_campaign, p_contact)
        on conflict (campaign_id, contact_id) do nothing;
      v_size := v_size + 1;
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_contact, p_prev_contact, 'in', 'repoint', p_actor, v_size);
      return 'added';
    end if;

    -- (b) A is a member but was never touched → free swap (remove A, add B).
    --     B must still be eligible; if not, we do NOT drop A (no silent loss) and
    --     reject — the app can resolve. A stays as-is (still a member).
    if not public.has_service_exposure(p_campaign, p_prev_contact) then
      if not v_new_member and not v_target_ok then
        return 'not_eligible';
      end if;
      delete from public.campaign_authorized_contacts
        where campaign_id = p_campaign and contact_id = p_prev_contact;
      insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
        values (v_event_id, p_campaign, p_contact)
        on conflict (campaign_id, contact_id) do nothing;
      select count(*) into v_size
        from public.campaign_authorized_contacts
        where campaign_id = p_campaign;
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_contact, p_prev_contact, 'in', 'repoint', p_actor, v_size);
      return 'swapped';
    end if;

    -- (c) A is a member AND has been touched → pin A (stays historical).
    --     B is admitted only if eligible, not already a member, and there is room.
    if v_new_member then
      -- A pinned, B already present → nothing admitted.
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'pinned_kept';
    end if;
    if not v_target_ok then
      -- A pinned, but B is not eligible to be admitted.
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'not_eligible';
    end if;
    if v_size >= v_funded_cap then
      -- A pinned, but no room to admit B.
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
      return 'ceiling_full';
    end if;
    -- A pinned AND B admitted → two audit rows.
    insert into public.campaign_authorized_contacts (event_id, campaign_id, contact_id)
      values (v_event_id, p_campaign, p_contact)
      on conflict (campaign_id, contact_id) do nothing;
    v_size := v_size + 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_prev_contact, null, 'kept_exposed', 'repoint', p_actor, v_size);
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_contact, p_prev_contact, 'in', 'repoint', p_actor, v_size);
    return 'pinned_and_added';
  end if;

  -- ==================================================================
  -- DELETE  (target = p_contact = A)
  -- ==================================================================
  if p_op = 'delete' then
    if not v_new_member then
      return 'noop';
    end if;
    if public.has_service_exposure(p_campaign, p_contact) then
      -- Touched → keep it pinned (a late billing callback may still land).
      insert into public.campaign_authorized_set_audit
        (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
        values (v_event_id, p_campaign, p_contact, null, 'kept_exposed', 'delete', p_actor, v_size);
      return 'pinned_kept';
    end if;
    delete from public.campaign_authorized_contacts
      where campaign_id = p_campaign and contact_id = p_contact;
    v_size := v_size - 1;
    insert into public.campaign_authorized_set_audit
      (event_id, campaign_id, contact_id, prev_contact_id, action, reason, actor, resulting_size)
      values (v_event_id, p_campaign, p_contact, null, 'out', 'delete', p_actor, v_size);
    return 'removed';
  end if;

  -- Unreachable (p_op already gated), but keep the contract total.
  return 'not_operational';
end;
$$;

revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from public;
revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from anon;
revoke all on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) from authenticated;
grant execute on function public.reconcile_authorized_set(uuid, uuid, text, uuid, uuid, text) to service_role;

-- ============================================================
-- authored draft: 20260712122459_app_settings_billing_exposure_gate.sql
-- ============================================================
-- P0-1 (A2a) — billing-exposure toggle column on the wide single-row app_settings table.
--
-- app_settings is a SINGLE-ROW WIDE singleton (id boolean PK) with named boolean
-- columns (e.g. campaign_holds_enabled, outreach_enabled) — NOT key/value. The toggle
-- is therefore a NEW boolean column, matching the existing convention.
--
-- false  = legacy behavior (try_record_billed_result gates on campaign_authorized_contacts
--          set membership, returning 'not_authorized').
-- true   = exposure-gated billing (gates on public.exposed_for_billing, returning
--          'no_exposure').
--
-- Default false so the RPC keeps legacy behavior until an operator flips the toggle
-- to live after smoke-testing — no migration required to switch. Forward-only, idempotent.

alter table public.app_settings
  add column if not exists billing_exposure_gate boolean not null default false;

-- ============================================================
-- authored draft: 20260712122500_billed_result_exposure_gate.sql
-- ============================================================
-- P0-1 (A2) — Harden try_record_billed_result: exposure-gated billing behind a toggle.
--
-- create-or-replace reproducing the LIVE body (identical to
-- 20260630223635_event_lifecycle_state_model.sql:196-246, verified verbatim against the
-- live DB via pg_get_functiondef on 2026-07-12) with EXACTLY ONE block changed: the
-- 'not_authorized' set-membership check is replaced by a toggle on
-- app_settings.billing_exposure_gate:
--   gate=true  -> gate on public.exposed_for_billing(...), return 'no_exposure' if not exposed
--   gate=false -> legacy campaign_authorized_contacts membership, return 'not_authorized'
-- Every other line (all guards, the FOR UPDATE lock, ceiling_reached, the insert) is
-- byte-identical to the live function.
--
-- Rollback baseline (verbatim original body) is preserved at
-- docs/p0-1-rpc-rollback-baseline.sql — rollback is a copy-paste create-or-replace.
-- Forward-only, idempotent (create or replace).

create or replace function public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel public.campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz;
  v_count int; v_removed boolean; v_event_id uuid; v_event_date timestamptz;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, price_per_reached, max_contacts, start_at, close_at
    into v_event_id, v_status, v_price, v_max, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  -- L2: the caller-supplied event must match the campaign's event (defensive;
  -- the insert below uses v_event_id regardless).
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never bill for an event whose day has already passed (Israel calendar) —
  -- independent of close_at (NULL-window) and of the L1 stepGate (inbound path).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  -- R9: never bill for a campaign whose event is not active. public.-qualified
  -- (round-2 completion) regardless of the function's own search_path.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;
  -- Phase 2 BINDING CAP: the frozen authorized SET caps `reached` by construction.
  -- A contact not in the snapshot NEVER bills (fail-closed: empty set → bills nobody).
  -- P0-1 (A2): behind the billing_exposure_gate toggle, derive billing authorization from
  -- real billing-exposure instead of set membership (default false = legacy behavior).
  if coalesce((select billing_exposure_gate from public.app_settings limit 1), false) then
    if not public.exposed_for_billing(p_campaign, p_contact, v_event_id, p_channel)
      then return 'no_exposure'; end if;
  else
    if not exists (select 1 from public.campaign_authorized_contacts a
                   where a.campaign_id=p_campaign and a.contact_id=p_contact)
      then return 'not_authorized'; end if;
  end if;
  -- Secondary defense (count cap): set membership already bounds reached at |set|.
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_max then return 'ceiling_reached'; end if;
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;

-- Re-assert lockdown (money path: service_role only).
revoke all on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) from public, anon, authenticated;
grant execute on function public.try_record_billed_result(uuid, uuid, uuid, public.campaign_channel, text, text, text) to service_role;

-- ============================================================
-- authored draft: 20260712122501_billed_results_contact_fk_restrict.sql
-- ============================================================
-- P0-1 (A3) — Harden the billed_results.contact_id FK: ON DELETE CASCADE -> ON DELETE RESTRICT.
--
-- Owner decision: a contact that has already been billed must NOT be hard-deletable, so the
-- immutable billing row survives and the authorization pin stays durable. The live constraint
-- was billed_results_contact_id_fkey ... ON DELETE CASCADE (verified via pg_constraint on the
-- live DB 2026-07-12) — deleting a contact silently deleted its billing row, violating
-- "billing = immutable". Forward-only; idempotent (guarded drop + recreate).

alter table public.billed_results
  drop constraint if exists billed_results_contact_id_fkey;

alter table public.billed_results
  add constraint billed_results_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete restrict;

