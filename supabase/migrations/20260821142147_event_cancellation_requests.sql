-- Customer-initiated request to cancel (ביטול עסקה) an active/closed event.
-- Resolution is a staff billing decision — for a pre-charge campaign it is
-- EXECUTED (SUMIT capture, closeCampaignAndCharge override) and the
-- outcome recorded here; for a post-charge campaign the refund is EXECUTED
-- via creditHeldCardSumit (a real SUMIT credit), or falls back to
-- capture_outcome='manual_refund_required' only if the campaign is missing
-- the card fields needed to attempt it at all.
-- See docs/superpowers/plans/2026-08-21-event-cancellation-request.md.

CREATE TABLE public.event_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 2000),
  sms_consent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution text CHECK (resolution IN ('full_cancellation', 'partial_charge', 'declined')),
  -- The final amount captured/credited (full_cancellation⇒0 or full refund,
  -- partial_charge⇒staff-confirmed amount) OR, for the rare manual-refund
  -- fallback, the amount staff intends to refund (not moved by this system).
  resolution_amount numeric,
  -- 'captured' = SUMIT capture executed (pre-charge campaign);
  -- 'refunded' = SUMIT credit executed (post-charge campaign, card on file);
  -- 'manual_refund_required' = post-charge but no card fields on file, staff
  -- must refund manually; 'not_applicable' = declined, nothing to move.
  capture_outcome text CHECK (capture_outcome IN ('captured', 'refunded', 'manual_refund_required', 'not_applicable')),
  sumit_document_id bigint,
  sumit_document_url text,
  resolution_note text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_cancellation_requests_event_id_idx ON public.event_cancellation_requests(event_id);
CREATE INDEX event_cancellation_requests_owner_id_idx ON public.event_cancellation_requests(owner_id);
CREATE INDEX event_cancellation_requests_pending_idx ON public.event_cancellation_requests(created_at) WHERE status = 'pending';

CREATE TRIGGER event_cancellation_requests_set_updated_at
  BEFORE UPDATE ON public.event_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Terminal-state guard, same pattern as campaign_authorized_set_audit_no_mutate
-- and the campaigns terminal charge_status guard: once resolved, the row is
-- append-only history — a second resolve must be a NEW request, not an edit.
CREATE OR REPLACE FUNCTION public.event_cancellation_requests_no_remutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'event_cancellation_requests: row % already resolved, immutable', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_cancellation_requests_no_remutate
  BEFORE UPDATE ON public.event_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.event_cancellation_requests_no_remutate();

ALTER TABLE public.event_cancellation_requests ENABLE ROW LEVEL SECURITY;

-- Owner can open a request only for their OWN, non-draft event — draft events
-- use the direct-delete path (see events_delete_restrict_billing_fk_hardening
-- migration), they never need a request.
CREATE POLICY "ecr_owner_insert" ON public.event_cancellation_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND e.owner_id = (select auth.uid()) AND e.status IN ('active', 'closed')
    )
  );

-- Owner can see their own requests' status/resolution (so the UI can show
-- "בקשה #123 — ממתינה" / the staff's resolution) but never edit them.
CREATE POLICY "ecr_owner_select" ON public.event_cancellation_requests
  FOR SELECT TO authenticated
  USING (owner_id = (select auth.uid()));

-- No UPDATE/DELETE policy for authenticated at all — resolution happens only
-- via service-role from the admin data layer (mirrors callback_requests: RLS
-- blocks direct writes, admin reads/writes go through service-role).

REVOKE EXECUTE ON FUNCTION public.event_cancellation_requests_no_remutate() FROM public, anon, authenticated;
