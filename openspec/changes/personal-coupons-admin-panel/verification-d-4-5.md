# ד.4 + ד.5 — two-connection concurrency runs (13.10.2026, local DB, real psql connections)

## ד.4 — create races

**Double submit (acceptance 18).** Two parallel `create_staff_coupon_assignment` calls,
same staff/user/offer/key: one answered `created`, the other `existing` (the loser is
caught by the unique (assigned_by, idempotency_key) and answers the STORED row — hardened
in the migration during this run). Durable state: **1 assignment, 1 'assigned' event**.

**Create vs offer edit (part of 19).** Connection A held `update offers set value=15`
uncommitted for 2s; connection B ran create with the OLD confirmed terms (10%). B waited
on the offer's share lock, recomputed against the NEW price, refused `assign: terms
changed`, and persisted **nothing** (0 rows for its key). The previewed terms commit
whole or refuse — never a mix.

## ד.5 — void races (acceptance 19, 17, 18)

**Double-click void.** Two parallel voids of the same bound assignment: one `voided`,
one `refused` (already_ended). Durable state: state=void, **exactly one** voided event,
the round released. No deadlock (release's lock order was fixed first — ד.1).

**Void vs bind.** Parallel `bind_coupon_assignment` and `void_staff_coupon_assignment` on
the same assignment+campaign: serialized cleanly on the canonical campaign→round→
assignment order; the void won and bind refused honestly (`assignment is not available
(state void)`). Final state consistent: void, unbound, round unlinked. No deadlock.

**Void vs an opening payment.** Connection A inserted a PENDING package payment and held
the transaction; the void ran mid-window. Finding: the window is **structurally closed** —
`payment_operations_open_guard` refuses a package payment on an UNLOCKED round, and a
LOCKED round refuses the void as held_by_approved_terms before any payment is read; the
campaign-row FK key-share serializes the remainder. In the run, the payment insert was
rejected by the guard and the void completed cleanly.

Earlier SQL proofs (same change): forced failure at the create's last write → 0 rows
(acceptance 16); forced failure AFTER the void's release → bound/discount/history fully
restored (acceptance 17).
