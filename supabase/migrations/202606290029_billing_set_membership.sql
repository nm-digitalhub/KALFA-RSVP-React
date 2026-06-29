-- Billing back-half — Phase 2: bind billing to the frozen authorized SET (spec §7
-- / plan-paid §7 "המערכת אינה רשאית ליצור יותר חיובים ממספר אנשי הקשר שאושר";
-- billing-controls-complete-plan §שלב-2; verification-corrections §A SAFETY INVARIANT).
--
-- WHY (the money-leak guard): outreach is NOT bounded by max_contacts, while the
-- final charge IS capped at the frozen ceiling. The HOLD (J5 auth) may be lowered
-- to covered×price (< ceiling) for security sizing — but that is SAFE ONLY if
-- `reached` can never exceed the covered/authorized SET. The frozen snapshot
-- (campaign_authorized_contacts, written server-side at the hold step) is that cap.
-- This migration makes SET membership the BINDING cap on the single billing entry
-- point: a contact that is NOT in the frozen set NEVER bills. fail-closed — an
-- empty / unsnapshotted set bills NOBODY (no row → 'not_authorized'), which is the
-- safe direction. reached ⊆ authorized is now enforced in the locked txn, not only
-- at the outreach gate (defense-in-depth).
--
-- This is a CREATE OR REPLACE of try_record_billed_result: every line is identical
-- to 202606290028_billing_backhalf.sql EXCEPT the new membership clause inserted
-- AFTER the removal_requested check and BEFORE the count cap (the existing
-- count < max_contacts guard is kept as a secondary defense). The function still
-- returns text; the documented outcome set GAINS 'not_authorized'.
--
-- Identifiers verified against the LIVE schema before authoring (node scripts/sb-query.mjs):
--   - try_record_billed_result live body == 0028 (pg_get_functiondef);
--   - campaign_authorized_contacts(id,event_id,campaign_id,contact_id,created_at) +
--     UNIQUE(campaign_id,contact_id) exist live (0024 applied);
--   - function params p_campaign / p_contact unchanged.
-- Additive + reversible (replace with the 0028 body to roll back). DO NOT APPLY
-- here — apply is approval-gated and performed by the lead.

-- ── RPC try_record_billed_result (Phase 2: + frozen-SET binding cap) ─────────────
-- SECURITY DEFINER; cap + window + dedup + SET membership in ONE locked transaction.
-- Outcome enum (text): billed | already_billed | ceiling_reached | not_active |
--               before_window | closed_window | removal_requested |
--               not_authorized | no_campaign.
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
  -- Phase 2 BINDING CAP: the frozen authorized SET caps `reached` by construction.
  -- A contact not in the snapshot NEVER bills (fail-closed: empty set → bills nobody).
  if not exists (
    select 1 from public.campaign_authorized_contacts a
    where a.campaign_id=p_campaign and a.contact_id=p_contact
  ) then return 'not_authorized'; end if;
  -- Secondary defense (count cap): set membership already bounds reached at |set|.
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_max then return 'ceiling_reached'; end if;
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (p_event,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $$;

grant execute on function public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text) to service_role;
