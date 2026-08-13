-- Browser call-center stage 1 (gate A), hardening 4/4: human_agent_call_legs
-- client writes.
--
-- The contract (docs/agent-console-api-contract.md, 2026-07-22 addendum) and the
-- DAL itself (src/lib/data/console-monitor.ts: "written only through the
-- service-role client here") say server routes + the scenario cb write legs; the
-- client only records its own device facts. Live state (pg_policies, 2026-08-12)
-- still allowed client INSERT and a column-unrestricted own-row UPDATE.
-- All server paths verified on createAdminClient — unaffected by this.
-- CAVEAT: the Android console app is a separate repo (nm-digitalhub/
-- KALFA-ELEVENLABS) and was not grepped from here; per the contract it does not
-- INSERT legs directly. If it did, this surfaces as 42501 in its logs — the
-- documented contract wins.
drop policy human_agent_call_legs_insert_own on public.human_agent_call_legs;
revoke insert on table public.human_agent_call_legs from authenticated;

revoke update on table public.human_agent_call_legs from authenticated;
grant update (vox_sdk_call_id, device_id)
  on table public.human_agent_call_legs to authenticated;
-- The own-row UPDATE policy (human_agent_call_legs_update_own) stays: rows are
-- still only touchable by their own agent, and now only in the two device
-- columns the contract assigns to the client.
