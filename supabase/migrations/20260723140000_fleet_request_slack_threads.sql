-- =====================================================================
-- fleet_request_slack_threads: Slack thread root per fleet request.
--
-- The request-filed alert's Slack `ts` is captured by the fleet CLI and stored
-- here, so the lifecycle follow-ups ("המענה נרשם", "הסוכן קלט את התשובה") post
-- as REPLIES in that thread instead of separate channel messages.
--
-- A side table on purpose: fleet_requests is append-only with an audited
-- immutability trigger — adding a mutable infra column there would mean
-- reopening that trigger's carve-outs. This table is 1:0..1 notification
-- metadata, insert-once by the service-role CLI.
--
-- Access model:
--   - INSERT: service role only (no policy, no grant for app roles).
--   - SELECT: platform admins (the cookie-client answer path reads the ts to
--     thread its notification) — has_role RLS + select grant.
--   - UPDATE/DELETE: nobody in the app roles; a thread root never changes.
-- =====================================================================

create table if not exists public.fleet_request_slack_threads (
  request_id uuid primary key references public.fleet_requests(id) on delete cascade,
  thread_ts text not null,
  created_at timestamptz not null default now(),
  constraint fleet_request_slack_threads_ts_not_blank check (btrim(thread_ts) <> ''),
  constraint fleet_request_slack_threads_ts_len check (char_length(thread_ts) <= 32)
);

alter table public.fleet_request_slack_threads enable row level security;

drop policy if exists fleet_request_slack_threads_admin_select
  on public.fleet_request_slack_threads;
create policy fleet_request_slack_threads_admin_select
  on public.fleet_request_slack_threads
  for select
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- Grant hygiene per project convention (explicit revoke + minimum used).
revoke all on public.fleet_request_slack_threads from anon;
revoke all on public.fleet_request_slack_threads from authenticated;
grant select on public.fleet_request_slack_threads to authenticated;
