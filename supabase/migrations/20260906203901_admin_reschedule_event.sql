-- Let platform staff move a published event's date — through ONE blessed path.
--
-- WHY THIS IS A MIGRATION AND NOT APPLICATION CODE: the R5 lock
-- ("event_date/rsvp_deadline are locked once the event leaves draft") lives in
-- the events_guard_update BEFORE UPDATE trigger. It is SECURITY DEFINER and
-- fires for EVERY writer, service_role included, so no amount of application
-- change could have moved a date. Three application layers refuse first (the
-- form omits the field's name, disables the control, and updateEvent throws),
-- but the trigger is the one that actually cannot be talked around.
--
-- Staff already close, cancel and settle-and-charge a customer's campaign;
-- being unable to move that campaign's event by a day was an inconsistency, not
-- a boundary. A postponed event is an ordinary support call.
--
-- THE SHAPE: the lock stays exactly as it is for every existing path. A single
-- transaction-local flag opens it, and only admin_reschedule_event() can set
-- that flag. Nothing else in the database or the application sets it, so the
-- owner form, the console, the worker and any future writer keep hitting the
-- same refusal they hit today.
--
-- Authorization stays in the DATABASE rather than resting on the caller having
-- checked: the function verifies has_platform_permission('manage_billing') —
-- the same permission behind the close/settle/cancel controls — before it does
-- anything. It is therefore called with the COOKIE client (auth.uid() must be
-- the staff member; under service_role there is no JWT and the check refuses),
-- which is this codebase's established pattern for admin surfaces.

-- 1) The guard learns one exception, and re-imposes R2 inside it.
--    Reproduced in full because CREATE OR REPLACE takes the whole body; the ONLY
--    changes are in the `old.status<>'draft'` branch at the bottom.
create or replace function public.events_guard_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
    -- The single exception. `current_setting(..., true)` returns NULL when the
    -- setting was never set, which is the normal case for every writer — so the
    -- refusal below is unchanged for all of them. Only
    -- admin_reschedule_event() sets it, and only for the duration of its own
    -- transaction (set_config's is_local = true).
    if (new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline)
       and coalesce(current_setting('app.event_reschedule', true), 'off') <> 'on' then
      raise exception 'event_date/rsvp_deadline are locked once the event leaves draft' using errcode='check_violation';
    end if;
    -- R2 still applies ON the blessed path. Staff may postpone an event; they
    -- may not move one into the past, which would flip isPastEventDay and every
    -- behaviour keyed off it (activation refused, event-day sweeps, the
    -- thank-you window) without anything having actually happened.
    if coalesce(current_setting('app.event_reschedule', true), 'off') = 'on'
       and new.event_date is distinct from old.event_date
       and (new.event_date is null
            or (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il) then
      raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
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
end; $function$;

-- 2) The only function that may open it.
create or replace function public.admin_reschedule_event(
  _event_id uuid,
  _event_date timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cur_status public.event_status;
  cur_deadline date;
  new_event_day date := (_event_date at time zone 'Asia/Jerusalem')::date;
begin
  -- Authorization first, before the row is even read. Same permission as the
  -- campaign wind-down controls. auth.uid() is null under service_role, so this
  -- refuses a service-role caller by construction — the app must call it with
  -- the request-scoped cookie client, carrying the staff member's identity.
  if not public.has_platform_permission('manage_billing') then
    raise exception 'insufficient privilege to reschedule an event' using errcode = '42501';
  end if;

  if _event_date is null then
    raise exception 'event_date is required' using errcode = 'check_violation';
  end if;

  select status, rsvp_deadline into cur_status, cur_deadline
  from public.events where id = _event_id for update;
  if not found then
    raise exception 'event not found' using errcode = 'no_data_found';
  end if;

  -- A draft's date is edited through the owner's own form, which needs no
  -- exception; a closed event's date is history. Only a live event is
  -- rescheduled.
  if cur_status <> 'active' then
    raise exception 'only an active event can be rescheduled' using errcode = 'check_violation';
  end if;

  perform set_config('app.event_reschedule', 'on', true);

  update public.events
  set
    event_date = _event_date,
    -- events_rsvp_deadline_within_event (CHECK) requires
    -- rsvp_deadline <= event_day. Moving an event EARLIER would otherwise be
    -- rejected outright by a deadline that is now after it, so the deadline
    -- follows the event down. It is never pushed later: an event moved further
    -- out keeps the RSVP date its guests were already given.
    rsvp_deadline = case
      when cur_deadline is not null and cur_deadline > new_event_day then new_event_day
      else cur_deadline
    end
  where id = _event_id;

  -- Belt and braces: the flag is transaction-local and would expire on its own,
  -- but nothing after this point in the transaction has any business moving a
  -- date.
  perform set_config('app.event_reschedule', 'off', true);

  return _event_date;
end;
$$;

comment on function public.admin_reschedule_event(uuid, timestamptz) is
  'Platform-staff reschedule of a live event. The ONLY caller permitted to lift the R5 date lock in events_guard_update; gates on has_platform_permission(manage_billing) and must be called with the user-scoped client. Clamps rsvp_deadline to the new event day when the move is earlier. campaigns.close_at follows via trg_sync_campaign_window_from_event.';

-- Anonymous callers have no business here. The permission check inside is the
-- real gate; this keeps the surface off the public API as well.
revoke all on function public.admin_reschedule_event(uuid, timestamptz) from public;
revoke all on function public.admin_reschedule_event(uuid, timestamptz) from anon;
grant execute on function public.admin_reschedule_event(uuid, timestamptz) to authenticated;
