-- =====================================================================
-- Manual console dial: a pollable handle, and a touchpoint index that
-- cannot be lost to a race.
--
-- ── 1. dispatch_id ───────────────────────────────────────────────────
-- POST /api/events/{id}/outreach-call enqueues and returns 202. It cannot
-- return an attempt id: the row is created inside dispatchOutreachCall, in
-- the worker, AFTER the response is already sent
-- (src/lib/data/outreach-calls.ts). So the route returns the pg-boss job id
-- it already generates, and the dispatcher stamps that same id on the row it
-- creates. The console polls call_attempts by dispatch_id and reads a real
-- status instead of trusting a "queued" that promised more than was known.
--
-- Deliberately NOT unique: a job retried by pg-boss keeps its id, and
-- createCallAttempt is idempotent on (campaign, contact, touchpoint), so a
-- retry finds the existing row rather than inserting a second one. A UNIQUE
-- here would turn a harmless retry into an error.
--
-- ── 2. next_manual_touchpoint() ──────────────────────────────────────
-- call_attempts is UNIQUE(campaign_id, contact_id, touchpoint_index), and a
-- manual dial needs an index that collides with neither a campaign
-- touchpoint nor another manual dial.
--
-- The failure this prevents is SILENT, not corrupt. createCallAttempt is
-- ON CONFLICT DO NOTHING, so a collision inserts nothing, returns null, and
-- the dispatcher reports 'already_dispatched' — the data stays clean and the
-- CALL is what disappears. Nobody is alerted.
--
-- Computing the index in TypeScript cannot fix this at any level of
-- cleverness: two requests read the same MAX and both compute MAX+1, one
-- wins, the other is silently dropped. Allocation therefore happens INSIDE
-- the database, under a transaction-scoped advisory lock keyed on
-- (campaign, contact) — the same pair the unique constraint covers, so
-- concurrent callers for the SAME guest serialise while unrelated dials do
-- not contend at all.
--
-- The lock is pg_advisory_xact_lock: released at commit or rollback, with no
-- unlock path to forget. hashtext() supplies the two 32-bit keys — NOT
-- hashtextextended, which returns bigint and overflows on ::int ("22003:
-- integer out of range", caught by a rolled-back probe before this shipped; it
-- would have failed every manual dial at runtime). A hash collision between
-- unrelated (campaign, contact) pairs costs a little serialisation, nothing more.
--
-- Starts from MAX+1 within the reserved band rather than a fixed base,
-- because the band is NOT known-empty: production already contains
-- touchpoint_index values in the 12,000s from manual testing on 2026-07-19.
-- Assuming a range is free is how the previous scheme was justified.
--
-- SECURITY DEFINER + EXECUTE to service_role only: the worker's service-role
-- client is the sole caller. anon/authenticated get nothing.
--
-- Rollback:
--   drop function if exists public.next_manual_touchpoint(uuid, uuid);
--   drop index if exists public.call_attempts_dispatch_id_idx;
--   alter table public.call_attempts drop column if exists dispatch_id;
-- =====================================================================

alter table public.call_attempts
  add column if not exists dispatch_id uuid;

comment on column public.call_attempts.dispatch_id is
  'The enqueue job id returned to the console by POST /api/events/{id}/outreach-call, stamped here by the dispatcher so the caller can poll for the row it could not be given at 202 time (the row does not exist yet then). NOT unique: a pg-boss retry reuses the id and finds the existing row.';

-- The sweep-style lookup the console polls: one dispatch_id, newest first.
create index if not exists call_attempts_dispatch_id_idx
  on public.call_attempts (dispatch_id)
  where dispatch_id is not null;

-- Reserved band for operator-initiated dials. 900000 sits far above both real
-- campaign touchpoints and the 12,000-range left by manual testing, and far
-- below the callback band's own accounting.
create or replace function public.next_manual_touchpoint(
  p_campaign uuid,
  p_contact  uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base   constant integer := 900000;
  v_next   integer;
begin
  -- Serialise only the callers that could actually collide: the same
  -- (campaign, contact) pair. Transaction-scoped, so it cannot be leaked.
  perform pg_advisory_xact_lock(
    hashtext(p_campaign::text),
    hashtext(p_contact::text)
  );

  select coalesce(max(touchpoint_index), v_base - 1) + 1
    into v_next
    from public.call_attempts
   where campaign_id = p_campaign
     and contact_id  = p_contact
     and touchpoint_index >= v_base;

  return v_next;
end;
$function$;

comment on function public.next_manual_touchpoint(uuid, uuid) is
  'Allocates the next operator-dial touchpoint_index for one (campaign, contact), under a transaction-scoped advisory lock on that pair. Exists because computing MAX+1 in application code races: two callers read the same MAX, both insert, and ON CONFLICT DO NOTHING silently drops one CALL while leaving the data correct.';

revoke all on function public.next_manual_touchpoint(uuid, uuid) from public;
grant execute on function public.next_manual_touchpoint(uuid, uuid) to service_role;
