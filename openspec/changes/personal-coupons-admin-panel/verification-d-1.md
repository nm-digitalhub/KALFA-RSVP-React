# ד.1 — lock-order audit (13.10.2026, local DB function sources)

| function | lock order found |
|---|---|
| bind_coupon_assignment | campaigns → campaign_pricing → coupon_assignments ✓ canonical |
| replace_sales_coupon_assignment | campaigns → campaign_pricing → coupon_assignments ✓ canonical |
| release_coupon_assignment (before) | **coupon_assignments → campaigns → campaign_pricing — INVERTED** |

The inversion was the deadlock pair acceptance 20 predicted: replace holds the campaign
lock and waits for the assignment while release holds the assignment and waits for the
campaign. Fixed in migration 20261013001452: release now discovers the binding without a
lock, locks campaign → round → assignment, then verifies the binding did not move
(`release: assignment changed`) — the same technique replace uses. Behavior otherwise
unchanged. The new create/void functions (ד.2/ד.3) follow the same canonical order.
