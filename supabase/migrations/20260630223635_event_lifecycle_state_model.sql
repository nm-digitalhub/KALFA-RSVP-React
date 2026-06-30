-- Event Lifecycle State Model — R1–R9 + R2b.
-- Plan: plans/event-lifecycle-state-model-plan.md, Phase S1 / Task S1.1.
-- Spec: plans/event-lifecycle-state-model-spec.md.
--
-- Supersedes ONLY the two L0a triggers (events_reject_past_event_date_insert /
-- events_reject_past_event_date_update) + function
-- public.events_reject_past_event_date(). The CHECK
-- events_rsvp_deadline_within_event and trigger trg_events_updated (set_updated_at)
-- are NEVER touched by this migration — R2b is purely additive (round-2
-- architectural correction; it does NOT supersede, drop, or modify the CHECK).
--
-- Fail-safe ordering (round-2 B3 — do NOT rely on an assumed `db push`
-- transaction wrapper; no explicit begin/commit): the NEW functions+triggers are
-- created FIRST, while L0a stays active in parallel — both fire; the new rules
-- are a strict superset of L0a, so coexistence is harmless — and L0a is dropped
-- only AFTER the new triggers exist. A mid-migration failure therefore never
-- leaves a gap: before step 3 → L0a still guards; after step 3a → L0a+new both
-- guard until the drop succeeds.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — R1 + R2 + R2b BEFORE INSERT on events (force draft + date ≥ tomorrow
-- + deadline lower bound ONLY — the CHECK still covers requires-date + upper bound)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.events_before_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare today_il date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  new.status := 'draft';  -- R1
  if new.event_date is not null
     and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
    raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';  -- R2
  end if;
  -- R2b: LOWER BOUND ONLY. The CHECK events_rsvp_deadline_within_event (existing,
  -- UNCHANGED, untouched by this migration) already enforces "rsvp_deadline
  -- requires event_date" + "rsvp_deadline <= event_day_IL" unconditionally on
  -- every row — this trigger must NOT duplicate that, it adds only the one
  -- now()-dependent piece a CHECK cannot express.
  if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
    raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
  end if;
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — R3 + R5 + R6 + R7 + R2b BEFORE UPDATE on events (status machine +
-- locks + deadline re-check)
-- ─────────────────────────────────────────────────────────────────────────────
-- B1: SECURITY DEFINER so the R7 cross-table read of public.campaigns is
-- independent of the WRITER's RLS (authoritative by construction, not by RLS
-- coincidence). No privileged write in the body; OLD/NEW come from the trigger.
create or replace function public.events_guard_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare blocking int; today_il date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if new.status is distinct from old.status then  -- a real transition
    if not ( (old.status='draft' and new.status in ('active','closed'))
          or (old.status='active' and new.status='closed') ) then
      raise exception 'illegal event status transition % -> %', old.status, new.status using errcode='check_violation';  -- R6
    end if;
    if old.status='draft' and new.status='active' then  -- R3
      if new.event_date is null
         or (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
        raise exception 'cannot publish: event_date must be set and >= tomorrow' using errcode='check_violation';
      end if;
      if new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
        raise exception 'publish must not change event_date/rsvp_deadline (save dates first)' using errcode='check_violation';
      end if;
      -- R2b RE-CHECK at publish time: the date values are unchanged (checked
      -- above), but `today_il` has moved forward since the deadline was saved
      -- while draft — a deadline valid then can be stale now. Upper bound need
      -- not be re-checked (event_date is unchanged too, so it still holds).
      if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
        raise exception 'rsvp_deadline has elapsed — set a new deadline before publishing' using errcode='check_violation';
      end if;
    end if;
    if new.status='closed' then  -- R7 (campaign.status only)
      select count(*) into blocking from public.campaigns c where c.event_id=new.id
        and c.status in ('draft','pending_approval','approved','scheduled','active','paused');
      if blocking>0 then raise exception 'cannot close event: % operational campaign(s)', blocking using errcode='check_violation'; end if;
    end if;
  end if;
  if old.status<>'draft' then  -- R5 lock
    if new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
      raise exception 'event_date/rsvp_deadline are locked once the event leaves draft' using errcode='check_violation';
    end if;
  elsif new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
    -- draft edit touching EITHER date: re-validate R2 (event_date) + R2b
    -- (deadline LOWER BOUND ONLY — the CHECK events_rsvp_deadline_within_event,
    -- existing and UNCHANGED, already covers "requires event_date" +
    -- "<= event_day_IL" unconditionally on every row; do not duplicate it here).
    -- Broadened from event_date-only so editing JUST the deadline (the common
    -- case) is re-validated too — the original draft only fired on event_date.
    if new.event_date is distinct from old.event_date  -- R2
       and new.event_date is not null
       and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
      raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
    end if;
    if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then  -- R2b
      raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — wire the events triggers + drop L0a (the CHECK is NOT touched)
-- ─────────────────────────────────────────────────────────────────────────────
-- (a) create the NEW guards FIRST — L0a is still active → double protection, no gap:
create trigger events_before_insert before insert on public.events for each row execute function public.events_before_insert();
create trigger events_guard_update before update on public.events for each row execute function public.events_guard_update();
-- (b) ONLY AFTER the new guards exist, drop the L0a triggers + function:
drop trigger if exists events_reject_past_event_date_insert on public.events;
drop trigger if exists events_reject_past_event_date_update on public.events;
drop function if exists public.events_reject_past_event_date();
-- (no step (c) — events_rsvp_deadline_within_event is never dropped; round-2 correction)

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4 — R9 BEFORE INSERT/UPDATE on campaigns (operational states require
-- active event)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.campaigns_require_active_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ev public.event_status;
begin
  if new.status in ('pending_approval','approved','scheduled','active','paused') then
    select status into ev from public.events where id=new.event_id;
    if ev is distinct from 'active' then
      raise exception 'campaign requires event.status = active (got %)', ev using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists campaigns_require_active_event on public.campaigns;
create trigger campaigns_require_active_event before insert or update on public.campaigns for each row
  execute function public.campaigns_require_active_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5 — R8 →cancelled guard trigger + cancel_campaign RPC (null-safe
-- predicate, incl. draft; both SECURITY DEFINER SET search_path='', every table
-- reference public.-qualified — round-2 completion)
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER (not INVOKER) so this trigger is the AUTHORITATIVE gate for
-- ANY direct UPDATE to status='cancelled' — by the RPC, by service_role, or by
-- any future writer — independent of the writer's RLS (mirrors the B1 reasoning
-- for events_guard_update). RPC = the app's path; this trigger = the
-- unconditional backstop that makes the rule true regardless of caller.
create or replace function public.campaigns_guard_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    if not ( old.status in ('draft','pending_approval','approved')
      and old.capture_status is distinct from 'authorized'
      and old.capture_status is distinct from 'pending'
      and old.capture_status is distinct from 'hold_review'
      and old.charge_status is null
      and not exists (select 1 from public.billed_results b where b.campaign_id=new.id) ) then
      raise exception 'campaign cannot be cancelled: financial commitment or wrong state' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists campaigns_guard_cancel on public.campaigns;
create trigger campaigns_guard_cancel before update on public.campaigns for each row execute function public.campaigns_guard_cancel();

create or replace function public.cancel_campaign(p_campaign uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.campaigns;
begin
  select * into v from public.campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v.status='cancelled' then return 'already_cancelled'; end if;
  -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
  -- any other state; this re-check (separate from the trigger above) is what
  -- lets the RPC return a precise outcome instead of a raw constraint error.
  if not ( v.status in ('draft','pending_approval','approved')
    and v.capture_status is distinct from 'authorized'
    and v.capture_status is distinct from 'pending'
    and v.capture_status is distinct from 'hold_review'
    and v.charge_status is null
    and not exists (select 1 from public.billed_results b where b.campaign_id=v.id) ) then
    return 'not_cancellable';
  end if;
  update public.campaigns set status='cancelled' where id=p_campaign;
  return 'cancelled';
end; $$;
revoke all on function public.cancel_campaign(uuid) from public, anon, authenticated;
grant execute on function public.cancel_campaign(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6 — R9 inside try_record_billed_result: CREATE OR REPLACE reproducing the
-- L2 body (supabase/migrations/20260630164747_l2_rpc_event_date_guards_and_billing_integrity.sql)
-- VERBATIM, adding exactly one new check immediately after the existing
-- event_passed block (so a past event keeps its more-specific reason) and
-- before the insert. No other line of this function's body changes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.try_record_billed_result(p_event uuid, p_campaign uuid, p_contact uuid, p_channel public.campaign_channel, p_attempt text, p_evidence text, p_provider_ref text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz;
  v_count int; v_removed boolean; v_event_id uuid; v_event_date timestamptz;
begin
  -- Authoritative event comes from the campaign, not the caller.
  select event_id, status::text, price_per_reached, max_contacts, start_at, close_at
    into v_event_id, v_status, v_price, v_max, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  -- L2: the caller-supplied event must match the campaign's event (defensive;
  -- the insert below uses v_event_id regardless).
  if p_event is distinct from v_event_id then return 'event_mismatch'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  -- L2: never bill for an event whose day has already passed (Israel calendar) —
  -- independent of close_at (NULL-window) and of the L1 stepGate (inbound path).
  select event_date into v_event_date from events where id = v_event_id;
  if v_event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date
           > (v_event_date at time zone 'Asia/Jerusalem')::date then
    return 'event_passed';
  end if;
  -- R9: never bill for a campaign whose event is not active. public.-qualified
  -- (round-2 completion) regardless of the function's own search_path.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;
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
    values (v_event_id,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $function$;
