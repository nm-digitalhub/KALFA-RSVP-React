-- =============================================================================
-- Org Phase 3 — RLS swap: owner-only -> org-membership-aware (M1)
--
-- Spec: plans/org-phase3-rls-swap-plan.md §3 (mapping table) — implemented
-- EXACTLY; policy list and verbatim current texts are in plan §1.2.
--
-- Replaces the 13 owner-only policies (everything in §1.2 EXCEPT
-- events_admin_all, which is untouched) with public.can_access_event(
-- <pk-or-event_id>, '<resource>', '<action>') checks. can_access_event is
-- SECURITY DEFINER, STABLE: owner OR (org_id IS NOT NULL AND
-- has_org_permission(org_id, resource, action)). No function, trigger, or
-- table changes here — policy DDL plus one column-level GRANT hardening only.
--
-- Roles match each live policy's current roles array (from pg_policies,
-- introspected 2026-07-05): events/guests/guest_groups/event_questions/
-- rsvp_responses/activity_log -> authenticated; campaigns/contacts/
-- contact_interactions/billed_results/billing_credits/
-- campaign_authorized_contacts/outreach_state -> public.
--
-- Rollback: forward migration that recreates the 13 REPLACED §1.2 policies
-- (events_admin_all was never dropped) from the verbatim snapshot in
-- plans/org-phase3-live-policies-snapshot.json — which preserves roles arrays
-- AND with_check expressions — then restores the full-table
-- GRANT UPDATE ON public.events TO authenticated (and anon). No data loss.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- events (was: events_owner_all — ALL, owner_id = auth.uid())
-- SELECT -> ('events','view'); UPDATE -> ('events','edit') USING + WITH CHECK;
-- INSERT/DELETE stay owner-only. events_admin_all is NOT touched.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "events_owner_all" ON public.events;

CREATE POLICY "events_org_select" ON public.events
  FOR SELECT TO authenticated
  USING (public.can_access_event(id, 'events', 'view'));

CREATE POLICY "events_org_update" ON public.events
  FOR UPDATE TO authenticated
  USING (public.can_access_event(id, 'events', 'edit'))
  WITH CHECK (public.can_access_event(id, 'events', 'edit'));

-- INSERT: owner-only AND org_id pinned to an org the caller belongs to (or
-- NULL). Without the second conjunct any authenticated user could plant an
-- attacker-owned row into a FOREIGN org's tenant view (adversarial review
-- finding, round 1). Permission-checked (not mere membership) so a view-only
-- viewer cannot attach events to the org (round-2 review).
CREATE POLICY "events_owner_insert" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (org_id IS NULL OR public.has_org_permission(org_id, 'events', 'create'))
  );

CREATE POLICY "events_owner_delete" ON public.events
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Ownership-hijack hardening: RLS WITH CHECK cannot compare against OLD, so a
-- non-owner member holding events.edit could otherwise UPDATE owner_id/org_id
-- and re-tenant or hijack an event. Column-level privileges are the standard
-- way to pin these columns: revoke table-wide UPDATE from authenticated and
-- re-grant it on every events column EXCEPT id, owner_id, org_id, created_at.
-- (Server-side service-role paths are unaffected.)
REVOKE UPDATE ON public.events FROM authenticated;
-- anon holds legacy table-wide UPDATE on events too — RLS already blocks it,
-- but there is no reason for the grant to exist at all (defense-in-depth).
REVOKE UPDATE ON public.events FROM anon;
-- `status` is deliberately EXCLUDED: lifecycle transitions (publish/close)
-- are owner-only app paths that move to the service-role client in A1, so no
-- browser-context role can flip status directly (plan §2 — lifecycle stays
-- owner-only in BOTH tiers).
GRANT UPDATE (
  name,
  event_type,
  event_date,
  venue_name,
  venue_address,
  template,
  package_id,
  with_ai_calls,
  rsvp_deadline,
  notes,
  updated_at,
  celebrants
) ON public.events TO authenticated;

-- -----------------------------------------------------------------------------
-- guests (was: guests_owner — ALL, owns_event(event_id))
-- SELECT -> ('guests','view'); INSERT -> ('guests','create');
-- UPDATE -> ('guests','edit') USING + WITH CHECK (WITH CHECK re-evaluates the
-- NEW row's event_id — this is what blocks moving a row to a foreign event);
-- DELETE stays owner-only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "guests_owner" ON public.guests;

CREATE POLICY "guests_org_select" ON public.guests
  FOR SELECT TO authenticated
  USING (public.can_access_event(event_id, 'guests', 'view'));

CREATE POLICY "guests_org_insert" ON public.guests
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_event(event_id, 'guests', 'create'));

CREATE POLICY "guests_org_update" ON public.guests
  FOR UPDATE TO authenticated
  USING (public.can_access_event(event_id, 'guests', 'edit'))
  WITH CHECK (public.can_access_event(event_id, 'guests', 'edit'));

CREATE POLICY "guests_owner_delete" ON public.guests
  FOR DELETE TO authenticated
  USING (public.owns_event(event_id));

-- -----------------------------------------------------------------------------
-- guest_groups (was: gg_owner — ALL, owns_event(event_id)) — same as guests
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "gg_owner" ON public.guest_groups;

CREATE POLICY "gg_org_select" ON public.guest_groups
  FOR SELECT TO authenticated
  USING (public.can_access_event(event_id, 'guests', 'view'));

CREATE POLICY "gg_org_insert" ON public.guest_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_event(event_id, 'guests', 'create'));

CREATE POLICY "gg_org_update" ON public.guest_groups
  FOR UPDATE TO authenticated
  USING (public.can_access_event(event_id, 'guests', 'edit'))
  WITH CHECK (public.can_access_event(event_id, 'guests', 'edit'));

CREATE POLICY "gg_owner_delete" ON public.guest_groups
  FOR DELETE TO authenticated
  USING (public.owns_event(event_id));

-- -----------------------------------------------------------------------------
-- event_questions (was: eq_owner — ALL, owns_event(event_id))
-- SELECT -> ('events','view'); INSERT/UPDATE -> ('events','edit');
-- DELETE stays owner-only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "eq_owner" ON public.event_questions;

CREATE POLICY "eq_org_select" ON public.event_questions
  FOR SELECT TO authenticated
  USING (public.can_access_event(event_id, 'events', 'view'));

CREATE POLICY "eq_org_insert" ON public.event_questions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_event(event_id, 'events', 'edit'));

CREATE POLICY "eq_org_update" ON public.event_questions
  FOR UPDATE TO authenticated
  USING (public.can_access_event(event_id, 'events', 'edit'))
  WITH CHECK (public.can_access_event(event_id, 'events', 'edit'));

CREATE POLICY "eq_owner_delete" ON public.event_questions
  FOR DELETE TO authenticated
  USING (public.owns_event(event_id));

-- -----------------------------------------------------------------------------
-- campaigns (was: camp_owner_select — SELECT, owns_event(event_id), roles {public})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "camp_owner_select" ON public.campaigns;

CREATE POLICY "camp_org_select" ON public.campaigns
  FOR SELECT TO public
  USING (public.can_access_event(event_id, 'campaigns', 'view'));

-- -----------------------------------------------------------------------------
-- contacts (was: contacts_owner_select — SELECT, owns_event(event_id), roles {public})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "contacts_owner_select" ON public.contacts;

CREATE POLICY "contacts_org_select" ON public.contacts
  FOR SELECT TO public
  USING (public.can_access_event(event_id, 'contacts', 'view'));

-- -----------------------------------------------------------------------------
-- contact_interactions (was: contact_interactions_owner_select — SELECT,
-- (event_id IS NOT NULL) AND owns_event(event_id), roles {public})
-- The "(event_id IS NOT NULL) AND" prefix is preserved verbatim.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "contact_interactions_owner_select" ON public.contact_interactions;

CREATE POLICY "contact_interactions_org_select" ON public.contact_interactions
  FOR SELECT TO public
  USING ((event_id IS NOT NULL) AND public.can_access_event(event_id, 'contacts', 'view'));

-- -----------------------------------------------------------------------------
-- rsvp_responses (was: rsvp_owner_read — SELECT, owns_event(event_id),
-- roles {authenticated})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "rsvp_owner_read" ON public.rsvp_responses;

CREATE POLICY "rsvp_org_read" ON public.rsvp_responses
  FOR SELECT TO authenticated
  USING (public.can_access_event(event_id, 'guests', 'view'));

-- -----------------------------------------------------------------------------
-- activity_log (was: al_owner_read — SELECT,
-- (user_id = auth.uid()) OR owns_event(event_id), roles {authenticated})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "al_owner_read" ON public.activity_log;

CREATE POLICY "al_org_read" ON public.activity_log
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR public.can_access_event(event_id, 'events', 'view'));

-- -----------------------------------------------------------------------------
-- billed_results (was: billed_results_owner_select — SELECT, owns_event(event_id),
-- roles {public})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "billed_results_owner_select" ON public.billed_results;

CREATE POLICY "billed_results_org_select" ON public.billed_results
  FOR SELECT TO public
  USING (public.can_access_event(event_id, 'billing', 'view'));

-- -----------------------------------------------------------------------------
-- billing_credits (was: billing_credits_owner_select — SELECT, owns_event(event_id),
-- roles {public})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "billing_credits_owner_select" ON public.billing_credits;

CREATE POLICY "billing_credits_org_select" ON public.billing_credits
  FOR SELECT TO public
  USING (public.can_access_event(event_id, 'billing', 'view'));

-- -----------------------------------------------------------------------------
-- campaign_authorized_contacts (was: campaign_authorized_contacts_owner_select —
-- SELECT, owns_event(event_id), roles {public})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "campaign_authorized_contacts_owner_select" ON public.campaign_authorized_contacts;

CREATE POLICY "campaign_authorized_contacts_org_select" ON public.campaign_authorized_contacts
  FOR SELECT TO public
  USING (public.can_access_event(event_id, 'campaigns', 'view'));

-- -----------------------------------------------------------------------------
-- outreach_state (was: outreach_state_owner_select — SELECT, owns_event(event_id),
-- roles {public})
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "outreach_state_owner_select" ON public.outreach_state;

CREATE POLICY "outreach_state_org_select" ON public.outreach_state
  FOR SELECT TO public
  USING (public.can_access_event(event_id, 'campaigns', 'view'));
