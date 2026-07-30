-- Owner-initiated fleet requests: let /admin/fleet START a conversation with a
-- role, not only answer one the role started.
--
-- Until now every row in fleet_requests was filed agent-side through the
-- service-role CLI, and the owner's only write was fleet_answer_request. The
-- grant layer reflects that: `authenticated` holds SELECT and nothing else,
-- and the single RLS policy (fleet_requests_admin_select) is SELECT-only. So
-- the UI cannot INSERT, by design — the way in is a SECURITY DEFINER function,
-- exactly like the answer path.
--
-- Three properties this function must carry, because the surrounding system
-- already depends on them:
--
--   1. IDEMPOTENCY. fleet_requests has a UNIQUE index on request_key, and the
--      agent side derives that key from (role, day, hash(kind+title+body)) —
--      see src/lib/fleet/request-key.ts. A double-submitted form must collide
--      with the same key instead of creating a second request, so the key
--      formula is mirrored here (md5 rather than sha256: no pgcrypto
--      dependency, and a 16-hex prefix scoped to one role on one day needs no
--      cryptographic strength). `on conflict do nothing` + re-select returns
--      the EXISTING row, so a double-click is a no-op that still navigates the
--      owner to their request.
--
--   2. payload.origin = 'owner'. The scheduler's inquiry-watcher spawns a role
--      when a counting query returns > 0; owner-initiated rows are what the
--      new `owner_direct_request` trigger counts. Without this marker an
--      agent-filed pending request would be indistinguishable and would spawn
--      the role to answer its own question.
--
--   3. payload.thread_root. The detail page already shows a role's other
--      requests as a thread (listFleetRequestsByRole). Explicit threading lets
--      a follow-up point at the conversation it belongs to WITHOUT a second
--      table: the append-only ledger stays the single source of truth, and the
--      immutability trigger keeps every message in the thread unforgeable.
--
-- The role name is NOT validated here on purpose: fleet.json is the registry
-- of roles and the database has no view of it. The UI populates the select
-- from that file, and the CLI's validateRequestRole covers the agent side —
-- putting a role list in a migration would create a second source of truth
-- that silently drifts.

create or replace function public.fleet_owner_request(
  p_role text,
  p_kind text,
  p_tier smallint,
  p_title text,
  p_body text,
  p_thread_root uuid default null
)
returns public.fleet_requests
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key text;
  v_payload jsonb;
  v_row public.fleet_requests%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'fleet_owner_request: admin only';
  end if;

  if p_kind not in ('approval', 'question', 'fyi') then
    raise exception 'fleet_owner_request: kind must be approval, question or fyi';
  end if;
  if p_tier is null or p_tier < 0 or p_tier > 2 then
    raise exception 'fleet_owner_request: tier must be 0, 1 or 2';
  end if;
  if btrim(coalesce(p_role, '')) = '' then
    raise exception 'fleet_owner_request: role is required';
  end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    raise exception 'fleet_owner_request: title and body are required';
  end if;

  -- Same shape as deriveRequestKey(), with an `owner:` prefix so an
  -- owner-initiated ask can never collide with an agent-filed one that happens
  -- to carry identical text on the same day.
  v_key := 'owner:' || p_role || ':'
        || to_char(timezone('Asia/Jerusalem', now()), 'YYYY-MM-DD') || ':'
        || substr(md5(p_kind || E'\n' || p_title || E'\n' || p_body), 1, 16);

  v_payload := jsonb_build_object('origin', 'owner');
  if p_thread_root is not null then
    v_payload := v_payload || jsonb_build_object('thread_root', p_thread_root);
  end if;

  insert into public.fleet_requests (request_key, role, kind, tier, title, body, payload)
  values (v_key, p_role, p_kind, p_tier, btrim(p_title), btrim(p_body), v_payload)
  on conflict (request_key) do nothing
  returning * into v_row;

  -- Conflict path: the identical ask already exists today. Return it rather
  -- than raising — a double submit should be invisible, not an error page.
  if v_row.id is null then
    select * into v_row from public.fleet_requests where request_key = v_key;
  end if;

  return v_row;
end;
$function$;

revoke all on function public.fleet_owner_request(text, text, smallint, text, text, uuid) from public;
grant execute on function public.fleet_owner_request(text, text, smallint, text, text, uuid) to authenticated;

-- The inquiry-watcher runs its counting query once per reactive role per tick
-- (every 60s). This partial index keeps that a constant-time lookup as the
-- ledger grows, instead of a scan that widens with history.
create index if not exists fleet_requests_owner_pending_idx
  on public.fleet_requests (role)
  where status = 'pending' and payload ->> 'origin' = 'owner';

comment on function public.fleet_owner_request(text, text, smallint, text, text, uuid) is
  'Owner-initiated fleet request from /admin/fleet. Admin-only (SECURITY DEFINER). Idempotent per role+day+content via request_key. Marks payload.origin=owner so the scheduler owner_direct_request trigger spawns the target role.';
