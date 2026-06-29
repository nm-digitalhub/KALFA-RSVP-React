# Verification corrections — applied after the 4-agent plan-vs-code audit (2026-06-29)

> 3 verify agents (billing · channels · RSVP/customer) + 1 ceiling-reconciler checked every plan claim against the LIVE code + DB, adversarially. Verdict: the plans are substantially accurate; the corrections below are folded in. Inline fixes already applied are marked ✅; spec-level corrections to honor at build time are marked ⚠️.

## A. Ceiling contradiction — RESOLVED (stale comments only; code already correct)
The "ceiling = covered×price" (0024 comment + billing-controls plan) contradicted D1=No ("ceiling = full_unique×price"). Reconciler verdict: **the CODE is already `full×price` everywhere** (`campaigns.ts:44-46,102,135-136`; `close-charge.ts:74-77`; `authorize/route.ts:131,156`). `covered_contacts` is a HOLD-sizing system cap (min(full,300)), never a column, never the ceiling. **No code/DDL/D1 change.**
- ✅ Fix A: `0024` line 50 comment → ceiling = full_unique×price; covered sizes the hold only.
- ✅ Fix B: `billing-controls-complete-plan.md` line 34 → same.
- ⚠️ **SAFETY INVARIANT (Phase 2 / Billing T2–T4):** before the hold is lowered to `covered×price`, the authorized-SET membership MUST be the binding cap on `reached` (sole outreach+billing path). Else the `(full−covered)` tail becomes an unsecured, unrecoverable charge — the exact loss 0024 exists to prevent. Today is safe (hold = full×price = ceiling).

## B. Billing plan (verify-billing) — all exists/absent claims CONFIRMED
- ✅ 1.3 — the WhatsApp webhook ALREADY EXISTS (`api/webhooks/whatsapp/route.ts:107` calls `recordReached`); only **removal handling** (`removal_requested=true`) is missing → explicit task (not "when wired").
- ✅ 0.1 edge — `getCampaignBillingSummary` throws ONLY on real RPC `error`; empty-set (nonexistent campaign) is benign (pre-validated via `getCampaignForCharge`).
- ✅ Dispute-phase flag — `campaign_billing_summary` sums ALL `billed_results` (no `control_status` filter); revisit voids/adjustments in the dispute phase (§16).
- ⚠️ Hold-sizing wording: covered/min(full,300) hold-sizing is a **Phase-2 target**, NOT present (today the J5 hold = full `max_charge_ceiling`, `authorize/route.ts:131,156`).
- CONFIRMED live: 0025/0026/0027 APPLIED; 0024 + 0028 absent; `billed_results UNIQUE(event_id,contact_id)`; `billing_credits.campaign_id` nullable; both RPCs absent; `app_settings` close_charge/outreach/whatsapp cols absent (fail-closed).

## C. RSVP + customer (verify-rsvp-customer) — 16/16 CONFIRMED; "backend READY" was OVERSTATED
- ✅ Phase 4 rewritten: **REUSE** anon RPCs `get_rsvp_by_token` + `submit_rsvp` (do NOT extend `guests.ts`); `r/[token]` = CREATE that calls them; default+index already exist.
- ⚠️ **Real added scope:** the RPCs filter ONLY by `rsvp_token` — NO event `status` / `rsvp_deadline` / revocation, and NO throttle. CLAUDE.md mandates these. Add **inside the RPC** (anon is callable directly at `/rest/v1/rpc/submit_rsvp`, bypassing any Next-route rate-limit). `get_rsvp_by_token` must also return `confirmed_adults/kids/meal_pref` for pre-fill.
- ⚠️ `whatsapp-send` builds no RSVP link anywhere → Phase 4 must build + deliver `rsvp_token`→`/r/[token]`.
- ⚠️ D7: a link confirmation delivered via paid outreach → route through `try_record_billed_result` (billable, cross-channel dedup), not just an RSVP-outcome update.
- ⚠️ `requireEventAccess` exists (`events.ts:49`) but is wired into **ZERO** call sites → org members genuinely can't access events (org Phase 3 RLS+DAL swap unbuilt). Stays in Phase 5.
- CONFIRMED: orders orphaned (zero `.insert`); nav advertises it; dashboard 3 bugs (caps@20 `app/page.tsx:26`, raw `event_date:87`, wrong link `:82`); invite email stubbed (`team/actions.ts:92`).

## D. Channels C1+C2 (verify-channels) — 12 CONFIRMED; 1 blocker + 2 dependents
- ⚠️ **(BLOCKER) C1↔C2 dispatch-contract contradiction:** C1 says "C2 owns `work('outreach-call-request')`" (per-contact queue); C2 says the dispatcher is the batch `sendCampaignCalls` "interim until C1 calls it." Mutually exclusive. **Fix:** C2 adds a `work('outreach-call-request')` consumer that dials ONE contact (reusing `startCallScenario`); demote `sendCampaignCalls` to the interim manual trigger (call analog of `whatsapp-send`). C1's `scriptKey`/`touchpointIndex` payload — C2 consumes them or C1 drops them.
- ⚠️ **`writeReach` signature WRONG:** add `campaignId` + `attemptId` (required by `try_record_billed_result` `p_campaign`/`p_attempt`); "inserts billed_results" must mean **via `recordReached`/the RPC**, never a raw insert (raw insert bypasses cap/window/`locked_price`).
- ⚠️ **outreach_state GAP:** reach is async — it arrives at the Voximplant webhook, not the dial worker. The webhook (today `recordReached` only) must ALSO `cancelOutreachForContact` + set `outreach_state='reached'`. Stop-on-reach still holds via the `billed_results` short-circuit (bookkeeping gap, not a correctness break).
- ⚠️ **C1 prereqs omitted:** add `try_record_billed_result` + `campaign_billing_summary` RPCs AND `campaign_authorized_contacts` (0024) to C1's prerequisite list.
- CONFIRMED: cadence = `outreach_schedule` (the dropped `_0011` attempt-policy is gone, `_0014`); pg-boss `^12.21.2`, no `@voximplant/*`; `sendOneWhatsApp` cleanly extractable; `activateCampaign` requires `capture_status='authorized'`; all call enums/columns (`evidence_source` call_asr/dtmf, op-statuses, `recordReached` interface) already live; every `[יוצר]` genuinely absent.

## Net
No code is wrong today; everything is config-gated OFF. The corrections are: 2 comment fixes (done), Phase-4 RSVP-guard scope added, the C1↔C2 dispatch contract reconciled to the per-contact queue, `writeReach` signature fixed, and the Phase-2 hold/set safety invariant recorded. The build order (0 → 1 → 2 → 3 → 4 → 5, channels C1/C2 before outreach go-live) stands.
