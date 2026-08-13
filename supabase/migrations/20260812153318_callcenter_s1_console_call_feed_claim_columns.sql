-- Browser call-center stage 1 (gate A), hardening 2/4: console_call_feed UPDATE.
--
-- Live state (pg_policies, 2026-08-12): console_call_feed_update_agent is a bare
-- is_console_agent() USING+CHECK with a table-wide UPDATE grant — any enrolled
-- agent could rewrite status/finish_reason/rsvp_digit on ANY row. The feed's
-- writable surface for agents is the takeover-claim columns only; everything
-- else is written by the call_attempts sync trigger and server routes.
revoke update on table public.console_call_feed from authenticated;
grant update (handled_by, agent_id, takeover_claimed_at, takeover_request_id, participation_state)
  on table public.console_call_feed to authenticated;

drop policy console_call_feed_update_agent on public.console_call_feed;
create policy console_call_feed_update_agent on public.console_call_feed
  for update to authenticated
  using (is_console_agent() and (agent_id is null or agent_id = (select auth.uid())))
  with check (is_console_agent() and agent_id = (select auth.uid()));
-- WITH CHECK pins the claimed row to the claiming agent, so claim-release
-- (agent_id back to NULL) is deliberately impossible for clients — release is a
-- server (service-role) operation.
