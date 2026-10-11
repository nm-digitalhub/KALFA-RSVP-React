-- personal-coupons tasks 1.2 + 1.3 — the operations and the phase-1 wiring. Sibling of
-- 20261011232404_coupons_and_campaign_pricing.sql; pushed together. Change: openspec/changes/personal-coupons
-- (D5, D6, D7, D8 phase 1, D15, D17, D21, D22, D23).
--
-- WHAT IT ADDS:
--   1. The guard on campaign_pricing (D6): a locked row refuses every change except the one-way superseded mark;
--      a superseded row refuses everything; only an unlocked, current row may be deleted (the test-purge path).
--   2. The version bump on the unlocked current row (D2).
--   3. The shared refusal predicate of release, supersede and escalation (D17/D22/D23) is the EXISTING
--      campaign_has_payment_activity (the cancel guard's ledger predicate) — reused, not duplicated.
--   4. The operation functions (SECURITY DEFINER, service_role only, D6 lock order: campaign → current pricing →
--      assignment): bind_coupon_assignment (incl. the move), release_coupon_assignment, approve_package_terms
--      (request id + round id + expected version), supersede_campaign_pricing (reasons benefit_accepted /
--      lapsed_reapproval).
--   5. The open-payment guard (D22) as a BEFORE INSERT trigger on payment_operations: any insert naming a
--      pricing_round_id is validated in ITS OWN transaction — the round is current and locked, the amount equals it,
--      and the bound benefit is still bound, unexpired, not void or consumed. This realizes the design's
--      open_package_payment at the only place it cannot be bypassed; it takes the campaign row lock, so an open and
--      a supersede serialize.
--   6. Phase 1 of D8: campaigns.package_price stays the source — a sync trigger upserts the pricing row (refused when
--      locked or carrying an assignment), an approval by the OLD code path locks the pricing row, and the prices of
--      every existing campaign are copied (ever-approved campaigns locked at their approval time).
--
-- The consume trigger is task 3.2 (its own migration, with the settlement work).
--
-- ROLLBACK: drop the triggers and functions created here; phase-1 copy rows can be deleted while unlocked only
-- (a locked row is history and stays).

set local lock_timeout = '5s';

-- ── 1+2. The pricing guard and the version bump ─────────────────────────────

create or replace function public.campaign_pricing_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.superseded_at is not null or old.locked_at is not null then
      raise exception 'campaign_pricing: a % row cannot be deleted',
        case when old.superseded_at is not null then 'superseded' else 'locked' end;
    end if;
    return old; -- an unlocked current row (the purge path, task 1.4)
  end if;

  if old.superseded_at is not null then
    raise exception 'campaign_pricing: a superseded row is immutable';
  end if;

  if old.locked_at is not null then
    -- The ONE exception (D6/D22): the one-way superseded mark, everything else byte-identical.
    if  new.superseded_at is not null
    and new.superseded_by is not null
    and new.campaign_id          = old.campaign_id
    and new.list_price           = old.list_price
    and new.discount_amount      = old.discount_amount
    and new.package_price        = old.package_price
    and new.coupon_assignment_id is not distinct from old.coupon_assignment_id
    and new.version              = old.version
    and new.locked_at            = old.locked_at
    and new.created_at           = old.created_at then
      return new;
    end if;
    raise exception 'campaign_pricing: a locked row cannot change';
  end if;

  -- Unlocked current row: the key and the birth time never change; it cannot be marked superseded (only a locked
  -- row is ever superseded — an unlocked one is edited in place).
  if new.campaign_id <> old.campaign_id or new.created_at <> old.created_at then
    raise exception 'campaign_pricing: campaign_id/created_at are immutable';
  end if;
  if new.superseded_at is not null then
    raise exception 'campaign_pricing: only a locked row can be superseded';
  end if;
  return new;
end $$;

create trigger campaign_pricing_a_guard
  before update or delete on public.campaign_pricing
  for each row execute function public.campaign_pricing_guard();

create or replace function public.campaign_pricing_version_bump()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.list_price, new.discount_amount, new.package_price) is distinct from
     (old.list_price, old.discount_amount, old.package_price)
     or new.coupon_assignment_id is distinct from old.coupon_assignment_id then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

-- Fires after the guard (alphabetical: a_guard < b_version), and only on rows the guard let through unlocked.
create trigger campaign_pricing_b_version
  before update on public.campaign_pricing
  for each row
  when (old.locked_at is null and old.superseded_at is null)
  execute function public.campaign_pricing_version_bump();

-- ── 3. The shared money predicate ───────────────────────────────────────────
-- REUSED, not recreated: public.campaign_has_payment_activity(uuid) already exists (the cancel guard's predicate,
-- ledger-based since 20261011190351). It is strictly broader than D17/D22's "a package payment pending, in review or
-- succeeded" — any non-'none' effect in flight blocks, and settled TEST money does not — which is exactly the safe
-- direction for release, supersede and escalation.

-- ── 4. The operation functions ──────────────────────────────────────────────

-- Binds an assignment to a campaign, or moves its bound option when the package changed (D5). Eligibility (the
-- verified-phone claim, ownership) is the server's check before calling; this function enforces the state machine.
create or replace function public.bind_coupon_assignment(_assignment_id uuid, _campaign_id uuid, _actor_user_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign  record;
  v_pricing   public.campaign_pricing%rowtype;
  v_asg       public.coupon_assignments%rowtype;
  v_option    public.coupon_assignment_options%rowtype;
begin
  select id, template_id into v_campaign from public.campaigns where id = _campaign_id for update;
  if not found then raise exception 'bind: campaign not found'; end if;

  select * into v_pricing from public.campaign_pricing
   where campaign_id = _campaign_id and superseded_at is null for update;
  if not found then raise exception 'bind: no current pricing row'; end if;
  if v_pricing.locked_at is not null then raise exception 'bind: pricing is locked'; end if;

  select * into v_asg from public.coupon_assignments where id = _assignment_id for update;
  if not found then raise exception 'bind: assignment not found'; end if;
  if v_asg.state not in ('assigned', 'bound') or (v_asg.state = 'bound' and v_asg.bound_campaign_id <> _campaign_id) then
    raise exception 'bind: assignment is not available (state %)', v_asg.state;
  end if;
  if v_asg.expires_at <= now() then raise exception 'bind: assignment expired'; end if;

  select * into v_option from public.coupon_assignment_options
   where assignment_id = _assignment_id and package_id = v_campaign.template_id;
  if not found then
    -- The chosen package has no option (D5): the pricing returns to its list price and the assignment to assigned.
    update public.campaign_pricing
       set discount_amount = 0, package_price = list_price, coupon_assignment_id = null
     where id = v_pricing.id;
    update public.coupon_assignments set state = 'assigned', bound_campaign_id = null where id = _assignment_id;
    insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
      values (_assignment_id, 'unbound_no_option', _actor_user_id, 'package has no option');
    return 'no_option';
  end if;

  -- D18: binding a different assignment frees the one the pricing carried, in the same transaction.
  if v_pricing.coupon_assignment_id is not null and v_pricing.coupon_assignment_id <> _assignment_id then
    update public.coupon_assignments
       set state = case when expires_at <= now() then 'void' else 'assigned' end,
           bound_campaign_id = null
     where id = v_pricing.coupon_assignment_id;
    insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
      values (v_pricing.coupon_assignment_id, 'released', _actor_user_id, 'replaced by a better-priced assignment (D18)');
  end if;

  update public.campaign_pricing
     set list_price = v_option.list_price,
         discount_amount = v_option.discount_amount,
         package_price = v_option.final_price,
         coupon_assignment_id = _assignment_id
   where id = v_pricing.id;
  update public.coupon_assignments set state = 'bound', bound_campaign_id = _campaign_id where id = _assignment_id;
  insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
    values (_assignment_id, case when v_asg.state = 'bound' then 'moved' else 'bound' end, _actor_user_id, null);
  return 'bound';
end $$;

-- The internal step of the automatic move, and of freeing a cancelled campaign's assignment (D17). Never a staff
-- action. When the campaign is cancelled the pricing row may be locked: then ONLY the assignment side changes.
create or replace function public.release_coupon_assignment(_assignment_id uuid, _reason text, _actor_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asg      public.coupon_assignments%rowtype;
  v_pricing  public.campaign_pricing%rowtype;
  v_status   text;
begin
  select * into v_asg from public.coupon_assignments where id = _assignment_id for update;
  if not found then raise exception 'release: assignment not found'; end if;
  if v_asg.state <> 'bound' then raise exception 'release: assignment is not bound'; end if;

  select status into v_status from public.campaigns where id = v_asg.bound_campaign_id for update;

  select * into v_pricing from public.campaign_pricing
   where campaign_id = v_asg.bound_campaign_id and superseded_at is null for update;

  if public.campaign_has_payment_activity(v_asg.bound_campaign_id) then
    raise exception 'release: the campaign has money movement';
  end if;

  if found and v_pricing.locked_at is null then
    update public.campaign_pricing
       set discount_amount = 0, package_price = list_price, coupon_assignment_id = null
     where id = v_pricing.id;
  elsif found and v_pricing.locked_at is not null and v_status <> 'cancelled' then
    -- A locked price is released only when its campaign was cancelled (D17); anything else is refused.
    raise exception 'release: pricing is locked';
  end if;

  update public.coupon_assignments
     set state = case when expires_at <= now() then 'void' else 'assigned' end,
         bound_campaign_id = null
   where id = _assignment_id;
  insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
    values (_assignment_id, 'released', _actor_user_id, _reason);
end $$;

-- D7: atomic, versioned approval bound to the exact pricing round. The approval_requests row (state open) was
-- written by the server BEFORE the PDF was uploaded; a retry reuses its id and reads the stored outcome.
create or replace function public.approve_package_terms(
  _request_id uuid,
  _campaign_id uuid,
  _pricing_round_id uuid,
  _expected_version integer,
  _signer_user_id uuid,
  _agreement_version text,
  _ip text,
  _user_agent text,
  _content_hash text,
  _pdf_ref text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign  record;
  v_pricing   public.campaign_pricing%rowtype;
begin
  select id, event_id, status into v_campaign from public.campaigns where id = _campaign_id for update;
  if not found then raise exception 'approve: campaign not found'; end if;
  if v_campaign.status <> 'pending_approval' then
    raise exception 'approve_refused: campaign status is %', v_campaign.status;
  end if;

  select * into v_pricing from public.campaign_pricing
   where campaign_id = _campaign_id and superseded_at is null for update;
  if not found then raise exception 'approve: no current pricing row'; end if;
  -- The round id, not the per-row version alone: a document rendered from a superseded round is refused even when
  -- the version numbers coincide.
  if v_pricing.id <> _pricing_round_id then raise exception 'approve_refused: stale pricing round'; end if;
  if v_pricing.version <> _expected_version then raise exception 'approve_refused: stale pricing version'; end if;
  if v_pricing.locked_at is not null then raise exception 'approve_refused: already locked'; end if;

  update public.approval_requests
     set state = 'approved', concluded_at = now()
   where id = _request_id and state = 'open';
  if not found then raise exception 'approve: request % is not open', _request_id; end if;

  insert into public.signed_agreements
    (campaign_id, event_id, signer_user_id, agreement_version, ip, user_agent,
     signature_ref, content_hash, pdf_ref, verified_phone, otp_verified_at,
     approval_request_id, pricing_round_id)
  values
    (_campaign_id, v_campaign.event_id, _signer_user_id, _agreement_version, _ip, _user_agent,
     null, _content_hash, _pdf_ref, null, null,
     _request_id, _pricing_round_id);

  update public.campaigns
     set status = 'approved', tos_version = _agreement_version, approved_at = now(), approved_by = _signer_user_id
   where id = _campaign_id;

  update public.campaign_pricing set locked_at = now() where id = v_pricing.id;
end $$;

-- D22: the one path past a locked price. Reasons: benefit_accepted (ש5/D21) or lapsed_reapproval (D15).
-- Replace order that holds the one-current-row partial unique index at every statement: mark the old row first
-- (its superseded_by FK is deferrable, checked at commit), then insert the successor with the pre-allocated id.
create or replace function public.supersede_campaign_pricing(
  _campaign_id uuid,
  _reason text,
  _list_price numeric,
  _discount_amount numeric,
  _assignment_id uuid default null,
  _actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     public.campaign_pricing%rowtype;
  v_new_id  uuid := gen_random_uuid();
begin
  if _reason not in ('benefit_accepted', 'lapsed_reapproval') then
    raise exception 'supersede: unknown reason %', _reason;
  end if;

  perform 1 from public.campaigns where id = _campaign_id for update;
  if not found then raise exception 'supersede: campaign not found'; end if;

  select * into v_old from public.campaign_pricing
   where campaign_id = _campaign_id and superseded_at is null for update;
  if not found then raise exception 'supersede: no current pricing row'; end if;
  if v_old.locked_at is null then raise exception 'supersede: the current row is not locked (edit it in place)'; end if;

  if public.campaign_has_payment_activity(_campaign_id) then
    raise exception 'supersede: the campaign has money movement';
  end if;

  if _assignment_id is not null then
    perform 1 from public.coupon_assignments where id = _assignment_id for update;
    if not found then raise exception 'supersede: assignment not found'; end if;
  end if;

  update public.campaign_pricing
     set superseded_at = now(), superseded_by = v_new_id
   where id = v_old.id;

  insert into public.campaign_pricing (id, campaign_id, list_price, discount_amount, package_price, coupon_assignment_id)
  values (v_new_id, _campaign_id, _list_price, _discount_amount, _list_price - _discount_amount, _assignment_id);

  -- The consent reset (ש5): the campaign awaits a fresh approval of the new terms. The stored agreement of the old
  -- round stays archived untouched.
  update public.campaigns
     set status = 'pending_approval', tos_version = null, approved_at = null, approved_by = null
   where id = _campaign_id;

  if _assignment_id is not null then
    insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
      values (_assignment_id, 'supersede_opened', _actor_user_id, _reason);
  end if;
  return v_new_id;
end $$;

revoke all on function public.bind_coupon_assignment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_coupon_assignment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.approve_package_terms(uuid, uuid, uuid, integer, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.supersede_campaign_pricing(uuid, text, numeric, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.bind_coupon_assignment(uuid, uuid, uuid) to service_role;
grant execute on function public.release_coupon_assignment(uuid, text, uuid) to service_role;
grant execute on function public.approve_package_terms(uuid, uuid, uuid, integer, uuid, text, text, text, text, text) to service_role;
grant execute on function public.supersede_campaign_pricing(uuid, text, numeric, numeric, uuid, uuid) to service_role;

-- ── 5. The open-payment guard (D22) ─────────────────────────────────────────

-- Realizes the design's open_package_payment where it cannot be bypassed: any payment_operations INSERT that names a
-- pricing round is validated in the same transaction that records the pending payment. The campaign row lock makes an
-- open and a supersede serialize, so a session can never open on a superseded price.
-- SECURITY DEFINER (the June campaigns_guard_cancel precedent): the firing statement may run as a client role with
-- no grants on the tables this trigger touches; the gate must hold for every writer.
create or replace function public.payment_operations_open_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round  public.campaign_pricing%rowtype;
  v_asg    public.coupon_assignments%rowtype;
begin
  if new.pricing_round_id is null then return new; end if;

  perform 1 from public.campaigns where id = new.campaign_id for update;

  select * into v_round from public.campaign_pricing where id = new.pricing_round_id;
  if not found then raise exception 'open: pricing round not found'; end if;
  if v_round.campaign_id is distinct from new.campaign_id then
    raise exception 'open: the round belongs to another campaign';
  end if;
  if v_round.superseded_at is not null then raise exception 'open: the round is superseded'; end if;
  if v_round.locked_at is null then raise exception 'open: the price is not locked'; end if;
  if new.amount is distinct from v_round.package_price then
    raise exception 'open: amount % differs from the locked price %', new.amount, v_round.package_price;
  end if;

  if v_round.coupon_assignment_id is not null then
    select * into v_asg from public.coupon_assignments where id = v_round.coupon_assignment_id for update;
    if v_asg.state <> 'bound' or v_asg.bound_campaign_id is distinct from new.campaign_id then
      raise exception 'open: the benefit is no longer bound to this campaign';
    end if;
    if v_asg.expires_at <= now() then
      raise exception 'open: the benefit expired before the session opened';
    end if;
  end if;
  return new;
end $$;

create trigger payment_operations_open_guard
  before insert on public.payment_operations
  for each row execute function public.payment_operations_open_guard();

-- ── 6. Phase 1 of D8 ────────────────────────────────────────────────────────

-- campaigns.package_price stays the source of truth until phase 2: writing it upserts the pricing row.
-- Refused when the pricing row is locked or carries an assignment — old code must not overwrite a guarded price.
-- SECURITY DEFINER (the June campaigns_guard_cancel precedent): the firing statement may run as a client role with
-- no grants on the tables this trigger touches; the gate must hold for every writer.
create or replace function public.campaigns_pricing_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pricing public.campaign_pricing%rowtype;
begin
  if new.package_price is null then return new; end if;
  if tg_op = 'UPDATE' and new.package_price is not distinct from old.package_price then return new; end if;

  select * into v_pricing from public.campaign_pricing
   where campaign_id = new.id and superseded_at is null for update;
  if not found then
    insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price)
    values (new.id, new.package_price, 0, new.package_price);
    return new;
  end if;
  if v_pricing.locked_at is not null then
    raise exception 'package_price: the campaign price is locked';
  end if;
  if v_pricing.coupon_assignment_id is not null then
    raise exception 'package_price: the campaign price carries a benefit';
  end if;
  update public.campaign_pricing
     set list_price = new.package_price, package_price = new.package_price, discount_amount = 0
   where id = v_pricing.id;
  return new;
end $$;

create trigger campaigns_pricing_sync
  after insert or update of package_price on public.campaigns
  for each row execute function public.campaigns_pricing_sync();

-- An approval by the OLD code path locks the price in the same transaction (D8 phase 1).
-- SECURITY DEFINER (the June campaigns_guard_cancel precedent): the firing statement may run as a client role with
-- no grants on the tables this trigger touches; the gate must hold for every writer.
create or replace function public.campaigns_pricing_lock_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.campaign_pricing
     set locked_at = coalesce(new.approved_at, now())
   where campaign_id = new.id and superseded_at is null and locked_at is null;
  return new;
end $$;

create trigger campaigns_pricing_lock_on_approval
  after update of status on public.campaigns
  for each row
  when (new.status = 'approved' and old.status is distinct from new.status)
  execute function public.campaigns_pricing_lock_on_approval();

-- The initial copy: every campaign that has a price gets its pricing row; a campaign that was EVER approved
-- (approved_at set, or a signed_agreements row exists) is locked at its approval time, whatever its status now.
insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price, locked_at)
select c.id, c.package_price, 0, c.package_price,
       case
         when c.approved_at is not null then c.approved_at
         when sa.first_signed is not null then sa.first_signed
         else null
       end
  from public.campaigns c
  left join lateral (
    select min(signed_at) as first_signed from public.signed_agreements s where s.campaign_id = c.id
  ) sa on true
 where c.package_price is not null;

-- ── SELF-CHECK (task 1.3's equality + lock facts, re-measured) ──────────────

do $$
declare v integer;
begin
  -- Every priced campaign has exactly one current pricing row holding the same number.
  select count(*) into v
    from public.campaigns c
   where c.package_price is not null
     and not exists (
       select 1 from public.campaign_pricing p
        where p.campaign_id = c.id and p.superseded_at is null and p.package_price = c.package_price);
  if v <> 0 then raise exception 'phase-1 copy: % campaign(s) without an equal current pricing row', v; end if;

  -- No campaign ever approved is left unlocked.
  select count(*) into v
    from public.campaigns c
    join public.campaign_pricing p on p.campaign_id = c.id and p.superseded_at is null
   where (c.approved_at is not null or exists (select 1 from public.signed_agreements s where s.campaign_id = c.id))
     and p.locked_at is null;
  if v <> 0 then raise exception 'phase-1 copy: % ever-approved campaign(s) unlocked', v; end if;
end $$;

-- Trigger functions are not callable directly (house hygiene, the June precedent).
revoke all on function public.campaign_pricing_guard() from public, anon, authenticated;
revoke all on function public.campaign_pricing_version_bump() from public, anon, authenticated;
revoke all on function public.payment_operations_open_guard() from public, anon, authenticated;
revoke all on function public.campaigns_pricing_sync() from public, anon, authenticated;
revoke all on function public.campaigns_pricing_lock_on_approval() from public, anon, authenticated;
