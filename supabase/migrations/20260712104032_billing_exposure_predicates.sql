-- P0-1 (A1): two SEPARATE exposure predicates. exposed_for_billing = narrow
-- channel-aware BILLING gate; has_service_exposure = broad PIN decision.

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
