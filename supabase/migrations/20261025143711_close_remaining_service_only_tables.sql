-- staff-tables-permission-rls, stage S2 (task 3.2): close the remaining service-only staff tables.
--
-- workflows, workflow_runs, workflow_run_events, workflow_run_steps (workflow definitions and run history),
-- webhook_deliveries, outreach_template_failures, vox_log_exports. Every reader and writer in the code uses the
-- service-role client (re-checked 25.10.2026: no createClient() or browser client in any file under src/, worker/,
-- scripts/, supabase/functions/ that names one of them); no view and no Realtime publication reads them; the two
-- functions that name them (integrations_delete_credential, wake_parked_workflow_run) are not executable by
-- authenticated. Today any signed-in platform staff member reaches them through PostgREST, and four of the policies are
-- scoped `to public`.
--
-- WHAT IT DOES (design D2): revoke every privilege of anon and authenticated, drop the staff policy, keep RLS on;
-- service_role untouched. Proof: supabase/tests/database/s2_closed_rest_test.sql and 000-service-role_test.sql.
--
-- ROLLBACK (live catalog, read-only query of 25.10.2026; the local catalog was identical; anon held nothing on these
-- tables):
--   grant select, insert, update, delete, truncate, references, trigger, maintain
--     on table public.outreach_template_failures, public.vox_log_exports to authenticated;
--   grant select, insert, update, delete on table public.workflows to authenticated;
--   grant select on table public.workflow_runs, public.workflow_run_events, public.workflow_run_steps,
--     public.webhook_deliveries to authenticated;
--   create policy outreach_template_failures_admin_all on public.outreach_template_failures as permissive for all
--     to authenticated using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy vox_log_exports_admin_read on public.vox_log_exports as permissive for select to authenticated
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy webhook_deliveries_admin_select on public.webhook_deliveries as permissive for select to public
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy workflow_run_events_admin_read on public.workflow_run_events as permissive for select to public
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy workflow_run_steps_admin_read on public.workflow_run_steps as permissive for select to public
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy workflow_runs_admin_read on public.workflow_runs as permissive for select to public
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy workflows_admin_all on public.workflows as permissive for all to public
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));

-- BEGIN GENERATED: scripts/gen-staff-table-rls.ts (do not edit between the marks)
-- workflows: closed, service role only (design D2)
revoke all on table public."workflows" from anon, authenticated;
drop policy "workflows_admin_all" on public."workflows";

-- workflow_runs: closed, service role only (design D2)
revoke all on table public."workflow_runs" from anon, authenticated;
drop policy "workflow_runs_admin_read" on public."workflow_runs";

-- workflow_run_events: closed, service role only (design D2)
revoke all on table public."workflow_run_events" from anon, authenticated;
drop policy "workflow_run_events_admin_read" on public."workflow_run_events";

-- workflow_run_steps: closed, service role only (design D2)
revoke all on table public."workflow_run_steps" from anon, authenticated;
drop policy "workflow_run_steps_admin_read" on public."workflow_run_steps";

-- webhook_deliveries: closed, service role only (design D2)
revoke all on table public."webhook_deliveries" from anon, authenticated;
drop policy "webhook_deliveries_admin_select" on public."webhook_deliveries";

-- outreach_template_failures: closed, service role only (design D2)
revoke all on table public."outreach_template_failures" from anon, authenticated;
drop policy "outreach_template_failures_admin_all" on public."outreach_template_failures";

-- vox_log_exports: closed, service role only (design D2)
revoke all on table public."vox_log_exports" from anon, authenticated;
drop policy "vox_log_exports_admin_read" on public."vox_log_exports";
-- END GENERATED
