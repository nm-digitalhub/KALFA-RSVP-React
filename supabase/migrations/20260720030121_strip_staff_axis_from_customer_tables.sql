-- Step 3 — strip the staff axis (has_role admin) off customer-owned tables.
--
-- WHY: today an admin can read/write every tenant's rows over the public Data
-- API with their own JWT, leaving no audit trail (the *_admin_all / *_admin_read
-- RLS policies grant the staff axis blanket reach into customer data). The staff
-- axis no longer needs RLS: every admin reader now goes through createAdminClient
-- (service_role, which BYPASSes RLS) behind a server-side requirePlatformPermission
-- gate + the recordStaffAccess audit layer. Removing these policies makes the
-- staff reach explicit, gated, greppable call sites instead of an implicit,
-- un-audited DB-level grant.
--
-- SAFE — verified per-policy against the live DB (2026-07-20):
--   * All 32 policies are PERMISSIVE, TO authenticated. Classification was
--     re-derived per policy from pg_policies (NOT keyword-grepped): auth.uid()
--     appears inside every wrapped has_role() call and falsely reads as a
--     customer axis.
--   * 21 are standalone has_role(admin) -> DROP outright.
--   * 11 inline `OR has_role(admin)` into a real customer predicate -> REWRITE
--     (strip the OR, keep the customer clause) or the customer path dies.
--   * Every admin reader of these tables already uses service_role (the five
--     cookie-client call sites flagged in the plan were flipped in Step 2;
--     recordings/page.tsx reads via listCallRecordings). Verified.
--   * 19 of the 21 DROP tables keep a customer (org/owner) policy. Two do NOT
--     (call_attempts, signed_agreements) — both are staff/system tables whose
--     ONLY readers use service_role (verified: voice-ops/worker; agreements.ts +
--     the agreement route). They become deny-all-authenticated, which is
--     correct; expect Supabase advisor 0008 ("RLS enabled, no policy") on them —
--     intentional, like push_delivery_log.

begin;

-- ============================================================================
-- PART 1 — DROP: 21 standalone has_role(admin) policies on customer tables.
-- ============================================================================
drop policy if exists "al_admin_all"                            on public.activity_log;
drop policy if exists "billed_results_admin_all"                on public.billed_results;
drop policy if exists "billing_credits_admin_all"              on public.billing_credits;
drop policy if exists "call_analysis_admin_select"             on public.call_analysis;
drop policy if exists "call_attempts_admin_read"               on public.call_attempts;
drop policy if exists "cb_admin_all"                            on public.callback_requests;
drop policy if exists "campaign_authorized_contacts_admin_all" on public.campaign_authorized_contacts;
drop policy if exists "camp_admin_all"                          on public.campaigns;
drop policy if exists "contact_interactions_admin_all"        on public.contact_interactions;
drop policy if exists "cm_admin_all"                            on public.contact_messages;
drop policy if exists "contacts_admin_all"                      on public.contacts;
drop policy if exists "eq_admin_all"                            on public.event_questions;
drop policy if exists "events_admin_all"                        on public.events;
drop policy if exists "gg_admin_all"                            on public.guest_groups;
drop policy if exists "guests_admin_all"                        on public.guests;
drop policy if exists "organization_audit_log_admin_all"       on public.organization_audit_log;
drop policy if exists "organizations_admin_all"                on public.organizations;
drop policy if exists "outreach_state_admin_all"               on public.outreach_state;
drop policy if exists "profiles_admin_read"                     on public.profiles;
drop policy if exists "rsvp_admin_read"                         on public.rsvp_responses;
drop policy if exists "signed_agreements_admin_all"            on public.signed_agreements;

-- ============================================================================
-- PART 2 — REWRITE: 11 mixed policies. Drop + recreate with the customer clause
-- ONLY (the `OR has_role(admin)` staff reach removed). Predicates copied verbatim
-- from the live policies; (select ...) wrapping preserved for the initplan optimization.
-- ============================================================================

-- campaign_authorized_set_audit — org read via can_access_event.
drop policy if exists "campaign_authorized_set_audit_org_select" on public.campaign_authorized_set_audit;
create policy "campaign_authorized_set_audit_org_select" on public.campaign_authorized_set_audit
  as permissive for select to authenticated
  using (can_access_event(event_id, 'campaigns'::text, 'view'::text));

-- organization_audit_log — org managers read.
drop policy if exists "organization_audit_log_select" on public.organization_audit_log;
create policy "organization_audit_log_select" on public.organization_audit_log
  as permissive for select to authenticated
  using (has_org_permission(organization_id, 'organization'::text, 'manage'::text));

-- organization_invitations — member managers manage (USING + CHECK).
drop policy if exists "organization_invitations_manage" on public.organization_invitations;
create policy "organization_invitations_manage" on public.organization_invitations
  as permissive for all to authenticated
  using (has_org_permission(organization_id, 'members'::text, 'manage'::text))
  with check (has_org_permission(organization_id, 'members'::text, 'manage'::text));

-- organization_role_audit_log — org owner reads.
drop policy if exists "organization_role_audit_log_owner_select" on public.organization_role_audit_log;
create policy "organization_role_audit_log_owner_select" on public.organization_role_audit_log
  as permissive for select to authenticated
  using (is_org_owner(organization_id));

-- organization_role_permissions — org owner reads.
drop policy if exists "organization_role_permissions_owner_select" on public.organization_role_permissions;
create policy "organization_role_permissions_owner_select" on public.organization_role_permissions
  as permissive for select to authenticated
  using (is_org_owner(organization_id));

-- organizations — member select.
drop policy if exists "organizations_member_select" on public.organizations;
create policy "organizations_member_select" on public.organizations
  as permissive for select to authenticated
  using (is_org_member(id));

-- organizations — org editors update (USING + CHECK).
drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations
  as permissive for update to authenticated
  using (has_org_permission(id, 'organization'::text, 'edit'::text))
  with check (has_org_permission(id, 'organization'::text, 'edit'::text));

-- push_subscriptions — owner delete.
drop policy if exists "push_subscriptions_owner_delete" on public.push_subscriptions;
create policy "push_subscriptions_owner_delete" on public.push_subscriptions
  as permissive for delete to authenticated
  using (user_id = (select auth.uid()));

-- push_subscriptions — owner insert (CHECK only).
drop policy if exists "push_subscriptions_owner_insert" on public.push_subscriptions;
create policy "push_subscriptions_owner_insert" on public.push_subscriptions
  as permissive for insert to authenticated
  with check ((user_id = (select auth.uid())) and ((org_id is null) or is_org_member(org_id)));

-- push_subscriptions — owner select.
drop policy if exists "push_subscriptions_owner_select" on public.push_subscriptions;
create policy "push_subscriptions_owner_select" on public.push_subscriptions
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

-- push_subscriptions — owner update (USING + CHECK).
drop policy if exists "push_subscriptions_owner_update" on public.push_subscriptions;
create policy "push_subscriptions_owner_update" on public.push_subscriptions
  as permissive for update to authenticated
  using (user_id = (select auth.uid()))
  with check ((user_id = (select auth.uid())) and ((org_id is null) or is_org_member(org_id)));

commit;

-- ============================================================================
-- ROLLBACK (run manually to restore the staff axis; Supabase migrations are
-- forward-only). Recreates all 32 policies in their pre-migration form.
-- ============================================================================
-- begin;
-- -- 21 DROP -> recreate (ALL policies get USING+CHECK; the 4 read-only get USING only):
-- create policy "al_admin_all" on public.activity_log as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "billed_results_admin_all" on public.billed_results as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "billing_credits_admin_all" on public.billing_credits as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "call_analysis_admin_select" on public.call_analysis as permissive for select to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "call_attempts_admin_read" on public.call_attempts as permissive for select to authenticated
--   using (has_role(auth.uid(), 'admin'::app_role));
-- create policy "cb_admin_all" on public.callback_requests as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "campaign_authorized_contacts_admin_all" on public.campaign_authorized_contacts as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "camp_admin_all" on public.campaigns as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "contact_interactions_admin_all" on public.contact_interactions as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "cm_admin_all" on public.contact_messages as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "contacts_admin_all" on public.contacts as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "eq_admin_all" on public.event_questions as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "events_admin_all" on public.events as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "gg_admin_all" on public.guest_groups as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "guests_admin_all" on public.guests as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "organization_audit_log_admin_all" on public.organization_audit_log as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "organizations_admin_all" on public.organizations as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "outreach_state_admin_all" on public.outreach_state as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "profiles_admin_read" on public.profiles as permissive for select to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "rsvp_admin_read" on public.rsvp_responses as permissive for select to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)));
-- create policy "signed_agreements_admin_all" on public.signed_agreements as permissive for all to authenticated
--   using ((select has_role((select auth.uid()), 'admin'::app_role)))
--   with check ((select has_role((select auth.uid()), 'admin'::app_role)));
-- -- 11 REWRITE -> restore the `OR has_role` form:
-- drop policy if exists "campaign_authorized_set_audit_org_select" on public.campaign_authorized_set_audit;
-- create policy "campaign_authorized_set_audit_org_select" on public.campaign_authorized_set_audit as permissive for select to authenticated
--   using (can_access_event(event_id, 'campaigns'::text, 'view'::text) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "organization_audit_log_select" on public.organization_audit_log;
-- create policy "organization_audit_log_select" on public.organization_audit_log as permissive for select to authenticated
--   using (has_org_permission(organization_id, 'organization'::text, 'manage'::text) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "organization_invitations_manage" on public.organization_invitations;
-- create policy "organization_invitations_manage" on public.organization_invitations as permissive for all to authenticated
--   using (has_org_permission(organization_id, 'members'::text, 'manage'::text) or (select has_role((select auth.uid()), 'admin'::app_role)))
--   with check (has_org_permission(organization_id, 'members'::text, 'manage'::text) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "organization_role_audit_log_owner_select" on public.organization_role_audit_log;
-- create policy "organization_role_audit_log_owner_select" on public.organization_role_audit_log as permissive for select to authenticated
--   using (is_org_owner(organization_id) or has_role((select auth.uid()), 'admin'::app_role));
-- drop policy if exists "organization_role_permissions_owner_select" on public.organization_role_permissions;
-- create policy "organization_role_permissions_owner_select" on public.organization_role_permissions as permissive for select to authenticated
--   using (is_org_owner(organization_id) or has_role((select auth.uid()), 'admin'::app_role));
-- drop policy if exists "organizations_member_select" on public.organizations;
-- create policy "organizations_member_select" on public.organizations as permissive for select to authenticated
--   using (is_org_member(id) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "organizations_update" on public.organizations;
-- create policy "organizations_update" on public.organizations as permissive for update to authenticated
--   using (has_org_permission(id, 'organization'::text, 'edit'::text) or (select has_role((select auth.uid()), 'admin'::app_role)))
--   with check (has_org_permission(id, 'organization'::text, 'edit'::text) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "push_subscriptions_owner_delete" on public.push_subscriptions;
-- create policy "push_subscriptions_owner_delete" on public.push_subscriptions as permissive for delete to authenticated
--   using ((user_id = (select auth.uid())) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "push_subscriptions_owner_insert" on public.push_subscriptions;
-- create policy "push_subscriptions_owner_insert" on public.push_subscriptions as permissive for insert to authenticated
--   with check ((user_id = (select auth.uid())) and ((org_id is null) or is_org_member(org_id) or (select has_role((select auth.uid()), 'admin'::app_role))));
-- drop policy if exists "push_subscriptions_owner_select" on public.push_subscriptions;
-- create policy "push_subscriptions_owner_select" on public.push_subscriptions as permissive for select to authenticated
--   using ((user_id = (select auth.uid())) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- drop policy if exists "push_subscriptions_owner_update" on public.push_subscriptions;
-- create policy "push_subscriptions_owner_update" on public.push_subscriptions as permissive for update to authenticated
--   using ((user_id = (select auth.uid())) or (select has_role((select auth.uid()), 'admin'::app_role)))
--   with check (((user_id = (select auth.uid())) and ((org_id is null) or is_org_member(org_id) or (select has_role((select auth.uid()), 'admin'::app_role)))) or (select has_role((select auth.uid()), 'admin'::app_role)));
-- commit;
