-- Lock an event's date/time by the FIRST SEND, not by leaving draft.
--
-- Owner decision 2026-09-30 (docs/superpowers/plans/2026-09-30-setup-wizard-flow.md §7a):
-- event_date and rsvp_deadline stay editable by the owner until the first
-- message or call has gone out to a guest, and are locked from then on.
-- Until now R5 locked them the moment the event left draft (old.status <> 'draft'),
-- i.e. at "אישור פרטי האירוע", long before anything reached a guest — so a typo in
-- the time needed staff.
--
-- WHAT COUNTS AS "A SEND" — measured against the live database and the code
-- (2026-09-30):
--   public.contact_interactions with direction = 'out' and this event_id.
--   It is the ONLY place an outbound is recorded: outreach.ts inserts a row for
--   every WhatsApp template the provider ACCEPTED (invite, reminders, thank-you),
--   and outreach-calls.ts inserts `call_dialed` once a call is confirmed started.
--   Not used: outreach_state.dispatched_at (NULL on 41 of 41 live rows) and
--   outreach_state.whatsapp_sent_count (misses one of the two live events that
--   have a send); call_attempts can hold rows for calls that never dialed.
--
-- WHAT DOES NOT CHANGE
--   * A CLOSED event stays locked (as before: old.status <> 'draft').
--   * The staff door — admin_reschedule_event via app.event_reschedule — is
--     untouched, including its own R2 check. Staff can still move a locked event.
--   * R2 (date at least tomorrow, Asia/Jerusalem) and R2b (deadline not in the
--     past) now also apply to an owner's edit of an UNSENT active event, exactly
--     as they do for a draft. The CHECK events_rsvp_deadline_within_event is
--     unchanged and still rejects a deadline after the event day.
--   * Everything that follows a date change already exists and is unchanged:
--     trg_sync_campaign_window_from_event moves campaigns.close_at (and the
--     default thankyou_send_at); the outreach engine re-plans from the event's
--     Israel calendar day (plan_rev), and a time-of-day change alone does not
--     alter any send time.
--
-- KNOWN, ACCEPTED RACE: the check reads committed rows (READ COMMITTED). A send
-- the provider accepted but whose contact_interactions row is not yet committed
-- is not seen, so an edit landing in that few-millisecond gap succeeds. The effect
-- is one guest seeing the new date in a later message; nothing is corrupted, and
-- the campaign window/plan follow the new date like any other change.
--
-- INDEX: the lookup runs only when a date actually changes, but without an index
-- it would scan contact_interactions (no index on event_id exists today). A
-- partial index on the rows the lookup can match keeps it a single probe.
-- (The table is small, so a plain CREATE INDEX is fine inside the migration
-- transaction; CONCURRENTLY cannot run there.)
--
-- ROLLBACK: restore the previous body of events_guard_update() — it is kept,
-- verbatim, in the comment block at the end of this file — and, if wanted,
-- `drop index public.contact_interactions_out_event_idx;`.

create index if not exists contact_interactions_out_event_idx
  on public.contact_interactions (event_id)
  where direction = 'out';

-- CREATE OR REPLACE keeps the function's owner and its ACL (the execute revoke of
-- 20260630230249_event_lifecycle_trigger_revoke_public.sql stays in force); the
-- trigger `events_guard_update` already points at it.
create or replace function public.events_guard_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  blocking int;
  today_il date := (now() at time zone 'Asia/Jerusalem')::date;
  -- 'on' ONLY inside admin_reschedule_event() (transaction-local); NULL/'off' for
  -- every other writer. current_setting(..., true) returns NULL when never set.
  staff_reschedule boolean := coalesce(current_setting('app.event_reschedule', true), 'off') = 'on';
  dates_changed boolean :=
    new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline;
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
      if dates_changed then
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

  if old.status <> 'draft' then
    -- R5 lock — NOW BY FIRST SEND. The owner's path (staff_reschedule is false) is
    -- locked when the event is closed, or once anything has gone out to a guest.
    -- Before that, an active event's dates are editable and fall through to the
    -- same R2/R2b validation a draft gets, below.
    if dates_changed and not staff_reschedule then
      if old.status = 'closed'
         or exists (
           select 1 from public.contact_interactions ci
           where ci.event_id = old.id and ci.direction = 'out'
         ) then
        raise exception 'event_date/rsvp_deadline are locked: the event is closed or a message has already been sent' using errcode='check_violation';
      end if;
    end if;
    -- R2 still applies ON the blessed (staff) path. Staff may postpone an event;
    -- they may not move one into the past, which would flip isPastEventDay and
    -- every behaviour keyed off it (activation refused, event-day sweeps, the
    -- thank-you window) without anything having actually happened.
    if staff_reschedule
       and new.event_date is distinct from old.event_date
       and (new.event_date is null
            or (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il) then
      raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
    end if;
  end if;

  -- Validate a date edit that is allowed to happen on the owner's path: a draft's
  -- (as before) or an unsent active event's (new). The staff path has its own R2
  -- above and clamps the deadline itself, so it is not re-validated here.
  if dates_changed and (old.status = 'draft' or not staff_reschedule) then
    if new.event_date is distinct from old.event_date  -- R2
       and new.event_date is not null
       and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
      raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
    end if;
    -- R2b: deadline LOWER BOUND ONLY — the CHECK events_rsvp_deadline_within_event,
    -- existing and UNCHANGED, already covers "requires event_date" + "<= event_day_IL"
    -- unconditionally on every row; do not duplicate it here.
    if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
      raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK BASELINE: the body of events_guard_update() as it was live on
-- 2026-09-30, before this migration (pg_get_functiondef). To roll back, run
-- `create or replace function public.events_guard_update() ...` with this body.
--
-- declare blocking int; today_il date := (now() at time zone 'Asia/Jerusalem')::date;
-- begin
--   if new.status is distinct from old.status then  -- a real transition
--     if not ( (old.status='draft' and new.status in ('active','closed'))
--           or (old.status='active' and new.status='closed') ) then
--       raise exception 'illegal event status transition % -> %', old.status, new.status using errcode='check_violation';  -- R6
--     end if;
--     if old.status='draft' and new.status='active' then  -- R3
--       if new.event_date is null
--          or (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
--         raise exception 'cannot publish: event_date must be set and >= tomorrow' using errcode='check_violation';
--       end if;
--       if new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
--         raise exception 'publish must not change event_date/rsvp_deadline (save dates first)' using errcode='check_violation';
--       end if;
--       if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
--         raise exception 'rsvp_deadline has elapsed — set a new deadline before publishing' using errcode='check_violation';
--       end if;
--     end if;
--     if new.status='closed' then  -- R7 (campaign.status only)
--       select count(*) into blocking from public.campaigns c where c.event_id=new.id
--         and c.status in ('draft','pending_approval','approved','scheduled','active','paused');
--       if blocking>0 then raise exception 'cannot close event: % operational campaign(s)', blocking using errcode='check_violation'; end if;
--     end if;
--   end if;
--   if old.status<>'draft' then  -- R5 lock
--     if (new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline)
--        and coalesce(current_setting('app.event_reschedule', true), 'off') <> 'on' then
--       raise exception 'event_date/rsvp_deadline are locked once the event leaves draft' using errcode='check_violation';
--     end if;
--     if coalesce(current_setting('app.event_reschedule', true), 'off') = 'on'
--        and new.event_date is distinct from old.event_date
--        and (new.event_date is null
--             or (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il) then
--       raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
--     end if;
--   elsif new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
--     if new.event_date is distinct from old.event_date  -- R2
--        and new.event_date is not null
--        and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
--       raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
--     end if;
--     if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then  -- R2b
--       raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
--     end if;
--   end if;
--   return new;
-- end;
