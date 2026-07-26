# Pricing model change: flat base + included + overage

**Status:** PLAN — awaiting owner approval before any code. Billing is cross-cutting → plan-first per CLAUDE.md.
**Owner-locked model (2026-07-26):** base **₪200** · included **200 reached** · overage **₪4 per reached above 200**.
**Count basis:** reached (a guest who replied on WhatsApp OR completed an AI call) — the existing per-reached definition.

All facts below are VERIFIED-LIVE (code + DB + settings) via the billing, campaign, and pricing sub-agents on 2026-07-26.

---

## 1. Locked model (the math)

Let `reached` = billed reached count, `included` = 200, `base` = ₪200, `overage` = ₪4, `funded` = frozen authorized-set size.

- **Final charge** = `base + max(0, reached − included) × overage − credits` (rounded to agorot, floored at 0).
- **Ceiling** (signed, disclosed) = `base + max(0, funded − included) × overage`. Since `reached ≤ funded` (freeze), the charge is naturally ≤ ceiling.
- **J5 hold** reserves toward the ceiling (max possible), not a cap on the charge (the final charge is a fresh J4 on the saved token, NOT a capture — it is not limited by the hold; owner-confirmed 2026-07-26, verified `close-charge.ts:106-108`).

### Economics (why these numbers) — from the cost sub-agent
- Marginal cost per reached: **₪0.05–1.03** (WhatsApp ~₪0.15–0.30; live AI call via **ElevenLabs** ~₪0.43; worst ₪1.03). Effective cost incl. unreached-guest leakage: ₪0.40 (R=0.7) → ₪1.20 (R=0.5 + many calls).
- **Overage ₪4 → 74–88% gross margin.** Cost never pushes above ₪4. Equals the existing `price_per_reached=4` → that field is REUSED as the overage rate, value unchanged.
- **Base ₪200/200 = ₪1/reached.** Very profitable on small/medium events (25–100 reached → ₪80–190 profit). A bounded "loss valley" (~167–200 reached) appears ONLY under low response + many AI calls — and **AI calls are still dark**, so today (WhatsApp-only) the base is safely profitable even at 200. Owner decision: keep 200-included as a deliberate low-risk acquisition play; monitor response-rate + call-share when calls go live.

---

## 2. Current state (verified) — what has to change

| Concern | Today | Source |
|---|---|---|
| Rate | single `packages.price_per_reached=4`, applied to EVERY reach from the first | `billing.ts` / RPC `try_record_billed_result` |
| `billed_results` | one row per reach at `locked_price=4` (raw reached ledger — no "included tier") | live RPC |
| Charge | `min(Σ locked_price, ceiling) − credits` | `close-charge.ts:106-108` |
| Ceiling | `max_charge_ceiling = full × price` | `campaigns.ts` `computeCeiling` |
| Hold | `max(covered, frozenSetSize) × price × (1+buffer)`, floor `min_hold_floor` | `campaigns.ts:537-542` |
| Freeze | at **J5 hold** (`snapshotAuthorizedSet` → `campaign_authorized_contacts`); billing is fail-closed to the set, cross-channel | `contacts.ts:406`, RPC |
| `price_with_vat=200` | DISPLAY-only field (owner already set it) — not used in charge math | form label "מחיר סופי לצרכן" |

**Key structural fact:** "first 200 included, then overage" is a **close-charge computation change** — `billed_results` stays the raw reached ledger; the tiering lives in the summary/capture. This is a `sumit-billing-expert`-domain change, NOT a campaign-engine change (honors the campaign-rework constraint: do not change J5-hold / per-reached-record / freeze semantics).

---

## 3. DECISION POINTS (need owner/attorney answers before/within implementation)

- **D1 — RESOLVED (owner, 2026-07-26): the ₪200 base is charged ALWAYS** — when the campaign settles, regardless of reached count (0 reached ⇒ ₪200, not ₪0). It is a service fee, a deliberate shift from pure-outcome. Close-charge formula therefore always adds `base`. **⚠️ Consumer-protection: charging with 0 results MUST be clearly disclosed in the signed agreement (חוק הגנת הצרכן) — reinforces the S6 attorney gate; the base-always-charge term is not optional wording.**
- **D2 — GAP A pinning (the timing seam):** terms are signed around the authorize/hold step, but `max_contacts`/ceiling/frozen-set are computed at the hold from the LIVE guest list. The `base`/`included`/`overage`/`funded`/`ceiling` must ALL be **snapshotted onto the campaign at the SAME moment the agreement is signed**, and the signed PDF must quote those snapshotted values. Recommendation: snapshot at the authorize/hold step (where `snapshotAuthorizedSet` already runs) and render the agreement from the snapshot. Attorney confirms the agreement wording; this plan wires the snapshot.
- **D3 — Agreement wording + document/VAT** — OUT OF SCOPE for this plan's code: the signed-agreement clause text → `israeli-compliance-advisor` → attorney; which document type (קבלה vs חשבונית) and VAT treatment of the base+overage → `israeli-tax-advisor`. This plan produces the *mechanism*; wording/legal are gated separately.

---

## 4. Staged implementation (each stage reviewable; billing stages behind approval)

### S1 — Schema (migration; rls-schema-engineer)
Add to `packages`: `base_price numeric`, `included_reached int` (both nullable → campaign-enabled only, like `price_per_reached`). Keep `price_per_reached` = the overage rate.
Add to `campaigns` (snapshot columns, mirroring existing `price_per_reached`/`max_charge_ceiling` locks): `base_price numeric`, `included_reached int`. Backfill existing campaigns as `base_price=0, included_reached=0` (⇒ identical to today's pure per-reached, no behaviour change for in-flight campaigns).
**GAP D:** add a partial UNIQUE index on `campaigns(event_id)` where status is non-terminal, to make one-campaign-per-event a DB invariant (today app-level only → race can double the allotment).
Migration applied via `supabase db push` — **user runs** (classifier-gated). Rollback = drop columns/index (additive, safe).

### S2 — Close-charge + ceiling math (sumit-billing-expert)
- Rewrite the charge formula in `campaign_billing_summary` / `close-charge.ts`: `amount = base + max(0, reached − included) × overage − credits`, using the campaign's SNAPSHOT columns (never the live package). Per D1 for the 0-reached case.
- Redefine ceiling at snapshot time: `base + max(0, funded − included) × overage`.
- `billed_results` unchanged (raw reached ledger at `locked_price`=overage rate). The included tier is applied ONLY in the summary/close computation.
- Verification: unit tests over the formula at reached = 0 / 1 / 100 / 200 / 201 / 300 with/without credits; boundary at exactly `included`.

### S3 — Snapshot + hold sizing at authorize (GAP A, B, C)
- In `prepareCampaignHold`: snapshot `base_price`, `included_reached`, `price_per_reached` (overage), `max_contacts`, and the new `ceiling` onto the campaign at the SAME moment as `snapshotAuthorizedSet`.
- Size the hold toward the new ceiling (max possible charge) so the fresh J4 has reserved credit.
- **GAP B guard:** assert/adjust so `funded ≥ included` is understood — if an event has fewer funded contacts than `included`, the base still applies (customer has fewer contacts; not an error) — document, don't block.
- **GAP C guard:** keep `hold_buffer_pct=0`; add a validation warning if an admin sets buffer>0 while a base+overage package is active (buffer>0 lets reconcile admit net-new members past the signed included count).

### S4 — Admin form + validation (no placeholders — the owner's requirement)
- `package-form.tsx`: add `base_price` ("מחיר בסיס (₪)") and `included_reached` ("כמות מושגים כלולה בבסיס") inputs in the campaign section; keep `price_per_reached` but relabel to "מחיר לכל מושג מעבר לכלול (חריגה, ₪)".
- `packageBaseSchema`/`operationalFieldsSchema` in `validation/admin.ts`: parse+coerce the two new fields (campaign-enabled ⇒ required together with overage; else null).
- Update the package **description** (currently states the OLD model) to the base+overage wording, and fill `includes` (e.g. "עד 200 מוזמנים שנענו כלול · וואטסאפ + שיחות AI · מעבר לכך ₪4 למושג").
- Result: every pricing fact (base, included, overage) is a real admin-set field → billing engine AND the Stage-2 drafter read live values, never a `[placeholder]`.

### S5 — Stage-2 grounding (the drafter answers pricing) — SEPARATE, after S1–S4 land
- `business-facts` CLI verb returns the live base/included/overage from `packages` (PII/secret-free). The support-drafter reads it and writes the real pricing answer instead of `[מחירים]`. (This is the already-designed Stage 2; it now grounds the NEW model.)

### S6 — Agreement + legal/tax (gated, not code-first)
- Agreement PDF renders the snapshotted base/included/overage/ceiling (D2). Clause wording → attorney (D3). Document type/VAT → tax advisor (D3).

---

## 5. Gaps carried from the freeze audit (must all be closed)
- **A** timing seam → S3 snapshot at one moment + agreement renders the snapshot.
- **B** `funded ≥ included` → S3 documents the fewer-contacts case; ceiling/base still correct.
- **C** `hold_buffer_pct=0` → S3 guard against buffer>0 with a base+overage package.
- **D** one-campaign-per-event → S1 partial UNIQUE on `campaigns(event_id)`.
- **E** single billing regime → design against `billing_exposure_gate=false` (set-membership). Do NOT flip the exposure gate as part of this change.

## 6. Verification (Definition of Done)
- `campaign_billing_summary` formula unit tests (S2 boundaries above).
- Package form + validation tests (new fields; campaign-enabled requires all three; non-campaign leaves them null).
- Migration verified live (columns + partial unique present; existing campaigns backfilled to base=0/included=0 = no behaviour change).
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, focused tests pass.
- Manual: create/edit the package with base=200/included=200/overage=4; authorize a test campaign; confirm the snapshot + ceiling + a dry close-charge at reached=0/150/250 produce base / base / base+200 respectively.

## 7. Risks & open owner-inputs (from the cost analysis — do NOT block ₪4 overage)
- WhatsApp UTILITY price for Israel (₪0.02–0.15; verify from BSP invoice + free-tier eligibility), Voximplant Israel rate, clearing fee (1.1–2%), avg call duration, response rate R. None change the ₪4 overage decision (robust across all). They matter for monitoring the base's loss-valley when AI calls go live.
- D1 (base-always-charged) and D3 (legal/tax) are the gating unknowns.

## 8. Out of scope
Agreement clause wording (attorney), document type/VAT (tax advisor), flipping `billing_exposure_gate`, changing the freeze/per-reached-record semantics.
