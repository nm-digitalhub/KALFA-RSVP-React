# 8.2 — the rollback-blocking query, verified on the local DB

13.10.2026, local Supabase DB (port 54322), inside one BEGIN…ROLLBACK block (no residue).

Fixture: a user → an active event → campaign A with a BOUND assignment, and campaign B
(control) with none. The leftover unbound race assignments (+972500000099) served as a
third control.

Assertions on the runbook query (docs/personal-coupons-rollback-runbook.md):
- seeded_found_expect_1 = **1** — the benefit-carrying campaign is listed;
- control_found_expect_0 = **0** — a campaign without a benefit is not;
- unbound_race_rows_expect_0 = **0** — unbound assignments do not block.

Note: the local DB also carries ~79 rows of embedded-test leftovers from the morning's
fixture runs — the query correctly lists them all as blocking, which is itself evidence
it misses nothing. ROLLBACK confirmed at the end of the block.
