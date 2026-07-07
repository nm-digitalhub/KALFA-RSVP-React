begin;

-- §12 FINAL (M1 minimal) — Option A serial-flow send-timing hardening.
-- outreach_state gains a 2-field execution RESERVATION + two integrity CHECKs,
-- and four SECURITY INVOKER RPCs (service_role-only) implement the cursor-first
-- reserve → send → resolve protocol with a plan-anchor CAS. outreach_state is
-- EMPTY (0 rows verified 2026-07-07) so the CHECKs add cleanly, no backfill.
-- See docs/send-timing-hardening-blueprint-2026-07-07.md  "12 FINAL — M1 MINIMAL".
--
-- Removed vs the exploratory design: run_revision (M2/M3), set_outreach_enabled,
-- rearm_*, dead-letter business recovery — pause/resume rides the id-less poll
-- (resume enqueues via deferId, sidestepping the terminal detId).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Reservation fields. dispatched_step_index is intentionally OMITTED — the
--    reserved step is always current_step_index (enforced by the anchor CHECK).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.outreach_state
  add column if not exists dispatched_job_id uuid,
  add column if not exists dispatched_at     timestamptz;

comment on column public.outreach_state.dispatched_job_id is
  'pg-boss execution job id holding the in-flight send reservation for the cursor step (null = idle).';
comment on column public.outreach_state.dispatched_at is
  'When the current reservation was taken (audit only; NEVER a recovery trigger).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Integrity: reservation all-or-none; plan-anchor all-or-none AND = cursor.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.outreach_state
  add constraint outreach_state_reservation_ck check (
    (dispatched_job_id is null and dispatched_at is null)
    or (dispatched_job_id is not null and dispatched_at is not null)
  );
alter table public.outreach_state
  add constraint outreach_state_anchor_ck check (
    (planned_at is null and planned_step_index is null and plan_rev is null)
    or (planned_at is not null and planned_step_index is not null and plan_rev is not null
        and planned_step_index = current_step_index)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) record_step_plan — re-created FORWARD (7-arg: expected/next plan_rev AND
--    planned_at + dispatched_job_id guard). Drops the old 6-arg version
--    (20260707130000/140000); nothing deployed calls it yet.
--    CAS on BOTH plan_rev and planned_at: a defer/re-eval can change targetSlot
--    under the SAME planRev, so planned_at must be in the predicate.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.record_step_plan(uuid, uuid, integer, text, text, timestamptz);

create or replace function public.record_step_plan(
  p_campaign            uuid,
  p_contact             uuid,
  p_expected_step       integer,
  p_expected_plan_rev   text,
  p_expected_planned_at timestamptz,
  p_next_plan_rev       text,
  p_next_planned_at     timestamptz
) returns text language plpgsql security invoker set search_path = '' as $$
begin
  update public.outreach_state
     set planned_step_index = p_expected_step,
         plan_rev           = p_next_plan_rev,
         planned_at         = p_next_planned_at
   where campaign_id = p_campaign
     and contact_id  = p_contact
     and status = 'active'
     and current_step_index = p_expected_step
     and plan_rev   is not distinct from p_expected_plan_rev
     and planned_at is not distinct from p_expected_planned_at
     and dispatched_job_id is null;
  if found then return 'recorded'; end if;
  if exists (select 1 from public.outreach_state
             where campaign_id = p_campaign and contact_id = p_contact) then
    return 'stale';
  end if;
  return 'missing';
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) reserve_outreach_step — take the send reservation for the cursor step.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reserve_outreach_step(
  p_campaign uuid, p_contact uuid, p_step integer,
  p_expected_plan_rev text, p_expected_planned_at timestamptz, p_job_id uuid
) returns text language plpgsql security invoker set search_path = '' as $$
begin
  update public.outreach_state
     set dispatched_job_id = p_job_id,
         dispatched_at      = now()
   where campaign_id = p_campaign
     and contact_id  = p_contact
     and status = 'active'
     and current_step_index = p_step
     and planned_step_index = p_step
     and plan_rev   is not distinct from p_expected_plan_rev
     and planned_at is not distinct from p_expected_planned_at
     and dispatched_job_id is null;
  if found then return 'reserved'; end if;
  return 'stale';
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) release_outreach_reservation — definite-failure retry: clear reservation.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.release_outreach_reservation(
  p_campaign uuid, p_contact uuid, p_step integer,
  p_expected_plan_rev text, p_job_id uuid
) returns text language plpgsql security invoker set search_path = '' as $$
begin
  update public.outreach_state
     set dispatched_job_id = null, dispatched_at = null
   where campaign_id = p_campaign
     and contact_id  = p_contact
     and current_step_index = p_step
     and planned_step_index = p_step
     and plan_rev is not distinct from p_expected_plan_rev
     and dispatched_job_id = p_job_id;
  if found then return 'released'; end if;
  return 'stale';
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) resolve_outreach_step — ONE txn: idempotent audit + advance/terminal +
--    clear anchor & reservation. p_advance=true → cursor+1; false → terminal.
--    p_job_id null = a non-reserved skip (superseded/missed/expired); non-null =
--    a send-path resolve guarded to the reserving job.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.resolve_outreach_step(
  p_campaign uuid, p_contact uuid, p_step integer, p_expected_plan_rev text,
  p_job_id uuid, p_advance boolean, p_terminal_status text,
  p_reason text, p_event_id uuid, p_audit_id uuid
) returns text language plpgsql security invoker set search_path = '' as $$
declare _n integer;
begin
  update public.outreach_state
     set current_step_index = case when p_advance then p_step + 1 else current_step_index end,
         status             = case when p_advance then status else coalesce(p_terminal_status, status) end,
         stop_reason        = case when p_advance then stop_reason else p_reason end,
         planned_step_index = null, plan_rev = null, planned_at = null,
         dispatched_job_id  = null, dispatched_at = null
   where campaign_id = p_campaign
     and contact_id  = p_contact
     and current_step_index = p_step
     and planned_step_index = p_step
     and plan_rev is not distinct from p_expected_plan_rev
     and ( (p_job_id is null and dispatched_job_id is null)
        or (p_job_id is not null and dispatched_job_id = p_job_id) );
  get diagnostics _n = row_count;
  if _n = 0 then return 'stale'; end if;
  -- idempotent audit: activity_log PK on id makes a re-invoke a no-op.
  insert into public.activity_log (id, event_id, user_id, action, meta)
  values (
    p_audit_id, p_event_id, null, 'outreach.step_resolved',
    jsonb_build_object('campaign_id', p_campaign, 'contact_id', p_contact,
                       'step_index', p_step, 'reason', p_reason, 'advanced', p_advance)
  )
  on conflict (id) do nothing;
  return 'resolved';
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Lock down EXECUTE: service_role only (worker uses createAdminClient()).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare sig text;
begin
  for sig in
    select format('public.%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('record_step_plan','reserve_outreach_step',
                         'release_outreach_reservation','resolve_outreach_step')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

commit;
