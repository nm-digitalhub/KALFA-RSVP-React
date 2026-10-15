-- upsert_provider_number: `anon` must not be able to EXECUTE it.
--
-- 20260910201730 and 20260910212159 declare the intent: "revoke from PUBLIC, grant only to
-- `authenticated`". That does not remove an EXPLICIT grant to `anon`: at the time the function was
-- created the project's default privileges gave every new function an explicit EXECUTE for `anon`,
-- `authenticated` and `service_role` (see 20261013030310), and `revoke ... from public` only removes
-- PUBLIC's own entry. Measured on the live catalog, 15.10.2026:
--   proacl = {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- It is the only non-trigger function in `public` that `anon` can execute (the other 17 anon-executable
-- functions return `trigger` and cannot be called through /rest/v1/rpc).
--
-- BEHAVIOUR-NEUTRAL. The only caller is src/lib/data/admin/integrations/provider-numbers.ts, which calls
-- it through the cookie session client (createClient) after requirePlatformPermission, i.e. as
-- `authenticated`; `authenticated` and `service_role` keep EXECUTE. The function is SECURITY INVOKER
-- and `anon` has no privilege on provider_numbers (20261013030533), so an anonymous call already failed
-- with a permission error; this removes it from the callable surface instead of relying on that.
--
-- ROLLBACK:
--   grant execute on function public.upsert_provider_number(
--     public.provider_key, text, text, text, boolean, jsonb, text) to anon;

revoke execute on function public.upsert_provider_number(
  public.provider_key, text, text, text, boolean, jsonb, text
) from public, anon;
