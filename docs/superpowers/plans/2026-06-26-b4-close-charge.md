# B4 — Campaign Close-Charge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a campaign closes, charge the ALREADY-HELD card (no re-entry) exactly `min(Σ billed_results.locked_price, max_charge_ceiling)` — once, idempotently, server-derived — by referencing the same SUMIT Customer the J5 hold saved the card against; with NO real charge until close-charge is explicitly enabled.

**Architecture:** A new `captureHeldCardSumit` adapter charges by `Customer.ExternalIdentifier` with **PaymentMethod and SingleUseToken BOTH omitted** (the swagger's "leave empty to use the customer payment method") + `AutoCapture:true` — the only mechanism that charges a saved card without re-entry (the raw-`CreditCard_Token` path was verified to FAIL: "Type should be set to CreditCard" / "Missing CreditCard_ExpirationMonth/Year"). This REQUIRES the J5 hold to have saved the card against a STABLE, recoverable Customer identifier — so Task 2 fixes the hold (today it uses a throwaway `crypto.randomUUID()`). A config-gated `closeCampaignAndCharge` orchestrator closes the campaign, reads `campaign_billing_summary` (from B2), computes the amount, and charges once via an atomic `charge_status` guard.

**Tech Stack:** Next.js 16 (server data layer + Route Handler), SUMIT `billing/payments/charge` (Customer-reference charge), Supabase service-role, Zod 4, Vitest. No new npm packages.

## Global Constraints

- **Config-gated / fail-closed:** no charge unless `getPaymentsEnabled()` AND a new `getCloseChargeEnabled()` flag AND `getSumitServerConfig()` are all on. Default OFF.
- **Money = explicit approval + advisor:** real charges are an explicit-permission action (CLAUDE.md). Go-live (Task 7) requires the user's explicit OK and an advisor checkpoint, and is tested on a single controlled campaign first.
- **Server-derived amount ONLY:** `amount = min(accrued, ceiling)` where `accrued`/`ceiling` come from the B2 `campaign_billing_summary` RPC. NEVER trust a client-submitted amount. Partial charge IS supported (any amount ≤ ceiling, including ₪0).
- **Charge EXACTLY once (idempotent):** an atomic optimistic guard on `charge_status` (null/charge_failed → 'pending') is the only path to a charge; a `'charged'` campaign can never be re-charged. Network/ambiguous outcome → `charge_review`, NOT a retry (mirrors `chargeSumit`'s SumitNetworkError vs SumitDeclinedError contract).
- **The verified SUMIT mechanism** ([[sumit-charge-verified-behavior]]): charge by `Customer.ExternalIdentifier` (the hold's stable ref), PaymentMethod EMPTY, no SingleUseToken, `AutoCapture:true`, `Items:[{ Item.Name … }]`, `PreventDocumentCreation` per policy. Status enum 0/1/2 (Success/BusinessError/TechnicalError) — reuse the `authorize.ts` parsing contract, NOT `{IsError}`.
- **Migrations hit the LIVE Supabase** ([[supabase-live-schema]]): write the `.sql`, introspect first, apply only with explicit approval; don't regenerate types from-scratch (use the forward-compatible `select('*')`/cast pattern for new columns).
- **PII / secrets:** never log the API key, card token, customer ref, or amounts tied to a person. CitizenID stays unstored.
- **Build discipline:** one `npm run build` + immediate `pm2 restart kalfa-beta`; users hard-refresh after a deploy.

## Existing code/schema this builds on (verified)

- `src/lib/sumit/authorize.ts` `authorizeHoldSumit` — J5 hold: `Customer.ExternalIdentifier = authRef`, `AutoCapture:false`, `AuthorizeAmount`, returns AuthNumber + CreditCard_Token. Parses Status as number/enum-string/`{IsError}`. **Reuse this parsing shape for the charge adapter.**
- `src/lib/sumit/charge.ts` `chargeSumit` — route B charge that REQUIRES `SingleUseToken` (fresh card). **Does NOT fit B4** (no fresh token at close); B4 needs a saved-Customer charge. Reuse its `SumitNetworkError`/`SumitDeclinedError` classes + DocumentID parsing.
- `src/app/api/campaigns/[id]/authorize/route.ts:143` — `const authRef = crypto.randomUUID()` → **the bug**: the card is saved against an unrecoverable Customer. Task 2 fixes this.
- `src/lib/data/campaigns.ts` — `getCampaignForHold`, `lockCampaignForHold` (atomic optimistic guard pattern to copy), `recordCampaignHold`, `closeCampaign` (active/paused/approved/scheduled → closed). `CAMPAIGN_COLUMNS`.
- `src/lib/data/billing.ts` `getCampaignBillingSummary(campaignId)` → `{ reachedCount, accrued, ceiling, maxContacts }` (B2 RPC) — the amount source.
- `src/lib/data/payments.ts` `getPaymentsEnabled`, `getSumitServerConfig`, `getCampaignHoldsEnabled` (the forward-compatible flag-reader pattern), `VAT_RATE_PERCENT`.
- `campaigns` columns: has `final_charge_amount`, `capture_status`, `card_token_ref`, `auth_*`, `max_charge_ceiling`, `close_at`, `sumit_order_document_id`. MISSING (Task 1 adds): `sumit_customer_ref`, `charge_status`, `charged_at`, `sumit_charge_document_id`.

---

## File Structure

- Create `supabase/migrations/<ts>_campaign_close_charge.sql` — campaigns: `sumit_customer_ref`, `charge_status`, `charged_at`, `sumit_charge_document_id`; app_settings: `close_charge_enabled`.
- Create `src/lib/sumit/capture.ts` — `captureHeldCardSumit` (charge saved Customer, no token).
- Modify `src/app/api/campaigns/[id]/authorize/route.ts` — stable customer ref.
- Modify `src/lib/data/campaigns.ts` — persist `sumit_customer_ref` in the hold; add `getCampaignForCharge`, `lockCampaignForCharge`, `recordCampaignCharge`, `markCampaignChargeFailed`.
- Modify `src/lib/data/payments.ts` — `getCloseChargeEnabled()`.
- Create `src/lib/data/close-charge.ts` — `closeCampaignAndCharge` orchestrator.
- Create `src/app/api/campaigns/[id]/close-charge/route.ts` — gated trigger.
- Tests alongside each.

---

## Task 1: Migration — charge columns + flag (apply only with approval)

**Files:** Create `supabase/migrations/<ts>_campaign_close_charge.sql`

- [ ] **Step 1: Introspect** — confirm the columns are absent on `campaigns`/`app_settings`.
- [ ] **Step 2: Write the migration**

```sql
alter table public.campaigns
  add column if not exists sumit_customer_ref text,        -- stable Customer.ExternalIdentifier from the hold
  add column if not exists charge_status text,             -- null | pending | charged | charge_failed | charge_review | nothing_to_charge
  add column if not exists charged_at timestamptz,
  add column if not exists sumit_charge_document_id integer;

alter table public.app_settings
  add column if not exists close_charge_enabled boolean not null default false;
```

- [ ] **Step 3: DO NOT push.** Surface SQL; explicit approval to apply (one-off Management-API write). No type regen (readers cast).
- [ ] **Step 4: Commit** the `.sql`: `chore(db): campaign close-charge columns + flag (pending apply)`.

---

## Task 2: Stable Customer ref at hold time (fixes the throwaway UUID)

**Files:** Modify `src/app/api/campaigns/[id]/authorize/route.ts`; Modify `src/lib/data/campaigns.ts` (`recordCampaignHold`).

**Interfaces:**
- Produces: holds now persist `campaigns.sumit_customer_ref = 'kalfa-campaign-' + campaignId` (deterministic, recoverable). `recordCampaignHold` accepts `customerRef: string` and writes it.

- [ ] **Step 1: Failing test** (`campaigns.test.ts`) — `recordCampaignHold` writes `sumit_customer_ref` alongside the existing fields. (cast for the new column.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — in the route, replace `const authRef = crypto.randomUUID()` with `const customerRef = \`kalfa-campaign-${campaignId}\``; pass it as the adapter `authRef` AND to `recordCampaignHold(campaignId, { …, customerRef })`. In `recordCampaignHold`, add `sumit_customer_ref: customerRef` to the update (cast the payload — new column not in types).
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `fix(billing): hold saves the card against a stable, recoverable SUMIT Customer`.

> Existing holds (e.g. the ₪4 test) have a random ref and CANNOT be close-charged — acceptable; only holds placed AFTER this fix are chargeable. Note this at go-live.

---

## Task 3: Saved-Customer charge adapter

**Files:** Create `src/lib/sumit/capture.ts`; Test `src/lib/sumit/capture.test.ts`.

**Interfaces:**
- Produces: `captureHeldCardSumit(p: { companyId: number; apiKey: string; customerRef: string; amount: string; vatRate: string; customerEmail: string }): Promise<{ documentId: number }>`. Throws `SumitDeclinedError` on a definite business decline, `SumitNetworkError` on any ambiguous/network/parse outcome. Reuses the error classes from `charge.ts`.

- [ ] **Step 1: Failing test** — mock `fetch`:
  - builds a body with `Customer.ExternalIdentifier = customerRef`, NO `SingleUseToken`, NO `PaymentMethod`, `AutoCapture: true`, `Items:[{ Quantity:1, UnitPrice:amount, Item:{ Name } }]`; returns `{ documentId }` from `Data.DocumentID` on Status success(0).
  - throws `SumitDeclinedError` on Status business-error(1)/`{IsError:true}`.
  - throws `SumitNetworkError` on non-2xx / missing DocumentID / fetch throw.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { captureHeldCardSumit } from './capture';
import { SumitDeclinedError, SumitNetworkError } from './charge';

const base = { companyId: 1, apiKey: 'k', customerRef: 'kalfa-campaign-c1', amount: '4', vatRate: '18', customerEmail: '' };
afterEach(() => vi.restoreAllMocks());

it('charges the saved Customer with an empty payment method (no token)', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Status: 0, Data: { DocumentID: 555 } }) });
  vi.stubGlobal('fetch', fetchMock);
  const r = await captureHeldCardSumit(base);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.Customer.ExternalIdentifier).toBe('kalfa-campaign-c1');
  expect(body.SingleUseToken).toBeUndefined();
  expect(body.PaymentMethod).toBeUndefined();
  expect(body.AutoCapture).toBe(true);
  expect(r.documentId).toBe(555);
});
it('throws SumitDeclinedError on a business decline', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Status: 1 }) }));
  await expect(captureHeldCardSumit(base)).rejects.toBeInstanceOf(SumitDeclinedError);
});
it('throws SumitNetworkError when DocumentID is missing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Status: 0, Data: {} }) }));
  await expect(captureHeldCardSumit(base)).rejects.toBeInstanceOf(SumitNetworkError);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `capture.ts` — body per the verified mechanism; Status parsing copied from `authorize.ts` (number 0/1/2 OR enum-string OR `{IsError}`): business-error(1)/IsError → `SumitDeclinedError`; success(0) + DocumentID → return; anything else → `SumitNetworkError`. `Item.Name` required; `PreventDocumentCreation:false` (a real receipt at charge); `SendDocumentByEmail: !!customerEmail`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(sumit): charge a held card via saved Customer (no re-entry) — close-charge adapter`.

---

## Task 4: Close-charge data layer

**Files:** Modify `src/lib/data/campaigns.ts`; tests in `campaigns.test.ts`.

**Interfaces:**
- `getCampaignForCharge(campaignId)` → `{ id, event_id, status, capture_status, charge_status, sumit_customer_ref, max_charge_ceiling } | null` (admin).
- `lockCampaignForCharge(campaignId)` → atomic `update({charge_status:'pending'}).eq('id',id).or('charge_status.is.null,charge_status.in.(charge_failed,charge_review)').select('id').maybeSingle()` → returns `data!==null` (copy `lockCampaignForHold`).
- `recordCampaignCharge(id, { amount: number; documentId: number })` → `charge_status='charged'`, `final_charge_amount=amount`, `sumit_charge_document_id=documentId`, `charged_at=now()`.
- `markCampaignChargeOutcome(id, 'charge_failed'|'charge_review'|'nothing_to_charge')` → sets `charge_status` (and `final_charge_amount=0`,`charged_at=now()` for nothing_to_charge).

- [ ] **Step 1-4 (TDD):** assert the atomic guard `.or(...)` shape, the recorded fields, and the outcome transitions. (New columns → cast the payloads.)
- [ ] **Step 5: Commit** `feat(billing): close-charge data layer (atomic charge guard + record/outcome)`.

---

## Task 5: Close-charge orchestrator

**Files:** Create `src/lib/data/close-charge.ts`; Test `src/lib/data/close-charge.test.ts`.

**Interfaces:**
- Consumes: `getPaymentsEnabled`, `getCloseChargeEnabled`, `getSumitServerConfig`, `closeCampaign`, `getCampaignForCharge`, `lockCampaignForCharge`, `getCampaignBillingSummary`, `captureHeldCardSumit`, `recordCampaignCharge`, `markCampaignChargeOutcome`, `VAT_RATE_PERCENT`.
- Produces: `closeCampaignAndCharge(campaignId): Promise<{ outcome: 'charged'|'nothing_to_charge'|'declined'|'review'|'disabled'|'bad_state'; amount: number }>`.

- [ ] **Step 1: Failing tests** (mock all deps):
  - disabled (any flag/config off) → `{outcome:'disabled', amount:0}`, adapter NOT called.
  - missing `sumit_customer_ref` (pre-fix hold) or `capture_status !== 'authorized'` → `{outcome:'bad_state'}`, adapter NOT called.
  - `accrued = 0` → close, `markCampaignChargeOutcome(id,'nothing_to_charge')`, `{outcome:'nothing_to_charge', amount:0}`, adapter NOT called.
  - happy: `amount = min(accrued, ceiling)`; `lockCampaignForCharge` true → `captureHeldCardSumit` with that amount → `recordCampaignCharge` → `{outcome:'charged', amount}`.
  - `lockCampaignForCharge` false (already charging/charged) → `{outcome:'bad_state'}`, adapter NOT called (idempotent).
  - `SumitDeclinedError` → `markCampaignChargeOutcome(id,'charge_failed')`, `{outcome:'declined'}`; `SumitNetworkError` → `'charge_review'`, `{outcome:'review'}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — order: gate → closeCampaign (active/paused→closed) → getCampaignForCharge (require capture_status='authorized' + sumit_customer_ref) → summary → `amount=Math.min(accrued, ceiling)` → if `amount<=0` nothing_to_charge → else `lockCampaignForCharge` (false→bad_state) → try `captureHeldCardSumit` → recordCampaignCharge; catch Declined→charge_failed, Network→charge_review.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(billing): closeCampaignAndCharge orchestrator (server-derived amount, idempotent)`.

---

## Task 6: Gated close-charge trigger route

**Files:** Create `src/app/api/campaigns/[id]/close-charge/route.ts`.

- [ ] **Step 1: Implement** mirroring `authorize/route.ts`: CSRF (APP_ORIGIN), `requireUser`, load campaign + `requireOwnedEvent`, fail-closed gate (`getPaymentsEnabled` + `getCloseChargeEnabled` + `getSumitServerConfig`), call `closeCampaignAndCharge`, 303 redirect (built from `APP_ORIGIN`, not request.url) with the outcome. NO client amount is read.
- [ ] **Step 2: Typecheck** → clean.
- [ ] **Step 3: Commit** `feat(billing): gated campaign close-charge trigger route`.

---

## Task 7: Go-live verification (BEFORE enabling — real money)

- [ ] **Step 1:** Apply the Task-1 migration (approval). Place a NEW J5 hold (post-Task-2) so a stable `sumit_customer_ref` exists. Drive one `billed_result` for that campaign (via the B2 webhook test) with a known small `locked_price` (e.g. ₪4).
- [ ] **Step 2:** One build + restart; hard-refresh.
- [ ] **Step 3:** Set `close_charge_enabled=true`. Trigger `closeCampaignAndCharge` for that ONE campaign. Verify — a SUMIT charge for EXACTLY the accrued amount (≤ ceiling) on the held card with NO re-entry, `charge_status='charged'`, `final_charge_amount` + `sumit_charge_document_id` set, and that a second trigger is a no-op (idempotent). Verify a campaign with 0 billed_results → `nothing_to_charge`, ₪0 charged.
- [ ] **Step 4:** Advisor checkpoint (this is the money path). Then decide rollout. Leave `close_charge_enabled=false` until the user signs off on broad use.

---

## Self-Review notes

- **Spec coverage:** charge the held card without re-entry via the verified Customer-ref/empty-PaymentMethod mechanism (T3), stable recoverable Customer at hold time (T2, the documented bug-fix), amount = min(Σ locked_price, ceiling) server-derived from B2's summary (T5), idempotent single charge via atomic guard (T4/T5), declined-vs-review outcome split (T3/T5), config-gated/fail-closed (T5/T6), partial/₪0 charge supported (T5 nothing_to_charge). This closes the loop: J5 hold → B3 outreach → B2 billed_results → **B4 charges what was actually accrued.**
- **Out of scope (follow-on):** credits/`manual_adjustment` deduction (T5 uses accrued as-is — wire credits when the product defines them); the pg-boss auto-close at `close_at` (T6 is a manual/triggered close; the scheduler plan can call `closeCampaignAndCharge`); refunds.
- **Type consistency:** `sumit_customer_ref`/`charge_status`/`charged_at`/`sumit_charge_document_id` identical across T1/T2/T4/T5; `captureHeldCardSumit` param/return shape identical T3↔T5; outcome strings identical T5↔T6; error classes reused from `charge.ts`.
- **Open decision:** whether close is owner-triggered (T6) or admin-only or auto at `close_at` (scheduler) — confirm before broad rollout; and the VAT treatment of the accrued sum (locked_price VAT-inclusive vs not).
