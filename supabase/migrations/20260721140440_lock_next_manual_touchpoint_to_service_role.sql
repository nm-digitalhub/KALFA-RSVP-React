-- next_manual_touchpoint: revoke EXECUTE from anon and authenticated.
--
-- Flagged by `supabase db advisors --linked --type security` (lint 0028,
-- anon_security_definer_function_executable) against the live database:
--
--   Function `public.next_manual_touchpoint(p_campaign uuid, p_contact uuid)`
--   can be executed by the `anon` role as a `SECURITY DEFINER` function via
--   `/rest/v1/rpc/next_manual_touchpoint`.
--
-- It is an INTERNAL allocator, not an API. Its only caller is the dispatcher,
-- through the service-role client (src/lib/data/call-attempts.ts:67); nothing in
-- the browser or the console app calls it, and nothing should. It reached anon
-- the same way the console views reached `authenticated` with write rights: the
-- creating migration (20260721100426) simply never revoked, and Supabase's
-- default privileges grant EXECUTE on new functions to PUBLIC — which anon and
-- authenticated inherit.
--
-- Exposure while it was open: no writes (the function only SELECTs max(...) and
-- returns an integer), but it did let an unauthenticated caller probe whether a
-- given (campaign, contact) pair has manual call attempts — the return value is
-- 900000 for none and higher once dials exist — and take a transaction-scoped
-- advisory lock on an arbitrary pair.
--
-- The sibling SECDEF written for P0-1, reconcile_authorized_set, is already
-- correctly locked (anon/authenticated EXECUTE = false, service_role = true),
-- so this migration brings the newer function to the posture the older one
-- already sets. Verified live before and after.
revoke execute on function public.next_manual_touchpoint(uuid, uuid) from public;
revoke execute on function public.next_manual_touchpoint(uuid, uuid) from anon;
revoke execute on function public.next_manual_touchpoint(uuid, uuid) from authenticated;

-- Restate the only role that may call it, so a future default-privileges change
-- cannot leave the dispatcher without EXECUTE.
grant execute on function public.next_manual_touchpoint(uuid, uuid) to service_role;
