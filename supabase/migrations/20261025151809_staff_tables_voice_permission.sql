-- staff-tables-permission-rls, stage S3 (task 4.2): the manage_voice tables and the provider numbers.
--
-- call_dnc_list, call_compliance_settings and voice_purposes need manage_voice; provider_numbers and
-- provider_number_roles need manage_settings OR manage_voice (design D3, access map). Each gets one policy per operation
-- its data-layer module performs with the staff session (call-dnc.ts, voximplant-channel.ts, voice-purposes.ts,
-- provider-numbers.ts) and only those grants; today any platform staff member reaches the first four and the two
-- provider tables through the `is_platform_staff()` floor, and voice_purposes has one `for all` policy.
-- upsert_provider_number is SECURITY INVOKER, so its insert, update and on-conflict paths run under these policies.
--
-- voice_purpose_attempts is closed (design D1, D2): every reader and writer uses the service role, and the table holds
-- the bearer access_token of the public ctx route, which its manage_voice read policy let ops_engineer read.
--
-- WHAT IT DOES: revoke every privilege of anon and authenticated, drop the old policies, grant back the exact
-- operations and create the per-operation policies `to authenticated`; voice_purpose_attempts keeps no grant and no
-- policy. RLS stays on; service_role untouched. Proof: supabase/tests/database/s3_voice_test.sql (generated),
-- s3_voice_paths_test.sql (the data-layer shapes, the RPC paths, the seeded roles, the service-role statements of
-- voice_purpose_attempts) and 000-service-role_test.sql.
--
-- ROLLBACK (live catalog, read-only query of 25.10.2026; the local catalog was identical; anon held nothing on these
-- tables):
--   grant select, insert, update, delete, truncate, references, trigger, maintain on table public.call_dnc_list
--     to authenticated;
--   grant select, update on table public.call_compliance_settings to authenticated;
--   grant select, insert, update, delete on table public.voice_purposes, public.provider_numbers,
--     public.provider_number_roles to authenticated;
--   grant select on table public.voice_purpose_attempts to authenticated;
--   drop policy every <table>_<op>_permission policy created below;
--   create policy call_dnc_list_admin_all on public.call_dnc_list as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy call_compliance_settings_staff_all on public.call_compliance_settings as permissive for all
--     to authenticated using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy provider_numbers_admin_all on public.provider_numbers as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy provider_number_roles_admin_all on public.provider_number_roles as permissive for all
--     to authenticated using ((select is_platform_staff() as is_platform_staff))
--     with check ((select is_platform_staff() as is_platform_staff));
--   create policy voice_purposes_admin_all on public.voice_purposes as permissive for all to authenticated
--     using ((select has_platform_permission('manage_voice'::text) as has_platform_permission))
--     with check ((select has_platform_permission('manage_voice'::text) as has_platform_permission));
--   create policy voice_purpose_attempts_admin_read on public.voice_purpose_attempts as permissive for select
--     to authenticated using ((select has_platform_permission('manage_voice'::text) as has_platform_permission));

-- BEGIN GENERATED: scripts/gen-staff-table-rls.ts (do not edit between the marks)
-- call_dnc_list: per operation (design D3)
revoke all on table public."call_dnc_list" from anon, authenticated;
drop policy "call_dnc_list_admin_all" on public."call_dnc_list";
grant select, insert, update on table public."call_dnc_list" to authenticated;
create policy "call_dnc_list_select_permission" on public."call_dnc_list" for select to authenticated
  using ((select public.has_platform_permission('manage_voice')));
create policy "call_dnc_list_insert_permission" on public."call_dnc_list" for insert to authenticated
  with check ((select public.has_platform_permission('manage_voice')));
create policy "call_dnc_list_update_permission" on public."call_dnc_list" for update to authenticated
  using ((select public.has_platform_permission('manage_voice')))
  with check ((select public.has_platform_permission('manage_voice')));

-- call_compliance_settings: per operation (design D3)
revoke all on table public."call_compliance_settings" from anon, authenticated;
drop policy "call_compliance_settings_staff_all" on public."call_compliance_settings";
grant select, update on table public."call_compliance_settings" to authenticated;
create policy "call_compliance_settings_select_permission" on public."call_compliance_settings" for select to authenticated
  using ((select public.has_platform_permission('manage_voice')));
create policy "call_compliance_settings_update_permission" on public."call_compliance_settings" for update to authenticated
  using ((select public.has_platform_permission('manage_voice')))
  with check ((select public.has_platform_permission('manage_voice')));

-- voice_purposes: per operation (design D3)
revoke all on table public."voice_purposes" from anon, authenticated;
drop policy "voice_purposes_admin_all" on public."voice_purposes";
grant select, insert, update on table public."voice_purposes" to authenticated;
create policy "voice_purposes_select_permission" on public."voice_purposes" for select to authenticated
  using ((select public.has_platform_permission('manage_voice')));
create policy "voice_purposes_insert_permission" on public."voice_purposes" for insert to authenticated
  with check ((select public.has_platform_permission('manage_voice')));
create policy "voice_purposes_update_permission" on public."voice_purposes" for update to authenticated
  using ((select public.has_platform_permission('manage_voice')))
  with check ((select public.has_platform_permission('manage_voice')));

-- provider_numbers: per operation (design D3)
revoke all on table public."provider_numbers" from anon, authenticated;
drop policy "provider_numbers_admin_all" on public."provider_numbers";
grant select, insert, update on table public."provider_numbers" to authenticated;
create policy "provider_numbers_select_permission" on public."provider_numbers" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));
create policy "provider_numbers_insert_permission" on public."provider_numbers" for insert to authenticated
  with check ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));
create policy "provider_numbers_update_permission" on public."provider_numbers" for update to authenticated
  using ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')))
  with check ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));

-- provider_number_roles: per operation (design D3)
revoke all on table public."provider_number_roles" from anon, authenticated;
drop policy "provider_number_roles_admin_all" on public."provider_number_roles";
grant select, insert, update, delete on table public."provider_number_roles" to authenticated;
create policy "provider_number_roles_select_permission" on public."provider_number_roles" for select to authenticated
  using ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));
create policy "provider_number_roles_insert_permission" on public."provider_number_roles" for insert to authenticated
  with check ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));
create policy "provider_number_roles_update_permission" on public."provider_number_roles" for update to authenticated
  using ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')))
  with check ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));
create policy "provider_number_roles_delete_permission" on public."provider_number_roles" for delete to authenticated
  using ((select public.has_platform_permission('manage_settings')) or (select public.has_platform_permission('manage_voice')));

-- voice_purpose_attempts: closed, service role only (design D2)
revoke all on table public."voice_purpose_attempts" from anon, authenticated;
drop policy "voice_purpose_attempts_admin_read" on public."voice_purpose_attempts";
-- END GENERATED
