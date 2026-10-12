-- personal-coupons task 1.2 — a real bug the concurrency suite caught on the local replica (12.10.2026):
-- approve_package_terms updated campaigns BEFORE setting locked_at; the phase-1 approval-lock trigger
-- (campaigns_pricing_lock_on_approval) fires on that update and locks the pricing row first, so the function's own
-- explicit lock then hit "a locked row cannot change" and the whole approval failed. Nothing on production ever
-- called the function yet (task 2.2 is still open), so no live approval was affected. The fix is pure reordering:
-- lock the pricing row first; the trigger's `where locked_at is null` then no-ops.

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

  -- Lock FIRST: the campaigns update below fires campaigns_pricing_lock_on_approval (phase 1), and an explicit
  -- lock after it would hit an already-locked row (caught by the concurrency suite, 12.10.2026).
  update public.campaign_pricing set locked_at = now() where id = v_pricing.id;

  update public.campaigns
     set status = 'approved', tos_version = _agreement_version, approved_at = now(), approved_by = _signer_user_id
   where id = _campaign_id;
end $$;
