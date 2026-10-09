-- One open cancellation request per event.
--
-- WHY: on 9.10.2026 the test event c642c3dc received two pending requests 2.5 seconds apart (a second submit while the
-- first was still in flight). The form hid itself only after the answer, createCancellationRequest inserted without
-- looking, and nothing in the database stopped it. The app now locks the button and checks first; this index is the
-- guard that holds when two requests arrive at the same moment (the app maps its 23505 to a plain Hebrew message).
--
-- WHAT IT DOES: a partial unique index on event_id over pending rows. A resolved request (declined or approved) leaves
-- the index, so a new request after a decline is still possible, as today.
--
-- WHAT IT DOES NOT DO: change any row. If an event already has more than one pending request, the migration stops with
-- a message naming it; staff resolve the extra one in /admin/cancellations and the migration is run again.
--
-- ROLLBACK:
--   drop index public.event_cancellation_requests_one_pending;

do $$
declare
  v_events text;
begin
  select string_agg(event_id::text, ', ')
    into v_events
    from (
      select event_id
        from public.event_cancellation_requests
       where status = 'pending'
       group by event_id
      having count(*) > 1
    ) d;
  if v_events is not null then
    raise exception 'events with more than one pending cancellation request: % — resolve the extra requests in /admin/cancellations first', v_events;
  end if;
end $$;

create unique index event_cancellation_requests_one_pending
  on public.event_cancellation_requests (event_id)
  where status = 'pending';

comment on index public.event_cancellation_requests_one_pending is
  'At most one pending cancellation request per event. createCancellationRequest maps a violation (23505) to a plain message.';
