-- Only enum additions — must be committed before _0003 uses these values.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'payment_review';
