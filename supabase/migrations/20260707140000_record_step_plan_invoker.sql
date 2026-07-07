begin;

-- record_step_plan: switch SECURITY DEFINER -> SECURITY INVOKER.
--
-- 20260707130000 created this function as SECURITY DEFINER. Its ONLY caller is
-- the outreach worker via createAdminClient() (service_role), which already has
-- full table access, so DEFINER's privilege elevation is unnecessary — Supabase
-- best practice prefers SECURITY INVOKER. The body stays fully public.-qualified
-- with an empty search_path, and EXECUTE remains service_role-only (revoked from
-- public / anon / authenticated), so an INVOKER run by service_role has exactly
-- the access it needs and nothing anonymous can call it.
--
-- This is a NEW forward migration, NOT an edit of 20260707130000: that DEFINER
-- version was already applied to the live database, so the local history must
-- keep reflecting what actually happened (create-as-DEFINER, then alter-to-
-- INVOKER). Rewriting the old file would desync history from reality.
create or replace function public.record_step_plan(
  p_campaign          uuid,
  p_contact           uuid,
  p_expected_step     integer,
  p_expected_plan_rev text,
  p_next_plan_rev     text,
  p_planned_at        timestamptz
) returns text language plpgsql security invoker set search_path = '' as $$
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
  -- No row updated: distinguish a moved/consumed cursor (stale) from a row that
  -- never existed (missing). Any existing (campaign,contact) row — even
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
