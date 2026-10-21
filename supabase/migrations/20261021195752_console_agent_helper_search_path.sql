-- harden-console-agent-permissions, stage S3: is_console_agent() gets an empty search_path, and the monitor-leg update policy
-- requires an active agent like every other client write policy on the console.
--
-- WHY.
--   - is_console_agent() is SECURITY DEFINER with search_path=public (live on production and local, 21.10.2026). Its body is
--     already fully qualified (public.is_staff(), public.console_agents, auth.uid()), so an empty search_path changes no
--     result and removes the unqualified-lookup surface of a definer function (advisor function_search_path_mutable class).
--     The two console helpers added in S1/S2 already use search_path = ''.
--   - human_agent_call_legs_update_own checked ownership only (agent_id = auth.uid()). Authenticated holds UPDATE on
--     device_id and vox_sdk_call_id, which the app writes on its own monitor leg (docs/voice-agent/app-integration-reference.md
--     §7). An inactive agent could still change its own leg with an UPDATE without WHERE in raw SQL (executed on the local
--     database, 21.10.2026). It was the only client write policy on a console object without is_console_agent() (pg_policies).
--     Same fix as console_agent_shift_update_own in 20261021194728.
--
-- ROLLBACK (live definitions read 21.10.2026, identical on production and local):
--   alter function public.is_console_agent() set search_path = public;
--   alter policy human_agent_call_legs_update_own on public.human_agent_call_legs
--     using (agent_id = (select auth.uid())) with check (agent_id = (select auth.uid()));

alter function public.is_console_agent() set search_path = '';

alter policy human_agent_call_legs_update_own on public.human_agent_call_legs
  using (agent_id = (select auth.uid()) and (select public.is_console_agent()))
  with check (agent_id = (select auth.uid()) and (select public.is_console_agent()));
