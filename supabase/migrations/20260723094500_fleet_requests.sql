-- =====================================================================
-- fleet_requests: the two-way owner<->autonomous-fleet communication ledger.
--
-- Autonomous fleet roles (headless Claude runs scheduled by the kalfa-fleet
-- pm2 app) file questions / approval requests / FYIs here via the service-role
-- CLI (scripts/fleet-agent-cli.ts). The owner reads and answers them at
-- /admin/fleet. A web push + Slack mirror fire on insert (application side).
--
-- Named "fleet" (NOT "agent_*"): the agent_* namespace belongs to the human
-- agent-console domain (voice calls / Android console).
--
-- Access model (each claim below is ENFORCED, not aspirational):
--   - INSERT: service role only (no RLS insert policy; anon/authenticated have
--     no INSERT grant). New rows are forced to a clean pending state by the
--     guard trigger. Retried inserts are deduped by the mandatory unique
--     request_key.
--   - SELECT: platform admins only (RLS has_role); grant layer limited to
--     select for authenticated.
--   - Answering: ONLY via fleet_answer_request() (SECURITY DEFINER, EXECUTE
--     for authenticated, internal admin check). authenticated has NO direct
--     UPDATE grant, so the browser can never set answered_by/answered_at
--     itself — the function stamps auth.uid() + now().
--   - Consuming: ONLY via fleet_consume_request() (EXECUTE for service_role).
--     Atomic CAS claim; at most one caller ever receives the row.
--   - DELETE: nobody, including service_role — enforced by a BEFORE DELETE
--     trigger, not just by grants. Retention, if ever needed, must arrive as
--     an explicit future migration that first drops that trigger.
--
-- State machine (enforced by the guard trigger):
--   pending -> approved | denied | answered | expired
--   approved | denied | answered -> consumed
--   consumed / expired are terminal.
-- =====================================================================

create table if not exists public.fleet_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null,
  role text not null,
  run_id text,
  kind text not null,
  tier smallint not null default 0,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  answer text,
  answered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  expires_at timestamptz not null default now() + interval '72 hours',
  consumed_at timestamptz,
  constraint fleet_requests_request_key_unique unique (request_key),
  constraint fleet_requests_request_key_not_blank check (btrim(request_key) <> ''),
  constraint fleet_requests_request_key_len check (char_length(request_key) <= 200),
  constraint fleet_requests_role_not_blank check (btrim(role) <> ''),
  constraint fleet_requests_role_len check (char_length(role) <= 64),
  constraint fleet_requests_kind_check check (kind in ('approval', 'question', 'fyi')),
  constraint fleet_requests_tier_check check (tier between 0 and 2),
  constraint fleet_requests_title_not_blank check (btrim(title) <> ''),
  constraint fleet_requests_title_len check (char_length(title) <= 200),
  constraint fleet_requests_body_not_blank check (btrim(body) <> ''),
  constraint fleet_requests_body_len check (char_length(body) <= 8000),
  constraint fleet_requests_answer_len check (answer is null or char_length(answer) <= 2000),
  constraint fleet_requests_status_check check (
    status in ('pending', 'approved', 'denied', 'answered', 'expired', 'consumed')
  ),
  -- Status<->timestamp consistency: an owner verdict implies answered_at (and
  -- consumed keeps it); pending/expired rows were never answered.
  constraint fleet_requests_answered_consistency check (
    (status in ('approved', 'denied', 'answered', 'consumed')) = (answered_at is not null)
  ),
  -- consumed <=> consumed_at, in both directions.
  constraint fleet_requests_consumed_consistency check (
    (status = 'consumed') = (consumed_at is not null)
  )
);

create index if not exists fleet_requests_status_created_idx
  on public.fleet_requests (status, created_at desc);

-- ---------------------------------------------------------------------
-- Guard trigger: immutability of core fields, the full state machine, and the
-- append-only guarantee (DELETE blocked for everyone). Triggers are not
-- bypassed by BYPASSRLS, so these hold against service_role too.
-- ---------------------------------------------------------------------
create or replace function public.fleet_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

drop trigger if exists fleet_requests_guard on public.fleet_requests;
create trigger fleet_requests_guard
  before insert or update or delete on public.fleet_requests
  for each row execute function public.fleet_requests_guard();

-- TRUNCATE bypasses row-level triggers, so the append-only guarantee needs a
-- statement-level guard too — otherwise service_role could still wipe the
-- table in one statement despite the DELETE block above.
create or replace function public.fleet_requests_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'fleet_requests: truncate is forbidden (append-only audit)';
end;
$$;

drop trigger if exists fleet_requests_no_truncate on public.fleet_requests;
create trigger fleet_requests_no_truncate
  before truncate on public.fleet_requests
  for each statement execute function public.fleet_requests_no_truncate();

alter table public.fleet_requests enable row level security;

-- Admin-only read; guests/customers can never see fleet traffic.
drop policy if exists fleet_requests_admin_select on public.fleet_requests;
create policy fleet_requests_admin_select on public.fleet_requests
  for select
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- NO update policy and NO update grant for authenticated: answering goes only
-- through fleet_answer_request() below. No INSERT/DELETE policy either.

-- ---------------------------------------------------------------------
-- fleet_answer_request: the ONLY write path for the owner (browser/admin).
--
-- SECURITY DEFINER on purpose (project RPC-lockdown convention): authenticated
-- has no table UPDATE grant at all, so the browser cannot forge answered_by /
-- answered_at / arbitrary columns — this function stamps auth.uid() + now()
-- itself after an internal admin check. EXECUTE is granted to authenticated
-- only; anon/public are revoked.
-- Validations: caller is admin; row is pending and not past expires_at; the
-- verdict matches the kind (approval -> approved/denied; question -> answered
-- with a non-empty answer; fyi -> answered, answer optional).
-- ---------------------------------------------------------------------
create or replace function public.fleet_answer_request(
  p_id uuid,
  p_verdict text,
  p_answer text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fleet_requests%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'fleet_answer_request: admin only';
  end if;

  select * into v_row
    from public.fleet_requests
    where id = p_id
    for update;
  if not found then
    raise exception 'fleet_answer_request: request not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'fleet_answer_request: request is not pending';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'fleet_answer_request: request has expired';
  end if;

  if v_row.kind = 'approval' then
    if p_verdict not in ('approved', 'denied') then
      raise exception 'fleet_answer_request: approval requests take approved/denied only';
    end if;
  elsif v_row.kind = 'question' then
    if p_verdict <> 'answered' then
      raise exception 'fleet_answer_request: question requests take answered only';
    end if;
    if p_answer is null or btrim(p_answer) = '' then
      raise exception 'fleet_answer_request: an answer is required for questions';
    end if;
  else -- fyi
    if p_verdict <> 'answered' then
      raise exception 'fleet_answer_request: fyi requests take answered only';
    end if;
  end if;

  update public.fleet_requests
    set status = p_verdict,
        answer = p_answer,
        answered_by = auth.uid(),
        answered_at = now()
    where id = p_id;
end;
$$;

revoke all on function public.fleet_answer_request(uuid, text, text) from public;
revoke all on function public.fleet_answer_request(uuid, text, text) from anon;
grant execute on function public.fleet_answer_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- fleet_consume_request: atomic exactly-once claim of an answered request.
--
-- Single CAS UPDATE ... RETURNING: Postgres row locking serializes concurrent
-- callers; exactly one receives the row, the rest get zero rows (the guard
-- trigger additionally forbids consumed -> anything).
--
-- DELIBERATE deviation from the review's "SECURITY DEFINER" suggestion: the
-- function is SECURITY INVOKER with EXECUTE granted to service_role only.
-- Its sole caller (the fleet CLI) already runs as service_role, so INVOKER
-- grants nothing extra — whereas a DEFINER function would carry postgres-level
-- table access to ANYONE who ever gains EXECUTE by a future grant mistake
-- (this project has been through exactly that RPC-lockdown exercise).
-- INVOKER is the least-privilege construction that still guarantees the
-- single audited consume path.
-- ---------------------------------------------------------------------
create or replace function public.fleet_consume_request(p_id uuid)
returns setof public.fleet_requests
language sql
set search_path = ''
as $$
  update public.fleet_requests
    set status = 'consumed',
        consumed_at = now()
    where id = p_id
      and status in ('approved', 'denied', 'answered')
      and consumed_at is null
    returning *;
$$;

revoke all on function public.fleet_consume_request(uuid) from public;
revoke all on function public.fleet_consume_request(uuid) from anon;
revoke all on function public.fleet_consume_request(uuid) from authenticated;
grant execute on function public.fleet_consume_request(uuid) to service_role;

-- Grant layer (project convention per 20260721193019: explicit revoke + the
-- minimum the code actually uses; service_role untouched). authenticated gets
-- SELECT only — every write goes through the functions above.
revoke all on public.fleet_requests from anon;
revoke all on public.fleet_requests from authenticated;
grant select on public.fleet_requests to authenticated;
