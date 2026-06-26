-- 1. Add payment tracking columns.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sumit_document_id          integer,
  ADD COLUMN IF NOT EXISTS paid_at                    timestamptz,
  ADD COLUMN IF NOT EXISTS payment_attempt_ref        uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS payment_processing_started_at timestamptz;
-- payment_attempt_ref: unique per attempt, rotated on retry.
--   Sent to SUMIT as Customer.ExternalIdentifier (SUMIT audit trail only —
--   no SUMIT API supports searching by ExternalIdentifier; PaymentID is the only
--   programmatic lookup key, stored in sumit_document_id after success).
-- payment_processing_started_at: set at lock time, used to detect stuck
--   'processing' orders (server crash between lock and catch).

-- 2. Unique indexes for reconciliation and idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_attempt_ref_unique
  ON public.orders (payment_attempt_ref);
CREATE UNIQUE INDEX IF NOT EXISTS orders_sumit_document_id_unique
  ON public.orders (sumit_document_id)
  WHERE sumit_document_id IS NOT NULL;

-- 3. Replace orders_owner (ALL) with SELECT-only.
--    Status transitions use createAdminClient() — no user client ever writes status.
DROP POLICY IF EXISTS orders_owner ON public.orders;
CREATE POLICY orders_owner_select
  ON public.orders FOR SELECT
  USING (user_id = auth.uid());
