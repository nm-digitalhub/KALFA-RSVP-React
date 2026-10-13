# ה.4 — Supabase Advisors on the LOCAL DB (13.10.2026; remote untouched)

Run: `supabase db advisors --db-url <local 54322> --type security|performance`
(the CLI's `--local` resolver is broken on this machine — see the start/status notes —
so the documented `--db-url` form was used; it is the same local database).

## The five new functions — CLEAN

- **Execute grants:** none of `admin_list_coupon_assignments`,
  `admin_lookup_account_by_email`, `create_staff_coupon_assignment`,
  `void_staff_coupon_assignment` (nor the re-created `release_coupon_assignment`)
  appears in lints 0028/0029 (anon/authenticated-executable SECURITY DEFINER) — the
  revoke-all + grant-service_role pattern held. Verified directly as well:
  `has_function_privilege` = false for anon/authenticated, true for service_role.
- **search_path:** none appears in 0011 (mutable search_path) — all five pin `''`.
- **Indexes for the new queries:** verified against pg_indexes — the guard join uses
  `payment_operations(pricing_round_id)` + `campaign_pricing(coupon_assignment_id)`
  (both partial), the end-reason lateral uses `coupon_assignment_events(assignment_id, at)`,
  idempotency uses the unique `(assigned_by, idempotency_key)`, and user/offer filters
  have their partial indexes. ("unused index" hits on these are expected: the consuming
  code is not deployed yet.)

## Findings, all PRE-EXISTING, judged against the intended access model

| lint | findings | judgment |
|---|---|---|
| security_definer_view (ERROR) | 7 console_* views | Intentional console design (deny-all base tables + in-view `is_console_agent()`); recommended follow-up change: `security_invoker=on` + explicit console RLS policies on the base tables. Not part of this change. |
| function_search_path_mutable (WARN) | call_analysis ×2, callback_requests_attempt_monotonic, notify_callback_work | Old functions; small separate fix candidate. |
| rls_enabled_no_policy (INFO) | coupon tables among 47 | The project's deliberate fail-closed pattern: deny-all for browser roles, server via service_role. Intentional. |
| multiple_permissive_policies (WARN) | channels, faq_items, organization_members, profiles | Pre-existing; none on coupon tables. |
| unindexed FKs (INFO, live run) | events.actor_user_id, offer_packages.package_id, offers.created_by, payment_operations.kind | Negligible-traffic columns; per AD design rule, an index is added only when EXPLAIN proves the need. Intentional non-additions also: list phone-search across all states and created_at sort (tiny table). |

Advisors do not replace the concurrency/acceptance checks (verification-d-4-5.md,
verification-acceptance.md). No fix was required by this run; no remote change was made.
