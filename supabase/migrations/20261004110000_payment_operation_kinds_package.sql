-- Kinds of the fixed-price package (docs/superpowers/plans/2026-10-04-package-payment-plan.md, Task 4).
-- Applied AFTER 20261004105957_payment_operations_expand.sql, which creates payment_operation_kinds.
--
-- A kind is a ROW, not a migration-shaped change: `effect` drives the derived status
-- (src/lib/payments/status.ts) and the flags drive the uniqueness indexes
-- (payment_operations_once_uq / payment_operations_one_pending_uq). No code compares to these names to compute state.
--
--   package_purchase  once per campaign — a package is bought once; a FAILED attempt leaves the slot, so a retry is allowed.
--   package_upgrade   as many as the campaign needs, but payment_operations_one_pending_uq allows ONE in flight at a time.
--
-- Refunds use the existing 'refund' kind (effect 'return'); sort_order 40 and 45 sit between 'charge' (30) and 'refund' (50).
--
-- ROLLBACK (only while no payment_operations row references these kinds — the FK is not ON DELETE CASCADE):
--   delete from public.payment_operation_kinds where kind in ('package_purchase', 'package_upgrade');
insert into public.payment_operation_kinds
  (kind, label_he, effect, once_per_campaign, once_per_parent, sort_order) values
  ('package_purchase', 'רכישת חבילה', 'collect', true,  false, 40),
  ('package_upgrade',  'שדרוג חבילה', 'collect', false, false, 45);
