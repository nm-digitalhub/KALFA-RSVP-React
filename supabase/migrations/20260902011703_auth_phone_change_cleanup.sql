-- Cleanup for abandoned phone-change attempts in auth.users.
--
-- WHY (Supabase's own troubleshooting guide, "Unexpected behavior with
-- auth.updateUser({ phone })"): phone verification finds the user by SEARCHING
-- auth.users FOR THE NUMBER in the `phone_change` column, not by the active
-- session. `phone` is UNIQUE; `phone_change` is NOT. So when two rows hold the
-- same pending number — which happens whenever someone starts a phone change
-- and never enters the code, because nothing expires `phone_change` — a
-- successful OTP can land the number on the WRONG account. The guide's
-- prescribed fix is application-level cleanup of stale values, which is what
-- this is.
--
-- Measured here 2026-09-02: one row had carried a pending 972536212562 since
-- 03:37 IDT while a different profile already held that same number.
--
-- WHY A FUNCTION AT ALL: auth.users is owned by supabase_auth_admin and is not
-- in PostgREST's exposed schemas, so the app cannot reach it. Verified live:
--
--   postgres_can_update      = true
--   service_role_can_update  = false
--   authenticated_can_update = false
--
-- SECURITY DEFINER is therefore the only path, and it is the ONLY privilege
-- this migration hands out. It is deliberately narrow: it takes no user id,
-- returns no row from auth.users — only a count — and can touch nothing but
-- the three phone_change columns.

create or replace function public.purge_stale_phone_change(
  p_grace interval default interval '24 hours'
)
returns integer
language plpgsql
-- Per the Supabase docs: "If you ever use security definer, you must set the
-- search_path." Empty, so every relation below is schema-qualified. pg_catalog
-- is always implicitly searched, which is what now() and the operators resolve
-- against.
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Floor the grace period. Supabase caps OTP validity at 86400 seconds
  -- ("An expiry duration of more than 86400 seconds (one day) is disallowed"),
  -- so a 24h minimum CANNOT truncate a live challenge no matter how this
  -- project's SMS OTP expiry is configured — the guard needs no coupling to
  -- that setting, and a caller cannot weaken it.
  if p_grace < interval '24 hours' then
    raise exception 'purge_stale_phone_change: grace period must be at least 24 hours, got %', p_grace
      using errcode = 'check_violation';
  end if;

  update auth.users u
  set phone_change         = '',
      phone_change_token   = '',
      phone_change_sent_at = null
  where u.phone_change is not null
    and u.phone_change <> ''
    -- sent_at is the age of the attempt. A committed row with a pending number
    -- but no sent_at is not a shape GoTrue writes; fall back to the row's own
    -- updated_at so such a row is aged rather than either skipped forever or
    -- cleared while fresh.
    and coalesce(u.phone_change_sent_at, u.updated_at) < now() - p_grace;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.purge_stale_phone_change(interval) is
  'Clears abandoned auth.users.phone_change attempts older than the grace period (minimum 24h). Prevents the ambiguous phone_change lookup that can attach a verified number to the wrong account. Returns the number of rows cleared. service_role only.';

-- "By default, database functions can be executed by any role" — so the grant
-- has to be taken away before it is given. anon and authenticated are named
-- explicitly, as the docs instruct, because revoking from PUBLIC alone does
-- not remove a privilege already held directly by a role.
revoke all on function public.purge_stale_phone_change(interval) from public;
revoke all on function public.purge_stale_phone_change(interval) from anon;
revoke all on function public.purge_stale_phone_change(interval) from authenticated;

-- The worker's admin client, and nothing else.
grant execute on function public.purge_stale_phone_change(interval) to service_role;
