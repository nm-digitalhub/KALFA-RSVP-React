-- The database announces callback work instead of being asked about it.
--
-- Until now the scheduling sweep ran on a ten-minute cron, so a request that
-- landed at 22:13 waited until 22:20 for its appointment — the triage agent had
-- already read it and written the caller's date by 22:14. The slow half of the
-- pipeline set the pace for the fast half.
--
-- LISTEN/NOTIFY removes the wait entirely: the row's own commit tells the worker
-- there is something to do. Verified on this project's actual connection
-- (aws-1-*.pooler.supabase.com:5432, session mode) before this was written —
-- transaction-mode pooling silently swallows LISTEN, and port 5432 is the
-- session pooler, which does not.
--
-- WHAT THIS DOES NOT REPLACE: the cron. A NOTIFY is fire-and-forget — if no
-- listener is connected at that instant, nobody ever learns. A worker restart,
-- a dropped pooler connection, a deploy: the notification is simply gone. The
-- schedule therefore stays as the backstop that catches whatever the push
-- missed, which is the difference between a fast system and a lossy one.

create or replace function public.notify_callback_work()
returns trigger
language plpgsql
as $$
declare
  reason text;
begin
  if tg_op = 'INSERT' then
    reason := 'created';
  -- A triage that reached a final answer is the moment the row becomes
  -- schedulable WITH the caller's own constraints. Firing on every update would
  -- announce the scheduler's own writes back to itself.
  elsif new.triage_status is distinct from old.triage_status
        and new.triage_status in ('completed', 'manual_review', 'failed') then
    reason := 'triaged';
  else
    return null;
  end if;

  -- Payload stays tiny and non-identifying: the listener re-reads state anyway,
  -- and a NOTIFY payload is visible to anything that can LISTEN on the channel.
  perform pg_notify('callback_work', json_build_object('id', new.id, 'reason', reason)::text);
  return null;
end;
$$;

comment on function public.notify_callback_work() is
  'Announces on channel callback_work when a callback request is created or finishes triage. Delivered at COMMIT.';

drop trigger if exists callback_requests_notify_work on public.callback_requests;
-- AFTER, so the notification describes a state that is already committed: a
-- listener fast enough to react would otherwise read the row before the
-- transaction that changed it had landed.
create trigger callback_requests_notify_work
  after insert or update of triage_status on public.callback_requests
  for each row
  execute function public.notify_callback_work();
