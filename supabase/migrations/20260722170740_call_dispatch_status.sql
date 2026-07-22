-- already_reached end-to-end, part 2 of 2: call_dispatch_status — the app's
-- post-202 truth channel for operator-initiated (manual) dials.
--
-- Why this table exists:
--   The manual-dial route answers 202 before any worker gate runs. A refused
--   dial creates NO call_attempts row -> NO console_call_feed row -> the app
--   hears nothing and cannot tell "still queued" from "refused". Refusals
--   cannot go into console_call_feed: its PK call_attempt_id is an FK to
--   call_attempts(id), and a refusal has no attempt row by definition — that
--   FK is a correct boundary (feed = real calls only) and is NOT touched.
--   The code comments' promise that "the console polls call_attempts by
--   dispatch_id" was never realizable from the app: call_attempts' only
--   authenticated policy is admin-read, and console agents are staff, not
--   admins. activity_log ('call.manual_dispatch') is likewise unreadable and
--   unpublished.
--
-- What a row is: a DISPATCH REQUEST and its acceptance outcome — not a call.
-- Real calls and attempts stay in call_attempts / console_call_feed; on
-- status='dispatched' the app hops to the feed row via call_attempt_id.
--
-- Lifecycle (all writes are server-side, service-role only):
--   1. The route preflights already-reached. Refused -> 409, NO job, NO row.
--   2. Accepted -> the route INSERTs {dispatch_id, status:'accepted'} FIRST,
--      then enqueues, then answers 202 {dispatch_id}. Insert failure -> 500,
--      nothing enqueued; enqueue failure -> the row is settled
--      failed/temporary_dispatch_failure and the route answers 502. So every
--      202 has an 'accepted' row, and no 'accepted' row outlives its job.
--   3. The worker settles the row by dispatch_id (isManual jobs only) with a
--      CLOSED public mapping of CallDispatchResult:
--        dialed                    -> dispatched (+ call_attempt_id)
--        already_dispatched/_concluded -> dispatched (+ winner's attempt id)
--        skipped/*                 -> skipped  (reason verbatim)
--        outreach_disabled         -> blocked  (public class, though the
--                                    worker's internal kind is 'skipped')
--        blocked/*                 -> blocked
--        failed_to_start           -> failed
--        start_unknown             -> unknown (call MAY have gone out — the
--                                    app must never auto-redial it)
--        transient_error           -> NOT final: the row stays 'accepted'
--                                    while pg-boss retries; on the LAST
--                                    permitted delivery the worker settles
--                                    failed/temporary_dispatch_failure.
--      The worker upserts (not update): a job enqueued by a pre-deploy route
--      has no 'accepted' row, and the app still deserves its answer.
--   4. skipped + already_reached is a valid domain refusal, not an error.
--
-- Realtime: the table joins supabase_realtime; the app subscribes
-- (postgres_changes) AND can poll by dispatch_id after a reconnect.
--
-- Privacy: no phone, no locked_price, no billing data, no free text — reason
-- is a closed enum enforced by CHECK below (never provider/exception text).
-- contact_id is an internal correlation id; this staff surface already sees
-- contact_id via console_campaign_targets.
--
-- Retention: a daily worker cron (call-dispatch-retention, Asia/Jerusalem)
-- deletes rows older than 30 days so the table stays bounded; it also sweeps
-- version-skew stragglers. The table is a status channel, not an audit log —
-- activity_log 'call.manual_dispatch' remains the durable audit record.
--
-- Rollback:
--   alter publication supabase_realtime drop table public.call_dispatch_status;
--   drop table if exists public.call_dispatch_status;

create table if not exists public.call_dispatch_status (
  dispatch_id     uuid primary key,
  event_id        uuid not null references public.events(id)   on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  -- Filled only when an attempt row exists (dispatched). SET NULL, not
  -- cascade: the request record outlives the call row it once pointed at
  -- (event deletion still cascades the whole row via event_id).
  call_attempt_id uuid references public.call_attempts(id) on delete set null,
  status          text not null default 'accepted'
                    check (status in
                      ('accepted','dispatched','skipped','blocked','failed','unknown')),
  -- CLOSED union — the public refusal vocabulary. Extending it is a deliberate
  -- contract change (new migration + app mapping), never a code-only edit; a
  -- corpus test asserts the TS union and this CHECK stay identical, and the
  -- exhaustive TS mapper makes an unmapped worker outcome a compile error, so
  -- this CHECK cannot be hit by surprise at runtime.
  reason          text
                    check (reason is null or reason in
                      ('already_reached','no_call_consent','dnc_listed',
                       'campaign_not_active','event_closed','concurrent_owner',
                       'max_concurrency','campaign_hour_cap',
                       'outreach_disabled','config_missing',
                       'live_calls_disabled','balance_below_reserve',
                       'already_dispatched','already_concluded',
                       'failed_to_start','start_unknown',
                       'temporary_dispatch_failure')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.call_dispatch_status is
  'One row per operator-initiated dial request (dispatch_id from the 202), created accepted by the route and settled by the worker with a closed public status/reason. Console-agent read, service-role write. status=skipped + reason=already_reached is a domain refusal, not an error. Real calls live in call_attempts/console_call_feed.';

-- Event-scoped reads and the event-cascade path.
create index if not exists call_dispatch_status_event_idx
  on public.call_dispatch_status (event_id);
-- Serves the FK's ON DELETE SET NULL scan; partial — most rows never dial.
create index if not exists call_dispatch_status_attempt_idx
  on public.call_dispatch_status (call_attempt_id)
  where call_attempt_id is not null;

alter table public.call_dispatch_status enable row level security;

-- Read: console agents only (staff surface — same gate as every console_*
-- relation). NO insert/update/delete policies on purpose: the only writers are
-- the route and the worker via service_role, which bypasses RLS.
create policy call_dispatch_status_select
  on public.call_dispatch_status
  for select to authenticated using (public.is_console_agent());

-- revoke-first (same reasoning as the console views and human_agent_call_legs):
-- default privileges hand `authenticated` the full set; a grant alone removes
-- nothing.
revoke all on public.call_dispatch_status from authenticated;
revoke all on public.call_dispatch_status from anon;
grant select on public.call_dispatch_status to authenticated;

alter publication supabase_realtime add table public.call_dispatch_status;
