-- Two hardening fixes, both the SAME trap already closed on the platform_* tables
-- in 20260719212652: a privilege the app never uses, left armed for a future mistake.
-- Both verified safe in a rolled-back transaction before writing this.

-- ============================================================================
-- A. grant_new_permission_to_owner() — a SECURITY DEFINER TRIGGER function that
--    was callable directly by anon/authenticated over /rest/v1/rpc/.
--
--    Introduced tonight (20260719215138) as the AFTER INSERT trigger that grants
--    each newly-catalogued permission to the owner role. Supabase's own advisor
--    (lint 0028) flagged it: a SECDEF function exposed to `anon`. A direct RPC
--    call outside a trigger context would likely error (no NEW row), but a
--    SECDEF function that writes to platform_role_permissions must not be in the
--    public API surface at all.
--
--    Verified (rolled-back txn): after this revoke the trigger STILL fires on a
--    real INSERT (owner auto-grant = true) — trigger functions are invoked by the
--    system, not by the inserting role's EXECUTE grant — and anon can no longer
--    call it (has_function_privilege = false).
--
--    Also pin search_path to empty with fully-qualified refs (the documented
--    SECDEF hardening: closes the classic search-path-shadowing vector). The body
--    already fully-qualifies public.*, so '' is safe.
-- ============================================================================
create or replace function public.grant_new_permission_to_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.platform_role_permissions (role_id, permission_id)
  select r.id, new.id from public.platform_roles r where r.is_owner_role
  on conflict (role_id, permission_id) do nothing;
  return new;
end;
$function$;

revoke execute on function public.grant_new_permission_to_owner() from anon, authenticated, public;

-- ============================================================================
-- B. support_access_log — the staff-access AUDIT table had the identical
--    anon/authenticated DML grant defect that `platform_role_audit_log` had
--    (its 20260713183221 migration revoked from `authenticated` but missed
--    `anon`). Verified live: anon holds INSERT/UPDATE/DELETE/TRUNCATE.
--
--    Latent, not active (anon is rolcanlogin=false, PostgREST emits no TRUNCATE,
--    and the table has 0 write policies so writes fall through to deny). But this
--    is the table that makes staff data-access observable — the one place the
--    grant-half of the trap is least acceptable. The Step-2 audit layer will add
--    a write path here; close the grant BEFORE that lands so the trail can never
--    be forged.
--
--    Verified safe: the only writer is src/lib/data/admin/support.ts (L103, L239)
--    via createAdminClient (service_role, unaffected). SELECT is left intact for
--    the owner-select policy.
-- ============================================================================
revoke insert, update, delete, truncate
  on table public.support_access_log
  from anon, authenticated;
