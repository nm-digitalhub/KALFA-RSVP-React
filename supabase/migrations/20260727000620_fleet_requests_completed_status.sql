-- fleet_requests: add a terminal 'completed' status — set by the EXECUTOR
-- (the interactive main session, or a role) after the requested work is DONE.
-- Distinct from 'expired' (superseded / unanswered) and 'consumed' (verdict
-- merely read by the filing role). Motivation: main-targeted handoffs had no
-- honest terminal state — completions were recorded as withdraw→expired,
-- which reads as "lapsed", sends no push, and hides the outcome.
--
-- New legal edges (everything else unchanged):
--   pending           -> completed   (executed without needing a verdict;
--                                     `answer` carries the completion summary)
--   approved|answered -> completed   (executed after the owner's verdict; the
--                                     verdict text must remain a PREFIX of the
--                                     final answer — completion APPENDS, and
--                                     answered_by/answered_at stay frozen)
-- 'denied' is deliberately NOT completable.
-- consumed_at doubles as the completion timestamp (required on 'completed').

alter table public.fleet_requests drop constraint fleet_requests_status_check;
alter table public.fleet_requests add constraint fleet_requests_status_check
  check (status = any (array[
    'pending'::text, 'approved'::text, 'denied'::text, 'answered'::text,
    'expired'::text, 'consumed'::text, 'completed'::text
  ]));

-- Original: (status IN verdict-set) = (answered_at IS NOT NULL). 'completed'
-- can carry answered_at either way (with/without a prior verdict), so it gets
-- an explicit carve-out; every pre-existing status keeps its exact semantics.
alter table public.fleet_requests drop constraint fleet_requests_answered_consistency;
alter table public.fleet_requests add constraint fleet_requests_answered_consistency
  check (
    (status in ('approved', 'denied', 'answered', 'consumed') and answered_at is not null)
    or (status = 'pending' and answered_at is null)
    or (status = 'expired' and answered_at is null)
    or status = 'completed'
  );

alter table public.fleet_requests drop constraint fleet_requests_consumed_consistency;
alter table public.fleet_requests add constraint fleet_requests_consumed_consistency
  check ((status in ('consumed', 'completed')) = (consumed_at is not null));

create or replace function public.fleet_requests_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'fleet_requests: rows are never deleted (append-only audit)';
  end if;

  if tg_op = 'INSERT' then
    -- New requests must be clean pending rows; nobody pre-answers.
    if new.status <> 'pending'
      or new.answer is not null
      or new.answered_by is not null
      or new.answered_at is not null
      or new.consumed_at is not null then
      raise exception 'fleet_requests: inserts must be clean pending rows';
    end if;
    return new;
  end if;

  -- UPDATE: the request's identity and content are immutable for everyone.
  if new.id is distinct from old.id
    or new.request_key is distinct from old.request_key
    or new.role is distinct from old.role
    or new.run_id is distinct from old.run_id
    or new.kind is distinct from old.kind
    or new.tier is distinct from old.tier
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'fleet_requests: core fields are immutable (append-only audit)';
  end if;

  -- Carve-out for the FK referential action: deleting an auth user runs an
  -- internal UPDATE (answered_by -> NULL) via ON DELETE SET NULL, which also
  -- fires this trigger. Allow exactly that shape — nothing else changed.
  if new.status = old.status
    and old.answered_by is not null
    and new.answered_by is null
    and new.answer is not distinct from old.answer
    and new.answered_at is not distinct from old.answered_at
    and new.consumed_at is not distinct from old.consumed_at then
    return new;
  end if;

  -- State machine. Same-status updates are rejected too: after a verdict is
  -- recorded the row is frozen except for the single allowed edge.
  if old.status = 'pending' and new.status in ('approved', 'denied', 'answered', 'expired') then
    return new;
  end if;
  if old.status = 'pending' and new.status = 'completed' then
    -- Executor completion without a verdict; `answer` carries the summary.
    return new;
  end if;
  if old.status in ('approved', 'answered') and new.status = 'completed' then
    -- Completion after a verdict: attribution is frozen, and the owner's
    -- verdict text must survive verbatim as a prefix — completion APPENDS.
    if new.answered_by is distinct from old.answered_by
      or new.answered_at is distinct from old.answered_at then
      raise exception 'fleet_requests: verdict fields are frozen after answering';
    end if;
    if old.answer is not null
      and (new.answer is null or strpos(new.answer, old.answer) <> 1) then
      raise exception 'fleet_requests: completion must append to the verdict answer, not rewrite it';
    end if;
    return new;
  end if;
  if old.status in ('approved', 'denied', 'answered') and new.status = 'consumed' then
    -- Verdict fields are frozen at consumption; only consumed_at may be set.
    if new.answer is distinct from old.answer
      or new.answered_by is distinct from old.answered_by
      or new.answered_at is distinct from old.answered_at then
      raise exception 'fleet_requests: verdict fields are frozen after answering';
    end if;
    return new;
  end if;

  raise exception 'fleet_requests: illegal status transition % -> %', old.status, new.status;
end;
$function$;
