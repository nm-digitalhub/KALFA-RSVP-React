-- Harden the audit/billing trail: a customer (or anyone) deleting an event or
-- campaign must never silently wipe what was billed or who authorized it.
-- Matches the existing billed_results_contact_id_fkey RESTRICT precedent.
-- Found by the 2026-08-21 production-readiness audit (docs/production-readiness/2026-08-21-go-no-go.md §1.2).

ALTER TABLE public.billed_results
  DROP CONSTRAINT billed_results_event_id_fkey,
  ADD CONSTRAINT billed_results_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.billed_results
  DROP CONSTRAINT billed_results_campaign_id_fkey,
  ADD CONSTRAINT billed_results_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_contacts
  DROP CONSTRAINT campaign_authorized_contacts_event_id_fkey,
  ADD CONSTRAINT campaign_authorized_contacts_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_contacts
  DROP CONSTRAINT campaign_authorized_contacts_campaign_id_fkey,
  ADD CONSTRAINT campaign_authorized_contacts_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_set_audit
  DROP CONSTRAINT campaign_authorized_set_audit_event_id_fkey,
  ADD CONSTRAINT campaign_authorized_set_audit_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_set_audit
  DROP CONSTRAINT campaign_authorized_set_audit_campaign_id_fkey,
  ADD CONSTRAINT campaign_authorized_set_audit_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE RESTRICT;

-- Direct self-delete now only reaches a draft event (guaranteed by the
-- campaigns_require_active_event trigger, R9, to have zero billing history —
-- see src/lib/data/campaigns.ts:181-186). Anything past draft goes through
-- the new event_cancellation_requests flow (Task 2+).
DROP POLICY IF EXISTS "events_owner_delete" ON public.events;
CREATE POLICY "events_owner_delete" ON public.events
  FOR DELETE TO authenticated
  USING (owner_id = (select auth.uid()) AND status = 'draft');
