-- Billing back-half — Phase 1: make the money loop runnable (spec §1.1).
--
-- Additive + idempotent. Three concerns:
--   a. app_settings gates (fail-closed: outreach/close-charge OFF by default) +
--      WhatsApp Cloud API config (secrets stay server-side; NEXT_PUBLIC never).
--   b. contacts.whatsapp_consent_at — channel-specific marketing consent timestamp.
--   c. The two billing RPCs the data layer already CALLS but that exist in NO
--      migration on any ref (the "pending migration" comments were never realized):
--        - try_record_billed_result: cap + window + dedup in ONE locked txn —
--          the SINGLE billing entry point that enforces the cross-channel
--          UNIQUE(event_id,contact_id) dedup invariant (§0.x / §13).
--        - campaign_billing_summary: exact accrued = Σ locked_price.
--
-- All identifiers below were verified against the LIVE schema before authoring
-- (campaign_channel enum; campaigns.status::campaign_status / price_per_reached /
-- max_contacts / start_at / close_at / max_charge_ceiling; billed_results cols +
-- UNIQUE constraint billed_results_event_contact_unique(event_id,contact_id);
-- contacts.removal_requested; service_role). DO NOT APPLY here — apply is
-- approval-gated and performed by the lead.

-- ── a. app_settings flags + WhatsApp config (gates fail-closed by default) ──────
alter table public.app_settings
  add column if not exists outreach_enabled boolean not null default false;
alter table public.app_settings
  add column if not exists close_charge_enabled boolean not null default false;
alter table public.app_settings
  add column if not exists whatsapp_phone_number_id text;
alter table public.app_settings
  add column if not exists whatsapp_access_token text;   -- secret
alter table public.app_settings
  add column if not exists whatsapp_app_secret text;     -- secret (HMAC verify)
alter table public.app_settings
  add column if not exists whatsapp_verify_token text;   -- webhook verify

-- ── b. contacts consent ────────────────────────────────────────────────────────
alter table public.contacts
  add column if not exists whatsapp_consent_at timestamptz;

-- ── c. RPC try_record_billed_result ────────────────────────────────────────────
-- SECURITY DEFINER; cap + window + dedup in ONE locked transaction.
-- Outcome enum: billed | already_billed | ceiling_reached | not_active |
--               before_window | closed_window | removal_requested | no_campaign.
create or replace function public.try_record_billed_result(
  p_event uuid, p_campaign uuid, p_contact uuid, p_channel campaign_channel,
  p_attempt text, p_evidence text, p_provider_ref text
) returns text language plpgsql security definer set search_path=public as $$
declare v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz; v_count int; v_removed boolean;
begin
  select status::text, price_per_reached, max_contacts, start_at, close_at
    into v_status, v_price, v_max, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_max then return 'ceiling_reached'; end if;
  -- Phase 2 hook: AND p_contact in (select contact_id from campaign_authorized_contacts where campaign_id=p_campaign)
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (p_event,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $$;

-- ── d. RPC campaign_billing_summary ────────────────────────────────────────────
-- Exact accrued = Σ locked_price across ALL billed_results (no control_status
-- filter — intentional for Phase 1; voids/adjustments revisited in §16).
create or replace function public.campaign_billing_summary(p_campaign uuid)
returns table(reached_count int, accrued numeric, ceiling numeric, max_contacts int)
language sql security definer set search_path=public as $$
  select count(b.*)::int, coalesce(sum(b.locked_price),0), c.max_charge_ceiling, c.max_contacts
  from campaigns c left join billed_results b on b.campaign_id=c.id
  where c.id=p_campaign group by c.id;
$$;

grant execute on function public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text) to service_role;
grant execute on function public.campaign_billing_summary(uuid) to service_role;
