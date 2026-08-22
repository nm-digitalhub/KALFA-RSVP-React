-- Wrap auth.uid() in (select ...) in the 9 policies flagged by the
-- auth_rls_initplan performance lint (Supabase database-linter 0003), so the
-- function runs once per query instead of once per row. Expressions are
-- otherwise byte-identical to the live definitions (pg_policies, 2026-08-22);
-- no security change. Aligns with the existing convention already used by
-- e.g. events_owner_delete.

drop policy "cm_insert_authenticated" on public.contact_messages;
create policy "cm_insert_authenticated" on public.contact_messages
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy "cb_insert_authenticated" on public.callback_requests;
create policy "cb_insert_authenticated" on public.callback_requests
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and triage_status = 'pending'::text
    and triage_attempt_count = 0
    and triaged_at is null
    and triage_last_error is null
    and not_before_min is null
    and not_after_min is null
    and excluded_dates is null
    and triage is null
  );

drop policy "console_chat_messages_insert" on public.console_chat_messages;
create policy "console_chat_messages_insert" on public.console_chat_messages
  for insert to authenticated
  with check (is_console_agent() and author_id = (select auth.uid()));

drop policy "console_agent_shift_upsert_own" on public.console_agent_shift;
create policy "console_agent_shift_upsert_own" on public.console_agent_shift
  for insert to authenticated
  with check (agent_id = (select auth.uid()) and is_console_agent());

drop policy "console_agent_shift_update_own" on public.console_agent_shift;
create policy "console_agent_shift_update_own" on public.console_agent_shift
  for update to authenticated
  using (agent_id = (select auth.uid()))
  with check (agent_id = (select auth.uid()));

drop policy "agent_status_upsert_own" on public.agent_status;
create policy "agent_status_upsert_own" on public.agent_status
  for insert to authenticated
  with check (agent_id = (select auth.uid()) and is_console_agent());

drop policy "fleet_requests_admin_select" on public.fleet_requests;
create policy "fleet_requests_admin_select" on public.fleet_requests
  for select
  using (has_role((select auth.uid()), 'admin'::app_role));

drop policy "fleet_request_slack_threads_admin_select" on public.fleet_request_slack_threads;
create policy "fleet_request_slack_threads_admin_select" on public.fleet_request_slack_threads
  for select
  using (has_role((select auth.uid()), 'admin'::app_role));

drop policy "call_dnc_list_admin_all" on public.call_dnc_list;
create policy "call_dnc_list_admin_all" on public.call_dnc_list
  for all to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role))
  with check (has_role((select auth.uid()), 'admin'::app_role));
