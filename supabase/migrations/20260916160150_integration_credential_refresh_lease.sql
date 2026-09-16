-- =====================================================================
-- Distributed refresh lease, and a nullable expiry.
--
-- WHY A LEASE AND NOT A LOCK.
--
-- A refresh is not one database operation. It is: read the stored refresh
-- token, call the provider's token endpoint over HTTPS, then write what came
-- back. The middle step leaves the database entirely.
--
-- `pg_advisory_xact_lock` inside the write RPC therefore protects the wrong
-- thing. PostgREST runs each RPC in its own transaction, so the lock is taken
-- and released around the WRITE — long after the network call. Two workers that
-- both see the same token as expired would both send THE SAME refresh token to
-- the provider, and a provider that rotates refresh tokens (RFC 6749 §6 permits
-- it, and §6 also lets it "revoke the old refresh token after issuing a new
-- one") invalidates one of the two results. The loser then holds a refresh
-- token the provider has already retired, and the connection is dead with no
-- error anyone saw.
--
-- The lease is a compare-and-set that OUTLIVES a transaction: claim it, make
-- the network call, then write only if the claim is still ours and still live.
--
--   integrations_claim_credential_refresh   → 'claimed' | 'locked' | 'not_refreshable'
--   integrations_replace_credential         → refuses anything but the live lease owner
--   integrations_release_credential_refresh → the failure path, so a loser does
--                                             not wait out the whole TTL
--
-- ⚠️ THE THREE TIMERS, AND THE ORDER BETWEEN THEM. Same discipline as
-- `workflow-budgets.test.ts`, for the same reason — they live in three files and
-- nothing but this comment relates them:
--
--   provider request timeout   20s   REQUEST_TIMEOUT_MS, authenticated-request.ts
--   refresh lease TTL          60s   DEFAULT below, clamped to [10, 180]
--   node execution budget     120s   DEFAULT_NODE_ACTIVITY_PROFILE, node-budgets.ts
--
-- The lease must outlast the provider call or every refresh loses its own claim
-- mid-flight. The node budget must outlast a worker that waits for someone
-- else's lease AND then runs its own refresh AND then makes the real request
-- (60 + 20 + 20 = 100s, inside 120s). Changing any one of them without the
-- others reintroduces exactly the collision this migration exists to prevent.
--
-- WHICH STATUSES SELF-HEAL, AND WHICH DO NOT.
--
-- The claim is the ONLY policy gate; `integrations_replace_credential` checks
-- ownership, not eligibility. One decision, one place.
--
--   active                    claimable — the ordinary proactive refresh
--   expired                   claimable — this is what self-healing means
--   pending                   no — never completed an authorization
--   revoked                   no — deliberately ended
--   failed                    no — an operator decision put it there
--   requires_reauthorization  no — THE STATUS MEANS A HUMAN MUST ACT. Letting a
--                             workflow silently heal it would make the status a
--                             lie, and the remedy it names (a new authorization)
--                             is not something a refresh can perform anyway.
--
-- WHY `p_expires_at` MAY NOW BE NULL.
--
-- The previous version raised when it was null. That guard was stricter than
-- both the column (`expires_at timestamptz`, nullable since 20260916002343) and
-- the create path (`integrations_write_credential` has no such check), so a null
-- could already exist from day one — the guard did not establish an invariant,
-- it only made refresh fail on rows the create path was happy to make. A
-- partial guard is worse than none.
--
-- It was also wrong on its own terms. RFC 6749 §5.1 makes `expires_in`
-- RECOMMENDED, not REQUIRED: "If omitted, the authorization server SHOULD
-- provide the expiration time via other means or document the default value."
-- NULL means WE WERE NOT TOLD — not "no expiry" and not "expired". The
-- application refuses to invent a lifetime it does not have (see
-- `token-response.ts`), which is what `openid-client` does too.
--
-- The consequence, stated rather than discovered: a connection with a null
-- expiry has no PROACTIVE refresh trigger. It is carried by the reactive one —
-- a 401 from the provider. That is why this migration ships together with the
-- reactive path and not before it.
--
-- ROLLBACK:
--   drop function if exists public.integrations_release_credential_refresh(uuid, uuid, text, text);
--   drop function if exists public.integrations_claim_credential_refresh(uuid, text, text, integer);
--   drop function if exists public.integrations_replace_credential(uuid, text, text, text, timestamptz, uuid);
--   alter table public.integration_connections
--     drop column if exists refresh_lease_id,
--     drop column if exists refresh_lease_until;
--   -- then restore the five-argument form exactly as 20260916142159 left it:
--   --   signature  (uuid, text, text, text, timestamptz)
--   --   status set ('active','expired','failed','requires_reauthorization')
--   --   argument check INCLUDING `or p_expires_at is null`
--   --   no lease predicate, no lease clear
--   --   revoke execute from public, anon, authenticated; grant to service_role
--   Dropping the columns is safe: nothing references them by foreign key, and a
--   lease is transient state with no audit value.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The lease columns
-- ---------------------------------------------------------------------

alter table public.integration_connections
  add column if not exists refresh_lease_id    uuid,
  add column if not exists refresh_lease_until timestamptz;

comment on column public.integration_connections.refresh_lease_id is
  'Owner token for an in-flight credential refresh. Held across the provider HTTPS round-trip, which is why it is a row value and not an advisory lock.';
comment on column public.integration_connections.refresh_lease_until is
  'Lease expiry. A lease is live only while this is in the future, so a worker that dies mid-refresh blocks the next one for at most the TTL rather than forever.';

-- No index. The only predicate is `refresh_lease_until > now()` on a row already
-- located by primary key, so an index would be write cost with no read to serve.

-- ⚠️ NEW COLUMNS GET NO GRANT. The table-level UPDATE was revoked in
-- 20260916002651 and replaced with a column list, so a column added later is
-- simply not writable until it is named here. Without these two lines the claim
-- RPC fails with 42501 at runtime — and `create function` would not have caught
-- it, because plpgsql bodies are only syntax-checked.
grant update (refresh_lease_id, refresh_lease_until)
  on public.integration_connections to service_role;

-- ---------------------------------------------------------------------
-- 2. Claim — the only place that decides whether a refresh may happen
-- ---------------------------------------------------------------------

create or replace function public.integrations_claim_credential_refresh(
  p_connection_id      uuid,
  p_expected_provider  text,
  p_expected_kind      text,
  p_lease_seconds      integer default 60
)
returns table (outcome text, lease_id uuid, lease_until timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status      text;
  v_lease_until timestamptz;
  v_seconds     integer := least(greatest(coalesce(p_lease_seconds, 60), 10), 180);
  v_lease_id    uuid;
begin
  -- FOR UPDATE, so two workers arriving in the same instant serialize here and
  -- the second one reads the first one's lease rather than a stale row.
  select c.status, c.refresh_lease_until
    into v_status, v_lease_until
    from public.integration_connections c
   where c.id = p_connection_id
     and c.provider = p_expected_provider
     and c.credential_kind = p_expected_kind
   for update;

  if not found then
    return query select 'not_refreshable'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- See the header: this list is the whole self-healing policy.
  if v_status not in ('active', 'expired') then
    return query select 'not_refreshable'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if v_lease_until is not null and v_lease_until > now() then
    -- Someone else is mid-refresh. Reporting WHEN it expires lets the caller
    -- wait for a bounded time and re-read instead of guessing or spinning.
    return query select 'locked'::text, null::uuid, v_lease_until;
    return;
  end if;

  v_lease_id := gen_random_uuid();

  update public.integration_connections
     set refresh_lease_id    = v_lease_id,
         refresh_lease_until = now() + make_interval(secs => v_seconds)
   where id = p_connection_id;

  return query
    select 'claimed'::text, v_lease_id, now() + make_interval(secs => v_seconds);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Replace — ownership only, and a nullable expiry
-- ---------------------------------------------------------------------

-- Dropped rather than replaced: the argument list changes, and `create or
-- replace` with a different signature leaves an OVERLOAD behind. The old
-- five-argument form would stay callable and would still write without a lease,
-- which is precisely the hole this migration closes.
drop function if exists public.integrations_replace_credential(
  uuid, text, text, text, timestamptz
);

create or replace function public.integrations_replace_credential(
  p_connection_id      uuid,
  p_expected_provider  text,
  p_expected_kind      text,
  p_secret             text,
  p_expires_at         timestamptz,
  p_lease_id           uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  -- `p_expires_at` is deliberately absent from this check. See the header.
  if nullif(btrim(p_expected_provider), '') is null
     or nullif(btrim(p_expected_kind), '') is null
     or nullif(p_secret, '') is null
     or p_lease_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'connection refresh arguments are incomplete';
  end if;

  -- The lease must still be OURS and still be LIVE. Liveness is not pedantry: a
  -- lease that lapsed may have been re-claimed and completed by another worker,
  -- and writing here would replace a newer credential with an older one. The
  -- caller's remedy is to start the cycle again, not to force the write.
  select c.vault_secret_id
    into v_secret_id
    from public.integration_connections c
   where c.id = p_connection_id
     and c.provider = p_expected_provider
     and c.credential_kind = p_expected_kind
     and c.status <> 'revoked'
     and c.refresh_lease_id = p_lease_id
     and c.refresh_lease_until > now()
   for update;

  if v_secret_id is null then
    return false;
  end if;

  -- Explicit name and description, never NULL. The installed implementation
  -- preserves them on NULL via `coalesce(new_name, s.name)` — measured in
  -- pg_proc — but Supabase documents only the four-argument form, so this does
  -- not depend on behaviour it cannot cite. The values reproduce exactly what
  -- integrations_write_credential wrote, so this is a no-op for our own rows and
  -- a deliberate normalization for anything else.
  perform vault.update_secret(
    v_secret_id,
    p_secret,
    'conn:' || p_connection_id::text,
    'integration credential — ' || p_expected_provider
  );

  -- A token exchange that actually succeeded is authoritative evidence that the
  -- credential is usable again. The lease is cleared in the same statement, so
  -- there is no window in which the new token exists behind a stale claim.
  update public.integration_connections
     set status              = 'active',
         expires_at          = p_expires_at,
         last_refresh_at     = now(),
         last_error          = null,
         refresh_lease_id    = null,
         refresh_lease_until = null
   where id = p_connection_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Release — the failure path
-- ---------------------------------------------------------------------

create or replace function public.integrations_release_credential_refresh(
  p_connection_id  uuid,
  p_lease_id       uuid,
  p_next_status    text default null,
  p_last_error     text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_found boolean;
begin
  -- A closed set, not free text. A refresh that failed may conclude one of three
  -- things, and nothing else: it was a blip (leave the status alone and let the
  -- next attempt try), the grant is gone (a human must reauthorize), or the
  -- provider rejected us in a way that is neither (failed). Allowing an
  -- arbitrary status here would let a caller write 'active' after a failure.
  if p_next_status is not null
     and p_next_status not in ('requires_reauthorization', 'failed')
  then
    raise exception using
      errcode = '22023',
      message = 'unsupported refresh failure status';
  end if;

  update public.integration_connections
     set status              = coalesce(p_next_status, status),
         last_error          = coalesce(nullif(btrim(coalesce(p_last_error, '')), ''), last_error),
         refresh_lease_id    = null,
         refresh_lease_until = null
   where id = p_connection_id
     and refresh_lease_id = p_lease_id;

  get diagnostics v_found = row_count;
  return v_found;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. RPC execution boundary
-- ---------------------------------------------------------------------

revoke execute on function public.integrations_claim_credential_refresh(
  uuid, text, text, integer
) from public, anon, authenticated;

revoke execute on function public.integrations_replace_credential(
  uuid, text, text, text, timestamptz, uuid
) from public, anon, authenticated;

revoke execute on function public.integrations_release_credential_refresh(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.integrations_claim_credential_refresh(
  uuid, text, text, integer
) to service_role;

grant execute on function public.integrations_replace_credential(
  uuid, text, text, text, timestamptz, uuid
) to service_role;

grant execute on function public.integrations_release_credential_refresh(
  uuid, uuid, text, text
) to service_role;
