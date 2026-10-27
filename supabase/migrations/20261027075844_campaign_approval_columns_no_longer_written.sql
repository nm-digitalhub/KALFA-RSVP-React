-- Stop writing the campaign approval columns (campaigns.tos_version, approved_at, approved_by), so they can be dropped.
--
-- The approval of a package campaign's terms is recorded in full in public.signed_agreements (signer_user_id,
-- agreement_version, signed_at, content_hash, pdf_ref, pricing_round_id), and the lock of the approved price is
-- public.campaign_pricing.locked_at. The three campaigns columns were a third copy: approve_package_terms copied the
-- same version and signer into them, and supersede_campaign_pricing cleared them. No application code reads them
-- (measured 27.10.2026: the last reader, CAMPAIGN_COLUMNS, and the dead approveCampaign writer were removed in the same
-- change), and no view, index, constraint, policy or trigger depends on them (pg_depend, live, 27.10.2026).
--
-- What changes, and only this:
--   - approve_package_terms: the final UPDATE sets status only.
--   - supersede_campaign_pricing: the consent reset sets status only. The new pricing round starts unlocked
--     (locked_at IS NULL), which is what says the new terms are not approved yet; the old round's agreement stays in
--     signed_agreements untouched.
--   - campaigns_pricing_lock_on_approval: locks at now() instead of coalesce(new.approved_at, now()). On the normal path
--     approve_package_terms locks the round before its UPDATE, so the trigger finds nothing to lock there.
-- Each body is otherwise the live definition read 27.10.2026 (pg_get_functiondef), identical to its latest migration.
-- CREATE OR REPLACE keeps each function's owner and grants; SECURITY DEFINER and search_path '' are restated.
--
-- The columns themselves are dropped by a later migration, after the application code that no longer selects them is
-- deployed (the deployed build still names tos_version and approved_at in its campaign select).
--
-- ROLLBACK: re-apply approve_package_terms from 20261012021203_phase2_pricing_mirror_and_create.sql, and
-- supersede_campaign_pricing and campaigns_pricing_lock_on_approval from 20261011232647_coupons_operations_and_phase1.sql
-- (each verified identical to the live body, whitespace-normalized, 27.10.2026).

CREATE OR REPLACE FUNCTION public.approve_package_terms(_request_id uuid, _campaign_id uuid, _pricing_round_id uuid, _expected_version integer, _signer_user_id uuid, _agreement_version text, _content_hash text, _pdf_ref text, _ip text DEFAULT NULL::text, _user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Who approved which version, and when, is the signed_agreements row above; the campaign carries only its status.
  update public.campaigns
     set status = 'approved'
   where id = _campaign_id;
end $function$;

CREATE OR REPLACE FUNCTION public.supersede_campaign_pricing(_campaign_id uuid, _reason text, _list_price numeric, _discount_amount numeric, _assignment_id uuid DEFAULT NULL::uuid, _actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- The consent reset (ש5): the campaign awaits a fresh approval of the new terms. The new round above is unlocked
  -- until that approval; the stored agreement of the old round stays archived untouched.
  update public.campaigns
     set status = 'pending_approval'
   where id = _campaign_id;

  if _assignment_id is not null then
    insert into public.coupon_assignment_events (assignment_id, action, actor_user_id, reason)
      values (_assignment_id, 'supersede_opened', _actor_user_id, _reason);
  end if;
  return v_new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.campaigns_pricing_lock_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.campaign_pricing
     set locked_at = now()
   where campaign_id = new.id and superseded_at is null and locked_at is null;
  return new;
end $function$;
