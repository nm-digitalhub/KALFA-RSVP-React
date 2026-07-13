-- Scope every PRIVILEGED RLS policy from `TO public` to `TO authenticated`.
--
-- WHY (grounded in the 2026-07-13 unbiased authz research — Supabase RLS best
-- practices + the B2C blueprint): a policy left `TO public` (roles = {public}) is
-- evaluated for EVERY Postgres role including `anon`. When such a policy calls a
-- SECURITY DEFINER RBAC helper (has_role/can_access_event/…), an anon request to
-- that table forces evaluation of the helper in the anon role's context. After
-- EXECUTE on has_role was revoked from anon, that surfaced as
-- `permission denied for function has_role` on direct anon reads of contacts,
-- organizations, etc. (verified live). The CORRECT fix per the research is NOT to
-- re-grant / blanket-revoke a load-bearing function, but to SCOPE the policy's
-- role: `TO authenticated` means anon never evaluates the policy at all.
--
-- Effect: identical for `authenticated` (still evaluated, same USING/WITH CHECK);
-- `anon` simply stops evaluating these privileged policies -> the permission-denied
-- errors disappear, the anon attack surface shrinks, and the ~100 duplicate-
-- permissive-policy advisor warnings for the `anon` role clear. USING/WITH CHECK
-- bodies are untouched (only the role list changes). Idempotent: re-running sets
-- the same role. NONE of these 42 policies is a genuine public-read policy — every
-- one is admin-only, org-scoped, or per-user (auth.uid()-based); the only public
-- reads (e.g. packages active=true) are already TO anon/authenticated and are not
-- touched here.

-- agreement_documents
alter policy agreement_documents_admin_all on public.agreement_documents to authenticated;
-- app_settings
alter policy app_settings_admin_all on public.app_settings to authenticated;
-- billed_results
alter policy billed_results_admin_all on public.billed_results to authenticated;
alter policy billed_results_org_select on public.billed_results to authenticated;
-- billing_credits
alter policy billing_credits_admin_all on public.billing_credits to authenticated;
alter policy billing_credits_org_select on public.billing_credits to authenticated;
-- campaign_authorized_contacts
alter policy campaign_authorized_contacts_admin_all on public.campaign_authorized_contacts to authenticated;
alter policy campaign_authorized_contacts_org_select on public.campaign_authorized_contacts to authenticated;
-- campaign_authorized_set_audit
alter policy campaign_authorized_set_audit_org_select on public.campaign_authorized_set_audit to authenticated;
-- campaigns
alter policy camp_org_select on public.campaigns to authenticated;
-- contact_interactions
alter policy contact_interactions_admin_all on public.contact_interactions to authenticated;
alter policy contact_interactions_org_select on public.contact_interactions to authenticated;
-- contacts
alter policy contacts_admin_all on public.contacts to authenticated;
alter policy contacts_org_select on public.contacts to authenticated;
-- message_templates
alter policy message_templates_admin_all on public.message_templates to authenticated;
-- org_roles
alter policy org_roles_admin_all on public.org_roles to authenticated;
alter policy org_roles_select on public.org_roles to authenticated;
-- organization_audit_log
alter policy organization_audit_log_admin_all on public.organization_audit_log to authenticated;
alter policy organization_audit_log_select on public.organization_audit_log to authenticated;
-- organization_invitations
alter policy organization_invitations_manage on public.organization_invitations to authenticated;
-- organization_members
alter policy organization_members_manage on public.organization_members to authenticated;
alter policy organization_members_select on public.organization_members to authenticated;
-- organizations
alter policy organizations_admin_all on public.organizations to authenticated;
alter policy organizations_member_select on public.organizations to authenticated;
alter policy organizations_update on public.organizations to authenticated;
-- otp_challenges
alter policy otp_challenges_admin_all on public.otp_challenges to authenticated;
-- outreach_state
alter policy outreach_state_admin_all on public.outreach_state to authenticated;
alter policy outreach_state_org_select on public.outreach_state to authenticated;
-- outreach_template_failures
alter policy outreach_template_failures_admin_all on public.outreach_template_failures to authenticated;
-- permission_definitions
alter policy permission_definitions_admin_all on public.permission_definitions to authenticated;
alter policy permission_definitions_select on public.permission_definitions to authenticated;
-- push_subscriptions
alter policy push_subscriptions_owner_delete on public.push_subscriptions to authenticated;
alter policy push_subscriptions_owner_insert on public.push_subscriptions to authenticated;
alter policy push_subscriptions_owner_select on public.push_subscriptions to authenticated;
alter policy push_subscriptions_owner_update on public.push_subscriptions to authenticated;
-- role_permissions
alter policy role_permissions_admin_all on public.role_permissions to authenticated;
alter policy role_permissions_select on public.role_permissions to authenticated;
-- signed_agreements
alter policy signed_agreements_admin_all on public.signed_agreements to authenticated;
-- user_settings
alter policy user_settings_owner_insert on public.user_settings to authenticated;
alter policy user_settings_owner_select on public.user_settings to authenticated;
alter policy user_settings_owner_update on public.user_settings to authenticated;
-- webhook_inbox
alter policy webhook_inbox_admin_all on public.webhook_inbox to authenticated;
