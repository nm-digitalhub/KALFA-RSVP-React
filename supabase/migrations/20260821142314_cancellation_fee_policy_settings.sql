-- Cancellation-fee policy, as configurable DATA (never hardcoded logic) —
-- matches agreement §5 as of 2026-08-21: "עד 5% מערך העסקה או ₪100, לפי
-- הנמוך; החזר תוך 14 יום באמצעי התשלום המקורי". VERIFIED against the actual
-- statutory text (חוק הגנת הצרכן §14ה(ב)(1), fetched from nevo.co.il,
-- 2026-08-21): word-for-word match, no adjustment needed. A future change
-- from counsel is a data UPDATE here, not a code change.
ALTER TABLE public.app_settings
  ADD COLUMN cancellation_fee_percent numeric NOT NULL DEFAULT 5,
  ADD COLUMN cancellation_fee_cap numeric NOT NULL DEFAULT 100,
  ADD COLUMN cancellation_refund_days smallint NOT NULL DEFAULT 14;
