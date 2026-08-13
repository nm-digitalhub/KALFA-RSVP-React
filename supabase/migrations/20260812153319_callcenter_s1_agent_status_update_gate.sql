-- Browser call-center stage 1 (gate A), hardening 3/4: agent_status UPDATE gate.
--
-- Live state (pg_policies, 2026-08-12): agent_status_update_own checks only
-- agent_id = auth.uid() — unlike the INSERT policy, it lacks is_console_agent().
-- The FK chain makes a non-agent row impossible today, so this is defense in
-- depth: align UPDATE with INSERT so a de-enrolled (but still authenticated)
-- user can never keep flipping their old presence row.
drop policy agent_status_update_own on public.agent_status;
create policy agent_status_update_own on public.agent_status
  for update to authenticated
  using ((agent_id = (select auth.uid())) and is_console_agent())
  with check ((agent_id = (select auth.uid())) and is_console_agent());
