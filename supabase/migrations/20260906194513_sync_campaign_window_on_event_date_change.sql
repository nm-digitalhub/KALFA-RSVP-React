-- Heal the campaign window when an event's date moves.
--
-- THE BUG: campaigns.close_at is a SNAPSHOT of events.event_date, taken once at
-- campaign creation (src/lib/data/campaigns.ts: `close_at: event.event_date`).
-- Nothing re-derived it. The outreach engine already reads the LIVE event_date
-- and re-plans, so a moved date sends correctly — but try_record_billed_result
-- gates on the stale close_at and returns 'closed_window'. A campaign that
-- sends, gets answers, and bills for none of them. Silently.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE: the date is currently lifecycle-locked
-- after draft, so the app path cannot reach this today. That makes the
-- application an unreliable place for the repair — the damage arrives through
-- the paths that bypass it (a direct UPDATE, a future admin edit screen, a
-- migration). A trigger heals every path, including the ones not written yet.
--
-- close_at is safe to overwrite unconditionally: it is written in exactly one
-- place in the codebase, always as event_date, and all five production rows had
-- it identical to their event's date. It is derived, not authored.
--
-- thankyou_send_at is NOT. The owner can edit it (updateThankyouSettings), and
-- campaigns.ts already guards re-activation with `.is(null)` so a pause/resume
-- cannot clobber an owner-chosen time. Production proves the case is real: one
-- campaign is set to 08:00 Israel where the default would be 10:00. So it moves
-- only when it still holds the default derived from the OLD date; a customised
-- time is left exactly where the owner put it.
--
-- Terminal campaigns are excluded. Once a campaign is closed/billed/paid or
-- cancelled its window is history, and re-opening it by moving close_at could
-- let a settled campaign bill again.

create or replace function public.sync_campaign_window_from_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The app's rule (src/lib/data/event-date.ts defaultThankyouSendAt): the
  -- morning after the event's ISRAEL calendar day, 10:00 Israel local.
  -- `AT TIME ZONE 'Asia/Jerusalem'` resolves the wall clock in the zone, so the
  -- summer/winter offset is handled by Postgres rather than by arithmetic —
  -- verified against production: it reproduces 10:00 Israel for a July event
  -- (UTC+3) and a December one (UTC+2) alike.
  old_default timestamptz := (((old.event_date at time zone 'Asia/Jerusalem')::date
                               + 1 + time '10:00') at time zone 'Asia/Jerusalem');
  new_default timestamptz := (((new.event_date at time zone 'Asia/Jerusalem')::date
                               + 1 + time '10:00') at time zone 'Asia/Jerusalem');
begin
  update public.campaigns c
  set
    close_at = new.event_date,
    thankyou_send_at = case
      -- IS NOT DISTINCT FROM, not `=`: a null must compare equal to a null
      -- rather than yielding null and falling to the ELSE branch.
      when c.thankyou_send_at is not distinct from old_default then new_default
      else c.thankyou_send_at
    end
  where c.event_id = new.id
    and c.status not in ('closed', 'awaiting_invoice', 'billed', 'paid', 'cancelled');

  return new;
end;
$$;

comment on function public.sync_campaign_window_from_event() is
  'Keeps campaigns.close_at (and the still-default thankyou_send_at) in step with events.event_date. Without it a moved date leaves the billing window closed on the old day and reached contacts never bill.';

drop trigger if exists trg_sync_campaign_window_from_event on public.events;

create trigger trg_sync_campaign_window_from_event
  after update of event_date on public.events
  for each row
  when (old.event_date is distinct from new.event_date)
  execute function public.sync_campaign_window_from_event();
