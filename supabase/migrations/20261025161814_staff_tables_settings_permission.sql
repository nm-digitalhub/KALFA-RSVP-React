-- staff-tables-permission-rls, stage S5 (task 6.3): the manage_settings tables, per operation.
--
-- message_templates, channels, faq_items, callback_schedule_policies, ops_alerts, fleet_requests, fleet_goals and
-- fleet_request_slack_threads: each gets one policy per operation its data-layer module performs with the staff
-- session (message-templates.ts, admin/channel-catalog.ts, admin/faq.ts, callbacks/policy/actions.ts with
-- policy-config-admin.ts, admin/alerts.ts, admin/fleet.ts; every one gates on manage_settings first) and only those
-- grants. Today any platform staff member reaches them through the `is_platform_staff()` floor, and four of the policies
-- (`channels_admin_all` and the three fleet select policies) are scoped `to public`.
--
-- Kept as they are (design D5): channels_auth_read (SELECT for any signed-in user; channel-catalog.ts) and
-- faq_items_public_read (SELECT for anon and authenticated, published rows; faq.ts); anon keeps SELECT on faq_items
-- only. The fleet tables are written only through the fleet_* SECURITY DEFINER RPCs, gated on manage_settings since
-- 20261015114659, so they grant SELECT only. ops_alerts is also read by app-health.ts for /admin/debug, which is
-- owner-only (the owner holds every key). Every other reader is the service role.
--
-- WHAT IT DOES: revoke every privilege of anon and authenticated, drop the old policies, grant back the exact
-- operations and create the per-operation policies `to authenticated`. RLS stays on; service_role untouched. Proof:
-- supabase/tests/database/s5_settings_test.sql (generated), s5_settings_paths_test.sql, 000-service-role_test.sql and
-- src/lib/auth/staff-table-sql-consistency.test.ts.
--
-- ROLLBACK (live catalog, read-only query of 25.10.2026; the local catalog was identical):
--   grant select, insert, update, delete, truncate, references, trigger, maintain
--     on table public.message_templates, public.ops_alerts to authenticated;
--   grant select, insert, update, delete on table public.channels, public.faq_items to authenticated;
--   grant select on table public.faq_items to anon;
--   grant select, update on table public.callback_schedule_policies to authenticated;
--   grant select on table public.fleet_requests, public.fleet_goals, public.fleet_request_slack_threads to authenticated;
--   drop policy every <table>_<op>_permission policy created below;
--   create policy message_templates_admin_all on public.message_templates as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy channels_admin_all on public.channels as permissive for all to public
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy faq_items_admin_all on public.faq_items as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy callback_schedule_policies_admin_all on public.callback_schedule_policies as permissive for all
--     to authenticated using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy ops_alerts_admin_select on public.ops_alerts as permissive for select to authenticated
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy fleet_requests_admin_select on public.fleet_requests as permissive for select to public
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy fleet_goals_admin_select on public.fleet_goals as permissive for select to public
--     using ((select is_platform_staff() as is_platform_staff));
--   create policy fleet_request_slack_threads_admin_select on public.fleet_request_slack_threads as permissive
--     for select to public using ((select is_platform_staff() as is_platform_staff));
--   channels_auth_read and faq_items_public_read are not touched.

-- BEGIN GENERATED: scripts/gen-staff-table-rls.ts (do not edit between the marks)
-- message_templates: per operation (design D3)
revoke all on table public."message_templates" from anon, authenticated;
drop policy "message_templates_admin_all" on public."message_templates";
grant select, update on table public."message_templates" to authenticated;
create policy "message_templates_select_permission" on public."message_templates" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));
create policy "message_templates_update_permission" on public."message_templates" for update to authenticated
  using ((select public.has_platform_permission('manage_settings')))
  with check ((select public.has_platform_permission('manage_settings')));

-- channels: per operation (design D3)
revoke all on table public."channels" from anon, authenticated;
drop policy "channels_admin_all" on public."channels";
grant select, update on table public."channels" to authenticated;
create policy "channels_select_permission" on public."channels" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));
create policy "channels_update_permission" on public."channels" for update to authenticated
  using ((select public.has_platform_permission('manage_settings')))
  with check ((select public.has_platform_permission('manage_settings')));

-- faq_items: per operation (design D3)
revoke all on table public."faq_items" from anon, authenticated;
drop policy "faq_items_admin_all" on public."faq_items";
grant select, insert, update, delete on table public."faq_items" to authenticated;
grant select on table public."faq_items" to anon;
create policy "faq_items_select_permission" on public."faq_items" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));
create policy "faq_items_insert_permission" on public."faq_items" for insert to authenticated
  with check ((select public.has_platform_permission('manage_settings')));
create policy "faq_items_update_permission" on public."faq_items" for update to authenticated
  using ((select public.has_platform_permission('manage_settings')))
  with check ((select public.has_platform_permission('manage_settings')));
create policy "faq_items_delete_permission" on public."faq_items" for delete to authenticated
  using ((select public.has_platform_permission('manage_settings')));

-- callback_schedule_policies: per operation (design D3)
revoke all on table public."callback_schedule_policies" from anon, authenticated;
drop policy "callback_schedule_policies_admin_all" on public."callback_schedule_policies";
grant select, update on table public."callback_schedule_policies" to authenticated;
create policy "callback_schedule_policies_select_permission" on public."callback_schedule_policies" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));
create policy "callback_schedule_policies_update_permission" on public."callback_schedule_policies" for update to authenticated
  using ((select public.has_platform_permission('manage_settings')))
  with check ((select public.has_platform_permission('manage_settings')));

-- ops_alerts: per operation (design D3)
revoke all on table public."ops_alerts" from anon, authenticated;
drop policy "ops_alerts_admin_select" on public."ops_alerts";
grant select on table public."ops_alerts" to authenticated;
create policy "ops_alerts_select_permission" on public."ops_alerts" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));

-- fleet_requests: per operation (design D3)
revoke all on table public."fleet_requests" from anon, authenticated;
drop policy "fleet_requests_admin_select" on public."fleet_requests";
grant select on table public."fleet_requests" to authenticated;
create policy "fleet_requests_select_permission" on public."fleet_requests" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));

-- fleet_goals: per operation (design D3)
revoke all on table public."fleet_goals" from anon, authenticated;
drop policy "fleet_goals_admin_select" on public."fleet_goals";
grant select on table public."fleet_goals" to authenticated;
create policy "fleet_goals_select_permission" on public."fleet_goals" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));

-- fleet_request_slack_threads: per operation (design D3)
revoke all on table public."fleet_request_slack_threads" from anon, authenticated;
drop policy "fleet_request_slack_threads_admin_select" on public."fleet_request_slack_threads";
grant select on table public."fleet_request_slack_threads" to authenticated;
create policy "fleet_request_slack_threads_select_permission" on public."fleet_request_slack_threads" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')));
-- END GENERATED
