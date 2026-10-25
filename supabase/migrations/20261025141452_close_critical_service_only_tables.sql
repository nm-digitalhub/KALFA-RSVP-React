-- staff-tables-permission-rls, stage S1 (task 2.2): close the three critical service-only tables.
--
-- otp_challenges (OTP hashes), agreement_documents (contracts and approvals), webhook_inbox (raw provider payloads).
-- Every reader and writer in the code uses the service-role client (createAdminClient; re-checked 25.10.2026 in src/,
-- worker/, scripts/, supabase/functions/: no createClient() in any file that names one of them; the access map in
-- design.md). Today any signed-in platform staff member may read, write and delete them through PostgREST, whatever
-- their permission keys (production, read-only, 25.10.2026; db-access-map.md).
--
-- WHAT IT DOES (design D2): revoke every privilege of anon and authenticated, drop the staff policy, keep RLS on. A user
-- session then gets 42501 "permission denied for table …"; service_role is untouched (it bypasses RLS, not grants).
-- Proof: supabase/tests/database/s1_closed_critical_test.sql and 000-service-role_test.sql.
--
-- ROLLBACK (live catalog, read-only query of 25.10.2026; the local catalog was identical):
--   grant select, insert, update, delete, truncate, references, trigger, maintain
--     on table public.otp_challenges, public.agreement_documents, public.webhook_inbox to authenticated;
--   create policy otp_challenges_admin_all on public.otp_challenges as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff)) with check ((select is_platform_staff() as is_platform_staff));
--   create policy agreement_documents_admin_all on public.agreement_documents as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff)) with check ((select is_platform_staff() as is_platform_staff));
--   create policy webhook_inbox_admin_all on public.webhook_inbox as permissive for all to authenticated
--     using ((select is_platform_staff() as is_platform_staff)) with check ((select is_platform_staff() as is_platform_staff));
--   (anon held nothing on the three tables before this migration.)

-- BEGIN GENERATED: scripts/gen-staff-table-rls.ts (do not edit between the marks)
-- otp_challenges: closed, service role only (design D2)
revoke all on table public."otp_challenges" from anon, authenticated;
drop policy "otp_challenges_admin_all" on public."otp_challenges";

-- agreement_documents: closed, service role only (design D2)
revoke all on table public."agreement_documents" from anon, authenticated;
drop policy "agreement_documents_admin_all" on public."agreement_documents";

-- webhook_inbox: closed, service role only (design D2)
revoke all on table public."webhook_inbox" from anon, authenticated;
drop policy "webhook_inbox_admin_all" on public."webhook_inbox";
-- END GENERATED
