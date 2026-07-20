-- Console agent layer: restore two deviations from the house hardening pattern.
--
-- Nothing here is a new idea. Both halves put the console layer back onto the
-- shape the rest of this schema already uses; both were attempted before and
-- landed incomplete.
--
-- ---------------------------------------------------------------------------
-- PART A -- the anon revoke that never took effect
--
-- 20260720025745 ran `revoke execute on function public.is_console_agent()
-- from anon`. That was a NO-OP: a function is created with EXECUTE granted to
-- PUBLIC, and `anon` inherits PUBLIC. Revoking from the role while PUBLIC still
-- holds the privilege changes nothing. Verified live before this migration:
--   proacl  = {=X/postgres, postgres=X, authenticated=X, service_role=X}
--             ^^ the `=X` entry IS the PUBLIC grant
--   has_function_privilege('anon','public.is_console_agent()','EXECUTE') = true
-- The same no-op applies to sync_console_call_feed().
--
-- This is the ONLY one of the five gate functions in this schema carrying a
-- PUBLIC grant. Its four siblings -- is_staff(), is_platform_owner(),
-- has_platform_permission(), is_org_owner() -- were all correctly revoked
-- `from public` (20260713171233, 20260713203826) and share the identical ACL
-- {postgres=X, authenticated=X, service_role=X}. This restores the fifth to it.
-- Matches Supabase's own guidance (docs guides/database/functions): revoking
-- from `public` and from `anon` are two separate, both-required steps.
--
-- NOT EXPLOITABLE TODAY, which is why this is hygiene and not an incident:
--   * is_console_agent() returns false for anon (auth.uid() is null), and
--   * sync_console_call_feed() RETURNS trigger -- calling it directly raises
--     0A000 "trigger functions can only be called as triggers" (verified live).
-- It is fixed because the single-layer assumption is what eventually bites.
--
-- SAFE, verified live before applying -- nothing depends on anon holding it:
--   * all 7 RLS policies invoking is_console_agent() are scoped `to authenticated`;
--   * none of the 6 console_* views is anon-selectable (has_table_privilege
--     ('anon', view, 'SELECT') = false on all six); and
--   * those views are owned by postgres with security_invoker = false, so the
--     in-view call executes as the owner regardless of the caller's grants.
--
-- ---------------------------------------------------------------------------
-- PART B -- the grant strip that was deferred and then forgotten
--
-- 20260720193844 stripped the write privileges off the six console VIEWS but
-- explicitly deferred the three console BASE TABLES ("their own grants are
-- reviewed with the pending human_agent_call_legs migration"). That follow-up
-- (20260720190000) hardened only human_agent_call_legs. The three base tables
-- were never revisited and still carry the schema defaults, verified live:
--   console_agents / agent_status / console_call_feed
--     = {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
-- versus the hardened sibling human_agent_call_legs = {..., authenticated=arw}.
-- Note `anon` holds full table privileges on all three.
--
-- Not currently reachable -- RLS is enabled on all three and there is no
-- permissive INSERT/DELETE policy, so writes are refused -- but that leaves RLS
-- as the ONLY layer, which this project's own standard rejects ("RLS is an
-- additional defense layer, not a replacement for server-side authorization").
--
-- Grants below are tailored to what each table's EXISTING policies actually
-- need, so this removes capability without removing function:
--   console_agents    -- policies: SELECT only            -> select
--   agent_status      -- policies: SELECT, INSERT, UPDATE -> select, insert, update
--   console_call_feed -- policies: SELECT, UPDATE         -> select, update
-- No application code reads these tables directly (only generated types
-- reference them), and the views reach them as postgres.
--
-- ROLLBACK:
--   grant execute on function public.is_console_agent()       to public;
--   grant execute on function public.sync_console_call_feed() to public;
--   grant all on public.console_agents, public.agent_status,
--                public.console_call_feed to anon, authenticated;

-- ============================ PART A =======================================
revoke execute on function public.is_console_agent()       from public, anon;
revoke execute on function public.sync_console_call_feed() from public;

-- ============================ PART B =======================================
revoke all on public.console_agents, public.agent_status, public.console_call_feed
  from anon, authenticated;

grant select                 on public.console_agents    to authenticated;
grant select, insert, update on public.agent_status      to authenticated;
grant select, update         on public.console_call_feed to authenticated;
