-- fleet_owner_request: take back the EXECUTE that the schema defaults handed to
-- `anon`.
--
-- The previous migration ended with `revoke all on function … from public` and
-- an explicit grant to `authenticated`, which reads as least-privilege but is
-- not: Supabase's default privileges on the public schema grant EXECUTE to
-- anon / authenticated / service_role on every new function, and revoking from
-- PUBLIC does not touch a grant made explicitly to a named role. Measured
-- immediately after that migration applied:
--
--   has_function_privilege('anon', …, 'EXECUTE')  →  true
--
-- NOT a live exposure, and this is not a breach response: the function's first
-- statement is `if not has_role(auth.uid(), 'admin')` and anon has no
-- auth.uid(), so the call raises `fleet_owner_request: admin only` before
-- touching a row — verified empirically through the pooler, where auth.uid()
-- is likewise null.
--
-- The problem is that the admin check would then be the ONLY thing standing
-- there, on a function whose whole purpose is to INSERT into the append-only
-- owner<->fleet ledger. This repository has already shipped that exact shape
-- twice (20260720193844 reopened by 20260721133850; app_settings in
-- 20260721193019) — "the defaults were never revoked" is a recurring hole
-- here, not a hypothetical one. Two layers, not one.

revoke execute on function
  public.fleet_owner_request(text, text, smallint, text, text, uuid)
  from anon;
