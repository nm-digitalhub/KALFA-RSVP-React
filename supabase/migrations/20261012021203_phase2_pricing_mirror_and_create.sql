-- personal-coupons task 2.1 — phase 2 of D8: campaign_pricing becomes the source of truth.
--
-- WHAT CHANGES:
--   1. The phase-1 sync (campaigns.package_price → campaign_pricing) is DROPPED: from this migration on, nothing
--      derives the pricing from the legacy column.
--   2. A MIRROR replaces it in the opposite direction: any insert or update of a CURRENT pricing row copies its
--      final price to campaigns.package_price, so every reader that has not moved yet (task 4.1) keeps seeing the
--      same number. The mirror also runs when a supersede inserts the new current round.
--   3. create_package_campaign — the one writer that creates a campaign WITH its pricing row in a single
--      transaction (createCampaign moves onto it in the same deploy). The campaign row starts with package_price
--      NULL and the mirror fills it in the same transaction, so no reader can observe a priced campaign without a
--      pricing round, ever.
--
-- campaigns_pricing_lock_on_approval STAYS: until task 2.2's deploy the old approveCampaign path still performs
-- approvals, and it must keep locking the price (D8 phase 1's guarantee); after 2.2 it is a harmless no-op (the
-- function locks first and the trigger's `where locked_at is null` matches nothing).
--
-- DEPLOY ORDER: push this migration and deploy the 2.1 code in the same window. Between the push and the deploy,
-- the old createCampaign writes campaigns.package_price directly — covered: the insert happens with no pricing row
-- yet, and the FIRST write through the new path or the phase-1 backstop below creates it. To close even that gap,
-- the sync's INSERT half is kept as a backstop for campaigns created by the OLD code only (a campaign insert that
-- carries package_price and has no pricing row); it never updates an existing row.
--
-- ROLLBACK (phase 2 → phase 1, allowed only while no campaign carries an assignment — D8):
--   drop trigger campaign_pricing_mirror on public.campaign_pricing; drop function public.campaign_pricing_mirror();
--   drop trigger campaigns_pricing_insert_backstop on public.campaigns;
--   re-create campaigns_pricing_sync from 20261011232647.

set local lock_timeout = '5s';

-- ── 1. the phase-1 sync goes ────────────────────────────────────────────────

drop trigger if exists campaigns_pricing_sync on public.campaigns;
drop function if exists public.campaigns_pricing_sync();

-- ── 2. the mirror: pricing → campaigns.package_price ────────────────────────

create or replace function public.campaign_pricing_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.superseded_at is not null then return new; end if;
  update public.campaigns
     set package_price = new.package_price
   where id = new.campaign_id
     and package_price is distinct from new.package_price;
  return new;
end $$;

drop trigger if exists campaign_pricing_mirror on public.campaign_pricing;
create trigger campaign_pricing_mirror
  after insert or update on public.campaign_pricing
  for each row execute function public.campaign_pricing_mirror();

-- ── 2b. backstop for campaigns the OLD code creates during the deploy window ─
-- INSERT only, and only when no pricing row exists; the moment the new code is live this never fires again.

create or replace function public.campaigns_pricing_insert_backstop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.package_price is null then return new; end if;
  if exists (select 1 from public.campaign_pricing where campaign_id = new.id and superseded_at is null) then
    return new;
  end if;
  insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price)
  values (new.id, new.package_price, 0, new.package_price);
  return new;
end $$;

drop trigger if exists campaigns_pricing_insert_backstop on public.campaigns;
create trigger campaigns_pricing_insert_backstop
  after insert on public.campaigns
  for each row execute function public.campaigns_pricing_insert_backstop();

-- ── 3. atomic creation ──────────────────────────────────────────────────────

create or replace function public.create_package_campaign(
  _event_id uuid,
  _template_id uuid,
  _list_price numeric,
  _contact_quota integer,
  _max_contacts integer,
  _allowed_channels public.campaign_channel[],
  _close_at timestamptz,
  _outreach_schedule jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.campaigns
    (event_id, status, template_id, contact_quota, max_contacts, allowed_channels, start_at, close_at, outreach_schedule)
  values
    (_event_id, 'pending_approval', _template_id, _contact_quota, _max_contacts, _allowed_channels, null, _close_at, _outreach_schedule)
  returning id into v_id;

  -- The pricing row IS the price (D2); the mirror fills campaigns.package_price in this same transaction.
  insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price)
  values (v_id, _list_price, 0, _list_price);

  return v_id;
end $$;

revoke all on function public.campaign_pricing_mirror() from public, anon, authenticated;
revoke all on function public.campaigns_pricing_insert_backstop() from public, anon, authenticated;
revoke all on function public.create_package_campaign(uuid, uuid, numeric, integer, integer, public.campaign_channel[], timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.create_package_campaign(uuid, uuid, numeric, integer, integer, public.campaign_channel[], timestamptz, jsonb) to service_role;

-- ── the swap itself: from this moment the pricing row is the truth, so campaigns aligns to IT ──
-- (production: zero rows — the phase-1 sync kept them equal; a replica that ran the concurrency suite may differ.)

update public.campaigns c
   set package_price = p.package_price
  from public.campaign_pricing p
 where p.campaign_id = c.id
   and p.superseded_at is null
   and c.package_price is distinct from p.package_price;

-- ── SELF-CHECK ──────────────────────────────────────────────────────────────

do $$
declare v integer;
begin
  -- The equality of D8 must hold right now: every current pricing row equals its campaign's package_price.
  select count(*) into v
    from public.campaign_pricing p
    join public.campaigns c on c.id = p.campaign_id
   where p.superseded_at is null
     and c.package_price is distinct from p.package_price;
  if v <> 0 then
    raise exception 'phase 2 swap: % campaign(s) whose two price copies differ', v;
  end if;
end $$;

-- ── 4. approve_package_terms: _ip/_user_agent become DEFAULT NULL ───────────
-- They are evidentiary nullables (signed_agreements.ip / user_agent are nullable); the generated client types made
-- them required strings. Postgres requires defaulted parameters to be TRAILING, so the two move to the end — safe:
-- every caller (the server and the concurrency suite) passes arguments BY NAME. The old signature is dropped so no
-- ambiguous overload remains. Body identical to 20261012015957 (the lock-order fix).

drop function if exists public.approve_package_terms(uuid, uuid, uuid, integer, uuid, text, text, text, text, text);

create or replace function public.approve_package_terms(
  _request_id uuid,
  _campaign_id uuid,
  _pricing_round_id uuid,
  _expected_version integer,
  _signer_user_id uuid,
  _agreement_version text,
      _content_hash text,
  _pdf_ref text,
  -- evidentiary nullables, trailing so they may default (Postgres requires trailing defaults)
  _ip text default null,
  _user_agent text default null
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

  -- Lock FIRST: the campaigns update below fires campaigns_pricing_lock_on_approval (phase 1), and an explicit
  -- lock after it would hit an already-locked row (caught by the concurrency suite, 12.10.2026).
  update public.campaign_pricing set locked_at = now() where id = v_pricing.id;

  update public.campaigns
     set status = 'approved', tos_version = _agreement_version, approved_at = now(), approved_by = _signer_user_id
   where id = _campaign_id;
end $$;

revoke all on function public.approve_package_terms(uuid, uuid, uuid, integer, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.approve_package_terms(uuid, uuid, uuid, integer, uuid, text, text, text, text, text) to service_role;
