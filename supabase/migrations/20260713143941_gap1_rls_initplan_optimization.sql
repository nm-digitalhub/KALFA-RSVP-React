-- GAP-1 — RLS initplan optimization (PERFORMANCE ONLY; authorization semantics UNCHANGED).
-- Source: full RLS audit 2026-07-13. Supabase advisor `auth_rls_initplan`: policies that
-- call auth.uid()/has_role(auth.uid(),…) inline get re-evaluated PER ROW. Wrapping the
-- ROW-INDEPENDENT auth expression in a scalar subquery `(select …)` hoists it to a single
-- per-statement InitPlan. The boolean result is identical.
--
-- Only two transformations applied, generated FROM live pg_policies and adversarially
-- verified (55 changed / 28 skipped / 83 total, semantics provably identical):
--   auth.uid()                        -> (select auth.uid())
--   has_role(auth.uid(), '<role>')    -> (select has_role((select auth.uid()), '<role>'))
-- Row-dependent helpers (can_access_event(event_id,…), owns_event(event_id),
-- has_org_permission(org_id,…), is_org_member(org_id)) are LEFT byte-identical — they must
-- see the row and cannot be hoisted. `TO roles` bindings are preserved (ALTER restates the
-- full USING/WITH CHECK, never touches roles). Idempotent: re-running sets the same value.


-- ============ activity_log ============
-- al_admin_all         orig qual+check: has_role(auth.uid(), 'admin'::app_role)
-- al_org_read          orig qual:       ((user_id = auth.uid()) OR can_access_event(event_id, 'events'::text, 'view'::text))
-- al_owner_insert      orig with_check: (user_id = auth.uid())
ALTER POLICY al_admin_all ON public.activity_log
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY al_org_read ON public.activity_log
  USING (((user_id = (select auth.uid())) OR can_access_event(event_id, 'events'::text, 'view'::text)));
ALTER POLICY al_owner_insert ON public.activity_log
  WITH CHECK ((user_id = (select auth.uid())));

-- ============ agreement_documents ============
-- agreement_documents_admin_all  orig qual+check: has_role(auth.uid(), 'admin'::app_role)
ALTER POLICY agreement_documents_admin_all ON public.agreement_documents
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ app_settings ============
-- app_settings_admin_all  orig qual+check: has_role(auth.uid(), 'admin'::app_role)
ALTER POLICY app_settings_admin_all ON public.app_settings
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ billed_results ============
-- billed_results_admin_all   orig qual+check: has_role(auth.uid(), 'admin'::app_role)
-- SKIP billed_results_org_select: can_access_event(event_id,'billing','view') -- row-dependent
ALTER POLICY billed_results_admin_all ON public.billed_results
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ billing_credits ============
-- SKIP billing_credits_org_select: can_access_event(...) -- row-dependent
ALTER POLICY billing_credits_admin_all ON public.billing_credits
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ callback_requests ============
-- SKIP cb_insert_anyone: with_check = true
ALTER POLICY cb_admin_all ON public.callback_requests
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ campaign_authorized_contacts ============
-- SKIP campaign_authorized_contacts_org_select: can_access_event(...) -- row-dependent
ALTER POLICY campaign_authorized_contacts_admin_all ON public.campaign_authorized_contacts
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ campaign_authorized_set_audit ============
-- campaign_authorized_set_audit_org_select  orig qual: (can_access_event(event_id, 'campaigns'::text, 'view'::text) OR has_role(auth.uid(), 'admin'::app_role))
-- SKIP campaign_authorized_set_audit_service_insert: with_check = true
ALTER POLICY campaign_authorized_set_audit_org_select ON public.campaign_authorized_set_audit
  USING ((can_access_event(event_id, 'campaigns'::text, 'view'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ campaigns ============
-- SKIP camp_org_select: can_access_event(...) -- row-dependent
ALTER POLICY camp_admin_all ON public.campaigns
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ contact_interactions ============
-- SKIP contact_interactions_org_select: ((event_id IS NOT NULL) AND can_access_event(...)) -- no auth.uid, row-dependent
ALTER POLICY contact_interactions_admin_all ON public.contact_interactions
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ contact_messages ============
-- SKIP cm_insert_anyone: with_check = true
ALTER POLICY cm_admin_all ON public.contact_messages
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ contacts ============
-- SKIP contacts_org_select: can_access_event(...) -- row-dependent
ALTER POLICY contacts_admin_all ON public.contacts
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ event_questions ============
-- SKIP eq_org_insert / eq_org_select / eq_org_update: can_access_event(...) -- row-dependent
-- SKIP eq_owner_delete: owns_event(event_id) -- row-dependent
ALTER POLICY eq_admin_all ON public.event_questions
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ events ============
-- events_owner_delete  orig qual:       (owner_id = auth.uid())
-- events_owner_insert  orig with_check: ((owner_id = auth.uid()) AND ((org_id IS NULL) OR has_org_permission(org_id, 'events'::text, 'create'::text)))
-- SKIP events_org_select / events_org_update: can_access_event(...) -- row-dependent
ALTER POLICY events_admin_all ON public.events
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY events_owner_delete ON public.events
  USING ((owner_id = (select auth.uid())));
ALTER POLICY events_owner_insert ON public.events
  WITH CHECK (((owner_id = (select auth.uid())) AND ((org_id IS NULL) OR has_org_permission(org_id, 'events'::text, 'create'::text))));

-- ============ guest_groups ============
-- SKIP gg_org_insert / gg_org_select / gg_org_update: can_access_event(...) ; gg_owner_delete: owns_event(...) -- row-dependent
ALTER POLICY gg_admin_all ON public.guest_groups
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ guest_import_staging ============
-- SKIP staging_org_select / staging_org_update: can_access_event(...) -- row-dependent (no policy changed)

-- ============ guests ============
-- SKIP guests_org_insert / guests_org_select / guests_org_update: can_access_event(...) ; guests_owner_delete: owns_event(...) -- row-dependent
ALTER POLICY guests_admin_all ON public.guests
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ message_templates ============
ALTER POLICY message_templates_admin_all ON public.message_templates
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ ops_alerts ============
-- ops_alerts_admin_select  orig qual: has_role(auth.uid(), 'admin'::app_role)
ALTER POLICY ops_alerts_admin_select ON public.ops_alerts
  USING ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ org_roles ============
-- org_roles_select  orig qual: (auth.uid() IS NOT NULL)
ALTER POLICY org_roles_admin_all ON public.org_roles
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY org_roles_select ON public.org_roles
  USING (((select auth.uid()) IS NOT NULL));

-- ============ organization_audit_log ============
-- organization_audit_log_select  orig qual: (has_org_permission(organization_id, 'organization'::text, 'manage'::text) OR has_role(auth.uid(), 'admin'::app_role))
ALTER POLICY organization_audit_log_admin_all ON public.organization_audit_log
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY organization_audit_log_select ON public.organization_audit_log
  USING ((has_org_permission(organization_id, 'organization'::text, 'manage'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ organization_invitations ============
-- organization_invitations_manage  orig qual+check: (has_org_permission(organization_id, 'members'::text, 'manage'::text) OR has_role(auth.uid(), 'admin'::app_role))
ALTER POLICY organization_invitations_manage ON public.organization_invitations
  USING ((has_org_permission(organization_id, 'members'::text, 'manage'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))))
  WITH CHECK ((has_org_permission(organization_id, 'members'::text, 'manage'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ organization_members ============
-- organization_members_manage  orig qual+check: (has_org_permission(organization_id, 'members'::text, 'manage'::text) OR has_role(auth.uid(), 'admin'::app_role))
-- organization_members_select  orig qual:       (is_org_member(organization_id) OR has_role(auth.uid(), 'admin'::app_role))
ALTER POLICY organization_members_manage ON public.organization_members
  USING ((has_org_permission(organization_id, 'members'::text, 'manage'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))))
  WITH CHECK ((has_org_permission(organization_id, 'members'::text, 'manage'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))));
ALTER POLICY organization_members_select ON public.organization_members
  USING ((is_org_member(organization_id) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ organizations ============
-- organizations_member_select  orig qual: (is_org_member(id) OR has_role(auth.uid(), 'admin'::app_role))
-- organizations_update         orig qual+check: (has_org_permission(id, 'organization'::text, 'edit'::text) OR has_role(auth.uid(), 'admin'::app_role))
ALTER POLICY organizations_admin_all ON public.organizations
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY organizations_member_select ON public.organizations
  USING ((is_org_member(id) OR (select has_role((select auth.uid()), 'admin'::app_role))));
ALTER POLICY organizations_update ON public.organizations
  USING ((has_org_permission(id, 'organization'::text, 'edit'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))))
  WITH CHECK ((has_org_permission(id, 'organization'::text, 'edit'::text) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ otp_challenges ============
ALTER POLICY otp_challenges_admin_all ON public.otp_challenges
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ outreach_state ============
-- SKIP outreach_state_org_select: can_access_event(...) -- row-dependent
ALTER POLICY outreach_state_admin_all ON public.outreach_state
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ outreach_template_failures ============
ALTER POLICY outreach_template_failures_admin_all ON public.outreach_template_failures
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ packages ============
-- SKIP packages_public_read: (active = true) -- no auth call
ALTER POLICY packages_admin_all ON public.packages
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ permission_definitions ============
-- permission_definitions_select  orig qual: (auth.uid() IS NOT NULL)
ALTER POLICY permission_definitions_admin_all ON public.permission_definitions
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY permission_definitions_select ON public.permission_definitions
  USING (((select auth.uid()) IS NOT NULL));

-- ============ profiles ============
-- own_profile_read   orig qual:       (auth.uid() = id)
-- own_profile_write  orig qual+check: (auth.uid() = id)
-- profiles_admin_read orig qual:      has_role(auth.uid(), 'admin'::app_role)
ALTER POLICY own_profile_read ON public.profiles
  USING (((select auth.uid()) = id));
ALTER POLICY own_profile_write ON public.profiles
  USING (((select auth.uid()) = id))
  WITH CHECK (((select auth.uid()) = id));
ALTER POLICY profiles_admin_read ON public.profiles
  USING ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ push_subscriptions ============
-- push_subscriptions_owner_delete  orig qual:       ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
-- push_subscriptions_owner_insert  orig with_check: ((user_id = auth.uid()) AND ((org_id IS NULL) OR is_org_member(org_id) OR has_role(auth.uid(), 'admin'::app_role)))
-- push_subscriptions_owner_select  orig qual:       ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
-- push_subscriptions_owner_update  orig qual:       ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
--                                  orig with_check: (((user_id = auth.uid()) AND ((org_id IS NULL) OR is_org_member(org_id) OR has_role(auth.uid(), 'admin'::app_role))) OR has_role(auth.uid(), 'admin'::app_role))
ALTER POLICY push_subscriptions_owner_delete ON public.push_subscriptions
  USING (((user_id = (select auth.uid())) OR (select has_role((select auth.uid()), 'admin'::app_role))));
ALTER POLICY push_subscriptions_owner_insert ON public.push_subscriptions
  WITH CHECK (((user_id = (select auth.uid())) AND ((org_id IS NULL) OR is_org_member(org_id) OR (select has_role((select auth.uid()), 'admin'::app_role)))));
ALTER POLICY push_subscriptions_owner_select ON public.push_subscriptions
  USING (((user_id = (select auth.uid())) OR (select has_role((select auth.uid()), 'admin'::app_role))));
ALTER POLICY push_subscriptions_owner_update ON public.push_subscriptions
  USING (((user_id = (select auth.uid())) OR (select has_role((select auth.uid()), 'admin'::app_role))))
  WITH CHECK ((((user_id = (select auth.uid())) AND ((org_id IS NULL) OR is_org_member(org_id) OR (select has_role((select auth.uid()), 'admin'::app_role)))) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ role_permissions ============
-- role_permissions_select  orig qual: (auth.uid() IS NOT NULL)
ALTER POLICY role_permissions_admin_all ON public.role_permissions
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY role_permissions_select ON public.role_permissions
  USING (((select auth.uid()) IS NOT NULL));

-- ============ rsvp_responses ============
-- rsvp_admin_read  orig qual: has_role(auth.uid(), 'admin'::app_role)
-- SKIP rsvp_org_read: can_access_event(...) -- row-dependent
ALTER POLICY rsvp_admin_read ON public.rsvp_responses
  USING ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ signed_agreements ============
ALTER POLICY signed_agreements_admin_all ON public.signed_agreements
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));

-- ============ user_roles ============
-- ur_self_read  orig qual: ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
ALTER POLICY ur_admin_all ON public.user_roles
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
ALTER POLICY ur_self_read ON public.user_roles
  USING (((user_id = (select auth.uid())) OR (select has_role((select auth.uid()), 'admin'::app_role))));

-- ============ user_settings ============
-- user_settings_owner_insert  orig with_check: (auth.uid() = user_id)
-- user_settings_owner_select  orig qual:       (auth.uid() = user_id)
-- user_settings_owner_update  orig qual+check: (auth.uid() = user_id)
ALTER POLICY user_settings_owner_insert ON public.user_settings
  WITH CHECK (((select auth.uid()) = user_id));
ALTER POLICY user_settings_owner_select ON public.user_settings
  USING (((select auth.uid()) = user_id));
ALTER POLICY user_settings_owner_update ON public.user_settings
  USING (((select auth.uid()) = user_id))
  WITH CHECK (((select auth.uid()) = user_id));

-- ============ webhook_inbox ============
ALTER POLICY webhook_inbox_admin_all ON public.webhook_inbox
  USING ((select has_role((select auth.uid()), 'admin'::app_role)))
  WITH CHECK ((select has_role((select auth.uid()), 'admin'::app_role)));
