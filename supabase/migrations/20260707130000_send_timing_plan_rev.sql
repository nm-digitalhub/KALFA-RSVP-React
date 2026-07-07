begin;

-- Send-timing consistency hardening — plan-revision identity per contact.
-- See docs/send-timing-hardening-blueprint-2026-07-07.md §11.3 (schema) + §11.6
-- (record_step_plan compare-and-set RPC). Fingerprint-primary design: no dormant
-- counters (campaigns.plan_revision / app_settings.send_policy_revision are
-- DELIBERATELY NOT added — §11.3 — until a real, atomic, tested writer exists).
-- planned_at already exists (20260707120000_whatsapp_send_timing.sql).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Per-contact plan identity: which step + plan the CURRENTLY-queued job was
--    built under. Lets the worker detect a stale queued job atomically (§11.6).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.outreach_state
  add column if not exists planned_step_index integer,
  add column if not exists plan_rev           text;

comment on column public.outreach_state.planned_step_index is
  'Step index the currently-queued send job was planned for (send-timing plan identity).';
comment on column public.outreach_state.plan_rev is
  'planRev fingerprint (SHA-256 hex of algorithm version + event-date + touchpoint + normalized policy) the queued job for planned_step_index was built under.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) record_step_plan — atomic compare-and-set of the plan identity (§11.6).
--    Same discipline as claim_first_admin / cancel_campaign: SECURITY DEFINER,
--    SET search_path = '', fully public.-qualified, service_role EXECUTE only.
--
--    Predicate: campaign_id, contact_id, status='active',
--    current_step_index = p_expected_step, plan_rev IS NOT DISTINCT FROM
--    p_expected_plan_rev. On match, SET plan_rev = p_next_plan_rev. The
--    expected-vs-next split lets a NEW plan REPLACE an OLD one without the guard
--    blocking it (expected = what-we-read, next = new); IS NOT DISTINCT FROM
--    makes a NULL prior plan_rev match a NULL expectation (first planning).
--
--    Returns: 'recorded' (updated) | 'stale' (row exists but step/plan/status
--    moved under us — NOT an error, caller must NOT overwrite) | 'missing' (no
--    row for (campaign,contact) at all). Body errors surface as exceptions.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_step_plan(
  p_campaign        uuid,
  p_contact         uuid,
  p_expected_step   integer,
  p_expected_plan_rev text,
  p_next_plan_rev   text,
  p_planned_at      timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
begin
  update public.outreach_state
     set planned_step_index = p_expected_step,
         plan_rev           = p_next_plan_rev,
         planned_at         = p_planned_at
   where campaign_id = p_campaign
     and contact_id  = p_contact
     and status = 'active'
     and current_step_index = p_expected_step
     and plan_rev is not distinct from p_expected_plan_rev;
  if found then
    return 'recorded';
  end if;
  -- No row was updated: distinguish a moved/consumed cursor (stale) from a row
  -- that never existed (missing). Any existing (campaign,contact) row — even
  -- non-active or at a different step/plan — is 'stale', not 'missing'.
  if exists (
    select 1 from public.outreach_state
    where campaign_id = p_campaign and contact_id = p_contact
  ) then
    return 'stale';
  end if;
  return 'missing';
end; $$;

revoke all on function public.record_step_plan(uuid, uuid, integer, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_step_plan(uuid, uuid, integer, text, text, timestamptz)
  to service_role;

commit;
