# Event Cancellation Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the CASCADE-delete billing-audit gap found in `docs/production-readiness/2026-08-21-go-no-go.md` §1.2, and replace direct customer self-delete of an `active`/`closed` event with a staff-mediated cancellation-request flow (request number, an actually-executed resolution — full/partial/decline — email + opt-in SMS notification) that implements the agreement's own §5 cancellation-fee clause.

**Architecture:** Two independent DB migrations (FK hardening + delete-restriction; new request table + cancellation-fee policy config), one small extension to the EXISTING `closeCampaignAndCharge` (`src/lib/data/close-charge.ts`) to accept an admin-supplied override amount so a cancellation resolution reuses the same proven SUMIT capture path a normal campaign close already uses, a new `src/lib/data/event-cancellation.ts` data module mirroring `contacts.ts`'s inquiry-reply and `callback-scheduling.ts`'s no-contact-SMS patterns, one customer-facing request form, one admin queue+resolve surface.

**Tech Stack:** Next.js Server Actions, Supabase Postgres (RLS + migrations), SUMIT capture (`@/lib/sumit/capture.ts`, already proven), email sender (`@/lib/email/sender`), ExtrA SMS sender (`@/lib/sms/sender`), Zod, Vitest.

**Spec:** This document IS the spec — synthesized directly from the conversation with the owner (2026-08-21) on top of the production-readiness audit findings and the pending legal research on Consumer Protection Law §14ג/§14ה (`legal-cancellation-research` agent, still running as this plan is written — see the "OPEN LEGAL QUESTION" callout in Task 3).

## Global Constraints

- Every new/changed money-adjacent write goes through `requirePlatformPermission('manage_billing')` — resolving a cancellation request is a billing decision (reuses the existing permission key seeded in `20260713171233_*`, not a new one).
- Email is the primary, mandatory, blocking notification (mirrors `sendInquiryReply`: send-then-persist, throws on failure, nothing is persisted if the send fails). SMS is a secondary, best-effort, opt-in-only channel (mirrors `sendNoContactSms`: never throws, failure recorded not surfaced).
- **Two SUMIT operations, both automated by this plan, via the SAME `/billing/payments/charge/` endpoint:**
  - **Capturing money from a still-open hold** (`captureHeldCardSumit`, arbitrary amount, already proven in `close-charge.ts`) — THIS is what "full cancellation" (₪0, i.e. never capture) and "partial charge" (capture a specific amount) both are, when the campaign has not yet been closed/charged. Automated via Task 4's extension.
  - **Refunding money that was ALREADY charged** — verified directly in the repo-root `swagger.json` (SUMIT's own OpenAPI spec): the SAME charge endpoint takes a `SupportCredit: boolean` parameter ("Allow credit instead of charge (debit), in case the total is less than 0?") — a negative item total + `SupportCredit:true` performs a real credit/refund and issues a credit-note document, the correct Israeli-accounting document type for a refund. Automated via Task 4B's `creditHeldCardSumit`. **UNTESTED against the live SUMIT API as of this plan** — `captureHeldCardSumit`'s own code comments document several hard-won empirical gotchas for the charge direction (no VATRate, no CreditCardAuthNumber, AutoCapture:true) that may or may not carry over to a credit; Task 11's sandbox dry run must exercise BOTH directions, on a test card only, before this ships to a real customer. If the automated credit attempt itself declines or errors, resolution surfaces that to staff rather than silently recording success — a manual SUMIT step remains the fallback ONLY for that failure case, not the default path.
- The cancellation-fee formula (currently "עד 5% מערך העסקה או ₪100, לפי הנמוך" per agreement §5) is stored as CONFIGURABLE DATA (`app_settings` columns, Task 3), never hardcoded as logic — per [[no-hardcoded-business-facts]] and because the legal-catalog review of this exact clause is still open (`docs/production-readiness/2026-08-21-go-no-go.md` §1.3). A number change from counsel becomes a data update, not a code change.
- A computed amount is always a SUGGESTION shown to staff, never an auto-submit — a human confirms the final number before anything is captured, per [[no-impulsive-execution]].
- The existing owner self-service `closeEvent` (event-status-actions.tsx, active→closed) is untouched — it remains available and is orthogonal to this feature. This feature only removes DELETE, not the existing CLOSE button.
- Hebrew user-facing strings throughout; RTL; follow `src/app/(admin)/admin/contacts/*` and `src/app/(customer)/app/events/[id]/event-status-actions.tsx` styling conventions exactly (same button classes, same `ActionButton`/`FormError`/`FormNotice` components).
- Migration timestamps: `YYYYMMDDHHMMSS`, created via `supabase migration new <name>` per [[supabase-official-tooling]] — never hand-authored filenames.

---

## Task 1: FK hardening (events → billed_results / campaign_authorized_contacts / campaign_authorized_set_audit)

**Files:**
- Create: `supabase/migrations/<ts>_events_delete_restrict_billing_fk_hardening.sql`
- Test: `supabase/migrations/<ts>_events_delete_restrict_billing_fk_hardening.sql` is verified live via `mcp__supabase__execute_sql` (SELECT-only), not vitest — this is a DB-schema task.

**Interfaces:**
- Consumes: nothing (independent of every other task; can ship alone).
- Produces: `events_owner_delete` policy now requires `status = 'draft'`; the 6 FKs listed below are RESTRICT.

- [ ] **Step 1: Confirm current constraint names and delete rule live**

```sql
select conname, confrelid::regclass as parent, conrelid::regclass as child, confdeltype
from pg_constraint
where confrelid in ('events'::regclass, 'campaigns'::regclass)
  and conrelid in ('billed_results'::regclass, 'campaign_authorized_contacts'::regclass, 'campaign_authorized_set_audit'::regclass);
```
Expected: 6 rows (2 tables × ... actually 3 tables × 2 parent refs = up to 6), `confdeltype = 'c'` (CASCADE) on all of them except any already RESTRICT.

- [ ] **Step 2: Write the migration**

```sql
-- Harden the audit/billing trail: a customer (or anyone) deleting an event or
-- campaign must never silently wipe what was billed or who authorized it.
-- Matches the existing billed_results_contact_id_fkey RESTRICT precedent.
-- Found by the 2026-08-21 production-readiness audit (docs/production-readiness/2026-08-21-go-no-go.md §1.2).

ALTER TABLE public.billed_results
  DROP CONSTRAINT billed_results_event_id_fkey,
  ADD CONSTRAINT billed_results_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.billed_results
  DROP CONSTRAINT billed_results_campaign_id_fkey,
  ADD CONSTRAINT billed_results_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_contacts
  DROP CONSTRAINT campaign_authorized_contacts_event_id_fkey,
  ADD CONSTRAINT campaign_authorized_contacts_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_contacts
  DROP CONSTRAINT campaign_authorized_contacts_campaign_id_fkey,
  ADD CONSTRAINT campaign_authorized_contacts_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_set_audit
  DROP CONSTRAINT campaign_authorized_set_audit_event_id_fkey,
  ADD CONSTRAINT campaign_authorized_set_audit_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;

ALTER TABLE public.campaign_authorized_set_audit
  DROP CONSTRAINT campaign_authorized_set_audit_campaign_id_fkey,
  ADD CONSTRAINT campaign_authorized_set_audit_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE RESTRICT;

-- Direct self-delete now only reaches a draft event (guaranteed by the
-- campaigns_require_active_event trigger, R9, to have zero billing history —
-- see src/lib/data/campaigns.ts:181-186). Anything past draft goes through
-- the new event_cancellation_requests flow (Task 2+).
DROP POLICY IF EXISTS "events_owner_delete" ON public.events;
CREATE POLICY "events_owner_delete" ON public.events
  FOR DELETE TO authenticated
  USING (owner_id = (select auth.uid()) AND status = 'draft');
```

Use the EXACT constraint names from Step 1's query output — the names above are the expected Postgres default-naming convention (`<table>_<column>_fkey`); if Step 1 shows different names, use those instead.

- [ ] **Step 3: Apply via `supabase migration new` + `db push` (or `apply_migration` MCP), then re-run Step 1's query**

Expected: all 6 rows now `confdeltype = 'r'` (RESTRICT). Then:

```sql
select qual from pg_policies where tablename='events' and policyname='events_owner_delete';
```
Expected: contains both `owner_id` and `status = 'draft'::text` (or equivalent).

- [ ] **Step 4: Regenerate types.ts**

Run: `supabase gen types --linked` per [[no-hand-editing-generated-artifacts]] — this task touches no TypeScript types directly, but run it anyway since the RLS/FK change alone doesn't change `types.ts` shape; skip if `git diff` on `types.ts` is empty.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<ts>_events_delete_restrict_billing_fk_hardening.sql
git commit -m "fix(billing): RESTRICT event/campaign FKs into billed_results/audit tables, gate self-delete to draft-only"
```

---

## Task 2: `event_cancellation_requests` table + RLS

**Files:**
- Create: `supabase/migrations/<ts>_event_cancellation_requests.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `event_cancellation_requests` with columns `id, request_number, event_id, owner_id, reason, sms_consent, status, resolution, resolution_amount, capture_outcome, sumit_document_id, sumit_document_url, resolution_note, resolved_by, resolved_at, created_at, updated_at` — used by Task 5's data module.

- [ ] **Step 1: Write the migration**

```sql
-- Customer-initiated request to cancel (ביטול עסקה) an active/closed event.
-- Resolution is a staff billing decision — for a pre-charge campaign it is
-- EXECUTED (SUMIT capture, Task 4's closeCampaignAndCharge override) and the
-- outcome recorded here; for a post-charge campaign the refund is manual
-- (no SUMIT refund capability exists) and this row just records the decision.
-- See docs/superpowers/plans/2026-08-21-event-cancellation-request.md.

CREATE TABLE public.event_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 2000),
  sms_consent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution text CHECK (resolution IN ('full_cancellation', 'partial_charge', 'declined')),
  -- The final amount captured (full_cancellation⇒0, partial_charge⇒staff-confirmed
  -- amount) OR, for the post-charge manual-refund case, the amount staff intends
  -- to refund (not captured by this system — see capture_outcome).
  resolution_amount numeric,
  -- 'captured' = SUMIT capture executed by this flow (pre-charge campaign);
  -- 'manual_refund_required' = campaign was already charged, staff must refund
  -- via SUMIT outside this system; 'not_applicable' = declined, nothing to move.
  capture_outcome text CHECK (capture_outcome IN ('captured', 'manual_refund_required', 'not_applicable')),
  sumit_document_id bigint,
  sumit_document_url text,
  resolution_note text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_cancellation_requests_event_id_idx ON public.event_cancellation_requests(event_id);
CREATE INDEX event_cancellation_requests_owner_id_idx ON public.event_cancellation_requests(owner_id);
CREATE INDEX event_cancellation_requests_pending_idx ON public.event_cancellation_requests(created_at) WHERE status = 'pending';

CREATE TRIGGER event_cancellation_requests_set_updated_at
  BEFORE UPDATE ON public.event_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Terminal-state guard, same pattern as campaign_authorized_set_audit_no_mutate
-- and the campaigns terminal charge_status guard: once resolved, the row is
-- append-only history — a second resolve must be a NEW request, not an edit.
CREATE OR REPLACE FUNCTION public.event_cancellation_requests_no_remutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'event_cancellation_requests: row % already resolved, immutable', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_cancellation_requests_no_remutate
  BEFORE UPDATE ON public.event_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION public.event_cancellation_requests_no_remutate();

ALTER TABLE public.event_cancellation_requests ENABLE ROW LEVEL SECURITY;

-- Owner can open a request only for their OWN, non-draft event — draft events
-- use the direct-delete path from Task 1, they never need a request.
CREATE POLICY "ecr_owner_insert" ON public.event_cancellation_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND e.owner_id = (select auth.uid()) AND e.status IN ('active', 'closed')
    )
  );

-- Owner can see their own requests' status/resolution (so the UI can show
-- "בקשה #123 — ממתינה" / the staff's resolution) but never edit them.
CREATE POLICY "ecr_owner_select" ON public.event_cancellation_requests
  FOR SELECT TO authenticated
  USING (owner_id = (select auth.uid()));

-- No UPDATE/DELETE policy for authenticated at all — resolution happens only
-- via service-role from the admin data layer (mirrors callback_requests: see
-- docs/production-readiness/2026-08-21-go-no-go.md §2 finding #6, "RLS blocks
-- direct writes, admin reads/writes go through service-role" — accepted-safe
-- pattern already in production).

REVOKE EXECUTE ON FUNCTION public.event_cancellation_requests_no_remutate() FROM public, anon, authenticated;
```

- [ ] **Step 2: Apply, then verify live**

```sql
select policyname, cmd, roles from pg_policies where tablename='event_cancellation_requests';
```
Expected: exactly `ecr_owner_insert` (INSERT) and `ecr_owner_select` (SELECT), both `{authenticated}`.

```sql
select relrowsecurity from pg_class where relname='event_cancellation_requests';
```
Expected: `true`.

- [ ] **Step 3: Regenerate types.ts**

Run: `supabase gen types --linked`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_event_cancellation_requests.sql src/lib/supabase/types.ts
git commit -m "feat(events): add event_cancellation_requests table + RLS"
```

---

## Task 3: Cancellation-fee policy config (data, not hardcoded logic)

> **✅ Fee cap RESOLVED, ⚠️ suggested-amount computation still gated — see `legal-cancellation-research`'s findings (returned 2026-08-21, verified against nevo.co.il primary text, not a summary):**
> - **5% / ₪100, whichever is lower — VERIFIED, word-for-word match** with §5 of the current agreement (14ה(ב)(1)). Seed these two values as-is in Step 1, no change needed.
> - **⚠️ NOT resolved, affects `computeSuggestedCancellationAmount` (Task 8):** the right to charge for "service already rendered" (14ה(ב1), "תמורה יחסית") exists **only for a transaction classified as "עסקה מתמשכת" (continuous)** — zero legal basis for a non-continuous transaction. Whether a KALFA campaign IS continuous is a genuine open question (the research leans "continuous" on the statutory test — delivery MODE over weeks, not payment structure — but this is not a final answer; it also drags in three disclosure obligations the current signup flow likely does not satisfy: oral pre-signup disclosure, prominent written disclosure, 3-business-day termination). **Decision for this plan: `computeSuggestedCancellationAmount` (Task 8) suggests ONLY the capped cancellation fee (5%/₪100) by default — NOT the accrued-service component — until counsel confirms the classification.** Staff can still type a higher amount manually in the resolve form if the business chooses to accept that risk case-by-case, but the software will not pre-suggest a number resting on an unresolved legal basis.
> - **Separate, more consequential finding — OUT OF SCOPE for this plan, flag to the owner separately:** 14ה(ד) defines "cancellation fee" broadly enough to swallow ANY claimed transaction-related expense — meaning the existing ₪200 base/activation fee (already LIVE billing model, `pricing-base-overage-model-workstream`) may not be chargeable as a separate line item on top of the 5%/₪100 cap if it's ever framed as a cancellation-context expense. This is a pre-existing billing-model question, not something this cancellation-request feature creates or needs to fix — do not silently patch it here.

**Files:**
- Create: `supabase/migrations/<ts>_cancellation_fee_policy_settings.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `app_settings.cancellation_fee_percent` (numeric), `app_settings.cancellation_fee_cap` (numeric), `app_settings.cancellation_refund_days` (smallint) — consumed by Task 8's suggested-amount computation.

- [ ] **Step 1: Write the migration**

```sql
-- Cancellation-fee policy, as configurable DATA (never hardcoded logic) —
-- per the agreement §5 text as of 2026-08-21: "עד 5% מערך העסקה או ₪100,
-- לפי הנמוך; החזר תוך 14 יום באמצעי התשלום המקורי". Pending final counsel
-- sign-off (docs/production-readiness/2026-08-21-go-no-go.md §1.3) — a
-- number change from counsel is a data UPDATE here, not a code change.
ALTER TABLE public.app_settings
  ADD COLUMN cancellation_fee_percent numeric NOT NULL DEFAULT 5,
  ADD COLUMN cancellation_fee_cap numeric NOT NULL DEFAULT 100,
  ADD COLUMN cancellation_refund_days smallint NOT NULL DEFAULT 14;
```

(Verify `app_settings` is a single-row config table, matching every other flag read via `src/lib/data/payments.ts`-style getters, before writing this — confirm via `mcp__supabase__execute_sql`: `select count(*) from app_settings;` should be 1. If it is not a single-row table, adjust to whatever the established `app_settings` shape actually is rather than assuming.)

- [ ] **Step 2: Apply, then verify live**

```sql
select cancellation_fee_percent, cancellation_fee_cap, cancellation_refund_days from app_settings;
```
Expected: `5, 100, 14` (or whatever `legal-cancellation-research` confirmed instead).

- [ ] **Step 3: Regenerate types.ts** — `supabase gen types --linked`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_cancellation_fee_policy_settings.sql src/lib/supabase/types.ts
git commit -m "feat(billing): add configurable cancellation-fee policy settings"
```

---

## Task 4: Extend `closeCampaignAndCharge` with an admin override amount

**Files:**
- Modify: `src/lib/data/close-charge.ts`
- Modify: `src/lib/data/close-charge.test.ts` (add new cases; do not break the existing ones already updated tonight for `reachedCount`/`creditApplied`)

**Interfaces:**
- Consumes: existing `captureHeldCardSumit`, `getCampaignForCharge`, `lockCampaignForCharge`, `recordCampaignCharge`, `markCampaignChargeOutcome` — all already imported in `close-charge.ts`.
- Produces: `closeCampaignAndCharge(campaignId, opts?: { overrideAmount?: number; overrideReason?: string })` — the SAME function, with one new optional parameter, PLUS two new optional fields on the existing `CloseChargeOutcome` type: `documentId?: number | null; documentUrl?: string | null` (populated on the `'charged'` outcome from the same `result.documentId`/`result.documentUrl` that `captureHeldCardSumit` already returns and `recordCampaignCharge` already persists — today that data just never leaves the function; this is the SAME pattern as adding `reachedCount`/`creditApplied` earlier tonight, data the function already has but didn't return). Consumed by Task 8's `resolveCancellationRequest`, which needs the receipt link for the customer email. The NORMAL settle flow (`settleCampaignAction` in `campaign-actions.ts`, the `/api/campaigns/[id]/close-charge` route) calls it with NO second argument and ignores the two new fields — behavior for every existing caller is byte-identical.

- [ ] **Step 1: Write the failing tests** (add to the existing `close-charge.test.ts`, after the `happy()` helper — reuse it, do not duplicate the mock setup)

```typescript
describe('closeCampaignAndCharge with an override amount (cancellation-resolve path)', () => {
  it('captures the override amount instead of the computed reached×price total', async () => {
    happy(); // reachedCount:3, price 4 ⇒ computed total would be 12
    const r = await closeCampaignAndCharge('c1', { overrideAmount: 30, overrideReason: 'cancellation_partial_charge' });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '30' }));
    expect(r).toEqual({
      outcome: 'charged', amount: 30, paymentId: 777, billingModel: 'per_reached',
      documentId: 555, documentUrl: 'https://pay.sumit.co.il/x?download=555',
    });
  });

  it('never captures MORE than the campaign ceiling, even if overrideAmount asks for more', async () => {
    happy(); // max_charge_ceiling: 88
    const r = await closeCampaignAndCharge('c1', { overrideAmount: 500, overrideReason: 'cancellation_partial_charge' });
    expect(captureHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '88' }));
    expect(r.amount).toBe(88);
  });

  it('overrideAmount of 0 settles nothing_to_charge without calling SUMIT, same as a normal zero-reach settle', async () => {
    happy();
    const r = await closeCampaignAndCharge('c1', { overrideAmount: 0, overrideReason: 'cancellation_full' });
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
    expect(r.outcome).toBe('nothing_to_charge');
  });

  it('still blocks on a terminal charge_status (already charged) even with an override', async () => {
    happy();
    m.forCharge.mockResolvedValue({
      id: 'c1', event_id: 'e1', status: 'closed', capture_status: 'authorized', charge_status: 'charged',
      card_token_ref: 'tok-abc', card_exp_month: 7, card_exp_year: 2031, card_citizen_id: '316125434',
      auth_external_ref: 'ext-1', max_charge_ceiling: 88,
    });
    const r = await closeCampaignAndCharge('c1', { overrideAmount: 30, overrideReason: 'x' });
    expect(r).toEqual({ outcome: 'bad_state', amount: 0 });
    expect(captureHeldCardSumit).not.toHaveBeenCalled();
  });

  it('omitting the second argument reproduces the exact existing computed-amount behavior (regression guard)', async () => {
    happy();
    const r = await closeCampaignAndCharge('c1');
    expect(r).toEqual({
      outcome: 'charged', amount: 12, paymentId: 777, billingModel: 'per_reached',
      documentId: 555, documentUrl: 'https://pay.sumit.co.il/x?download=555',
    });
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail** — `npx vitest run src/lib/data/close-charge.test.ts`.

- [ ] **Step 3: Implement the override** — modify the signature and the amount-computation block (around the current `computeChargeAmount` call, `close-charge.ts:170-183`):

```typescript
export async function closeCampaignAndCharge(
  campaignId: string,
  opts?: { overrideAmount?: number; overrideReason?: string },
): Promise<CloseChargeOutcome> {
  // ... unchanged through the ceiling/D5-guard computation (lines ~59-166) ...

  // Normal path: reached × price (± base/overage), capped, minus credits.
  const computed = computeChargeAmount({
    base: effectiveBase, included: effectiveIncluded, overage: campaign.price_per_reached ?? 0,
    reached: summary?.reachedCount ?? 0, ceiling, credits,
  });

  // Override path (cancellation-resolve only, Task 8): an admin-confirmed
  // amount REPLACES the computed reached×price total, but the ceiling cap and
  // every safety property below (idempotency lock, terminal-state guard,
  // receipt generation, Slack alert, D5 guard already applied above) still
  // apply identically — overrideAmount only swaps WHAT gets charged, never
  // HOW it gets charged. Never allow overrideAmount to exceed the signed
  // ceiling, regardless of what the caller asks for.
  const amount = opts?.overrideAmount !== undefined
    ? Math.min(Math.max(0, opts.overrideAmount), ceiling)
    : computed.amount;
  const creditApplied = opts?.overrideAmount !== undefined ? 0 : computed.creditApplied;

  // 0 reached OR credits ≥ the capped total OR overrideAmount===0 → settle at
  // ₪0, no SUMIT call.
  if (amount <= 0) {
    await markCampaignChargeOutcome(campaignId, 'nothing_to_charge', creditApplied);
    return {
      outcome: 'nothing_to_charge',
      amount: 0,
      reachedCount: summary?.reachedCount ?? 0,
      creditApplied,
    };
  }

  // ... unchanged: lockCampaignForCharge, captureHeldCardSumit(amount.toString()), recordCampaignCharge, Slack alert, tax-ceiling check ...

  return {
    outcome: 'charged',
    amount,
    paymentId: result.paymentId ?? null,
    billingModel:
      effectiveBase > 0 || effectiveIncluded > 0 ? 'base_overage' : 'per_reached',
    // NEW — the receipt data captureHeldCardSumit/recordCampaignCharge already
    // have, now also returned so a caller (Task 8's resolveCancellationRequest)
    // can put the receipt link in the customer email without a second DB read.
    documentId: result.documentId ?? null,
    documentUrl: result.documentUrl ?? null,
  };
}
```

Also add the two fields to the `CloseChargeOutcome` type declaration near the top of the file (next to the existing `reachedCount?`/`creditApplied?` fields added earlier tonight):

```typescript
  documentId?: number | null;
  documentUrl?: string | null;
```

Read the full current file (`close-charge.ts`, already read once this session) before editing — the snippets above show only the changed lines; every line between them (owner lookup, the `captureHeldCardSumit` call itself, `recordCampaignCharge`, the Slack alert, `checkOsekPaturCeilingAfterCharge`) stays EXACTLY as it is today, just now receiving `amount` from either branch instead of always from `computeChargeAmount`, and the final `return` gains the two new fields.

- [ ] **Step 4: Run to verify all cases pass** — `npx vitest run src/lib/data/close-charge.test.ts` (every case from tonight's earlier fix PLUS the 5 new ones).

- [ ] **Step 5: Run tsc + the full existing close-charge/campaign-actions test suites** to confirm zero regressions on the normal (no-override) path.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/close-charge.ts src/lib/data/close-charge.test.ts
git commit -m "feat(billing): closeCampaignAndCharge accepts an admin override amount for cancellation resolutions"
```

---

## Task 4B: `creditHeldCardSumit` — refund via the SAME endpoint, discovered in `swagger.json`

> **This removes the "no refund capability" limitation from the rest of this plan.** Verified directly from the repo-root `swagger.json` (SUMIT's own OpenAPI spec, not a summary): `/billing/payments/charge/` — the exact endpoint `captureHeldCardSumit` already calls — takes a `SupportCredit: boolean` parameter, documented as *"Allow credit instead of charge (debit), in case the total is less than 0? Defaults to false"* (`components.schemas...PaymentsController_Payments_Charge_Request.SupportCredit`, `swagger.json:13435`). `ChargeItem.UnitPrice`/`Total` are typed as plain nullable `number` — nothing in the schema restricts them to positive, so a negative item total plus `SupportCredit: true` is the credit/refund mechanism. This is the SAME endpoint, SAME auth/customer/payment-method shape `captureHeldCardSumit` already uses successfully — not a new integration, a new parameter on a proven one.

**Files:**
- Modify: `src/lib/sumit/capture.ts` (add `creditHeldCardSumit`, sibling to `captureHeldCardSumit`)
- Modify: `src/lib/sumit/capture.test.ts`

**Interfaces:**
- Consumes: nothing new — same `fetch`, same `SumitDeclinedError`/`SumitNetworkError` from `@/lib/sumit/charge`, same Slack alert pattern already in `capture.ts`.
- Produces: `creditHeldCardSumit(p: SumitCreditParams): Promise<SumitCaptureResult>` — same result shape as `captureHeldCardSumit` (a credit note document, "תעודת זיכוי", is the correct Israeli-accounting document type for a refund — SUMIT issues it automatically from a negative-total charge with `SupportCredit:true`, same as it issues a receipt from a positive one). Consumed by Task 8's `resolveCancellationRequest` for the post-charge (`charge_status='charged'`) branch, replacing the `manual_refund_required` default with an actual attempt.

- [ ] **Step 1: Write the failing test** (mirror `capture.test.ts`'s existing structure exactly — same fetch-mock pattern)

```typescript
// Added to capture.test.ts, alongside the existing captureHeldCardSumit tests:
describe('creditHeldCardSumit', () => {
  it('POSTs to the same charge endpoint with SupportCredit:true and a negative item total', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Status: 0,
        Data: { DocumentID: 601, DocumentNumber: 50201, DocumentDownloadURL: 'https://pay.sumit.co.il/x?download=601',
          Payment: { ID: 888, ValidPayment: true, AuthNumber: '0700001' } },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await creditHeldCardSumit({
      companyId: 1, apiKey: 'k', cardToken: 'tok-abc', expMonth: 7, expYear: 2031, citizenId: '316125434',
      externalRef: 'ext-1', amount: '24.4', customerEmail: 'owner@example.com', customerName: 'בעל האירוע',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.SupportCredit).toBe(true);
    expect(body.Items[0].UnitPrice).toBe(-24.4);
    expect(result.documentId).toBe(601);
  });

  it('throws SumitDeclinedError when ValidPayment is false, same as captureHeldCardSumit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ Status: 0, Data: { Payment: { ValidPayment: false } } }),
    }));
    await expect(creditHeldCardSumit({
      companyId: 1, apiKey: 'k', cardToken: 'tok-abc', expMonth: 7, expYear: 2031, citizenId: '316125434',
      externalRef: 'ext-1', amount: '24.4', customerEmail: 'x@example.com',
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — copy `captureHeldCardSumit` almost verbatim (same request/response types, same decline/network/ambiguous-response handling — that logic is already proven and must not diverge), changing only: the `SupportCredit: true` field, `UnitPrice: -parseFloat(p.amount)` (negative), the item name (`'KALFA — זיכוי ביטול אירוע'` instead of `'KALFA — חיוב קמפיין'`), and the exported function/type names.

```typescript
export interface SumitCreditParams extends SumitCaptureParams {} // identical shape — amount is still a positive string, negation happens internally

// Refund/credit via the SAME /billing/payments/charge/ endpoint captureHeldCardSumit
// uses, with SupportCredit:true + a negative item total (verified against the
// repo-root swagger.json — see Task 4B's header note). UNTESTED against the live
// SUMIT API as of this plan (captureHeldCardSumit's own comments document several
// hard-won empirical gotchas for the CHARGE direction — VATRate, CreditCardAuthNumber,
// AutoCapture — that may or may not also apply to a CREDIT; do not assume they
// transfer without the Task 11 sandbox dry run confirming behavior in this direction too).
export async function creditHeldCardSumit(p: SumitCreditParams): Promise<SumitCaptureResult> {
  const body = {
    Credentials: { CompanyID: p.companyId, APIKey: p.apiKey },
    Customer: {
      Name: p.customerName || undefined,
      EmailAddress: p.customerEmail || undefined,
      ExternalIdentifier: p.externalRef,
    },
    PaymentMethod: {
      CreditCard_Token: p.cardToken,
      CreditCard_ExpirationMonth: p.expMonth,
      CreditCard_ExpirationYear: p.expYear,
      CreditCard_CitizenID: p.citizenId,
      Type: 1,
    },
    VATIncluded: true,
    SupportCredit: true,
    Items: [
      {
        Quantity: 1,
        UnitPrice: -parseFloat(p.amount),
        Item: { Name: 'KALFA — זיכוי ביטול אירוע' },
        Description: 'KALFA — זיכוי ביטול אירוע',
      },
    ],
    AutoCapture: true,
    PreventDocumentCreation: false,
    SendDocumentByEmail: !!p.customerEmail,
    DraftDocument: false,
  };

  // ... IDENTICAL fetch/error-handling/response-parsing to captureHeldCardSumit
  // (network catch → SumitNetworkError, !res.ok → SumitNetworkError, JSON parse
  // failure → SumitNetworkError, topBusinessError/ValidPayment===false →
  // SumitDeclinedError, missing documentId/unconfirmed → SumitNetworkError) —
  // copy that block verbatim, do not reimplement it differently.
}
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/sumit/capture.ts src/lib/sumit/capture.test.ts
git commit -m "feat(billing): add creditHeldCardSumit (refund via the same SUMIT charge endpoint, SupportCredit:true)"
```

---

## Task 5: Zod validation schemas

**Files:**
- Create: `src/lib/validation/event-cancellation.ts`
- Test: `src/lib/validation/event-cancellation.test.ts`

**Interfaces:**
- Consumes: nothing (pure Zod).
- Produces: `createCancellationRequestSchema`, `resolveCancellationRequestSchema` — consumed by Task 4's data module and Task 6/8's Server Actions.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { createCancellationRequestSchema, resolveCancellationRequestSchema } from './event-cancellation';

describe('createCancellationRequestSchema', () => {
  it('accepts a valid reason with smsConsent', () => {
    const r = createCancellationRequestSchema.safeParse({ reason: 'שינוי תוכניות', smsConsent: true });
    expect(r.success).toBe(true);
  });
  it('rejects a too-short reason', () => {
    const r = createCancellationRequestSchema.safeParse({ reason: 'קצר', smsConsent: false });
    expect(r.success).toBe(false);
  });
  it('defaults smsConsent to false when omitted', () => {
    const r = createCancellationRequestSchema.parse({ reason: 'שינוי תוכניות משפחתיות' });
    expect(r.smsConsent).toBe(false);
  });
});

describe('resolveCancellationRequestSchema', () => {
  it('accepts declined with just a note', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'declined',
      resolutionNote: 'האירוע כבר בעיצומו, לא ניתן לבטל',
    });
    expect(r.success).toBe(true);
  });
  it('requires resolutionAmount for partial_charge', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'partial_charge',
      resolutionNote: 'חויב חלקית',
    });
    expect(r.success).toBe(false);
  });
  it('accepts partial_charge with a positive amount', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'partial_charge',
      resolutionAmount: 50,
      resolutionNote: 'חויב חלקית עבור הודעות שכבר נשלחו',
    });
    expect(r.success).toBe(true);
  });
  it('rejects a zero or negative resolutionAmount', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'partial_charge',
      resolutionAmount: 0,
      resolutionNote: 'חויב חלקית',
    });
    expect(r.success).toBe(false);
  });
  it('rejects resolutionAmount present on full_cancellation', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'full_cancellation',
      resolutionAmount: 50,
      resolutionNote: 'בוטל במלואו',
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/validation/event-cancellation.test.ts`
Expected: FAIL — `event-cancellation.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
import { z } from 'zod';

export const createCancellationRequestSchema = z.object({
  reason: z.string().trim().min(5, 'נא לפרט את סיבת הביטול').max(2000),
  smsConsent: z.boolean().default(false),
});

export const RESOLUTION_VALUES = ['full_cancellation', 'partial_charge', 'declined'] as const;

export const resolveCancellationRequestSchema = z
  .object({
    resolution: z.enum(RESOLUTION_VALUES),
    resolutionAmount: z.coerce.number().positive().optional(),
    resolutionNote: z.string().trim().min(5, 'נא לנסח הודעה ללקוח').max(4000),
  })
  .refine((v) => (v.resolution === 'partial_charge' ? v.resolutionAmount !== undefined : true), {
    message: 'יש להזין סכום עבור חיוב חלקי',
    path: ['resolutionAmount'],
  })
  .refine((v) => (v.resolution !== 'partial_charge' ? v.resolutionAmount === undefined : true), {
    message: 'סכום רלוונטי רק לחיוב חלקי',
    path: ['resolutionAmount'],
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/validation/event-cancellation.test.ts`
Expected: PASS, all 9 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/event-cancellation.ts src/lib/validation/event-cancellation.test.ts
git commit -m "feat(events): add cancellation-request Zod schemas"
```

---

## Task 6: SMS text builder (mirrors `no-contact-sms.ts`)

**Files:**
- Create: `src/lib/data/cancellation-sms.ts`
- Test: `src/lib/data/cancellation-sms.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `buildCancellationSmsText(input: { fullName: string; requestNumber: number; resolution: 'full_cancellation'|'partial_charge'|'declined'; resolutionAmount?: number }): string` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { buildCancellationSmsText } from './cancellation-sms';

describe('buildCancellationSmsText', () => {
  it('full_cancellation text mentions the request number and full cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestNumber: 42, resolution: 'full_cancellation' });
    expect(t).toContain('42');
    expect(t).toContain('בוטלה במלואה');
  });
  it('partial_charge text includes the amount', () => {
    const t = buildCancellationSmsText({
      fullName: 'דנה', requestNumber: 42, resolution: 'partial_charge', resolutionAmount: 50,
    });
    expect(t).toContain('50');
  });
  it('declined text does not claim cancellation', () => {
    const t = buildCancellationSmsText({ fullName: 'דנה', requestNumber: 42, resolution: 'declined' });
    expect(t).not.toContain('בוטלה');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/data/cancellation-sms.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```typescript
// SMS sent only when the requester checked the SMS-consent box at request
// time (event_cancellation_requests.sms_consent) — see the resolve flow in
// event-cancellation.ts. A service reply to a request the customer themselves
// initiated (never marketing), same rationale as
// src/lib/callbacks/no-contact-sms.ts — the consent gate here is extra
// carefulness on top of that, per an explicit owner decision (2026-08-21).

export function buildCancellationSmsText(input: {
  fullName: string;
  requestNumber: number;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined';
  resolutionAmount?: number;
}): string {
  const name = input.fullName.trim();
  const ref = `בקשת ביטול #${input.requestNumber}`;
  if (input.resolution === 'full_cancellation') {
    return `שלום ${name}, ${ref} בוטלה במלואה, ללא חיוב. פרטים נשלחו במייל. צוות KALFA`;
  }
  if (input.resolution === 'partial_charge') {
    return `שלום ${name}, ${ref} אושרה עם חיוב חלקי של ₪${input.resolutionAmount}. פרטים נשלחו במייל. צוות KALFA`;
  }
  return `שלום ${name}, ${ref} נדחתה. פרטים נשלחו במייל. צוות KALFA`;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/data/cancellation-sms.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/cancellation-sms.ts src/lib/data/cancellation-sms.test.ts
git commit -m "feat(events): add cancellation-request SMS text builder"
```

---

## Task 7: Email template (mirrors `inquiryReplyEmail`)

**Files:**
- Modify: `src/lib/email/templates.ts` (append after `inquiryReplyEmail`, ~line 174)
- Test: `src/lib/email/templates.test.ts` (extend if it exists; else create)

**Interfaces:**
- Consumes: nothing beyond existing `esc`/`inlineMarkdownToHtml`/`inlineMarkdownToText` helpers already in `templates.ts`.
- Produces: `cancellationRequestResponseEmail(input: { recipientName: string; requestNumber: number; resolution: 'full_cancellation'|'partial_charge'|'declined'; resolutionAmount?: number; resolutionNote: string; origin: string }): { subject: string; html: string; text: string }` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { cancellationRequestResponseEmail } from './templates';

describe('cancellationRequestResponseEmail', () => {
  it('full_cancellation subject and body confirm no charge', () => {
    const { subject, text } = cancellationRequestResponseEmail({
      recipientName: 'דנה', requestNumber: 42, resolution: 'full_cancellation',
      resolutionNote: 'מבטלים כי לא נשלחו הודעות', origin: 'https://beta.kalfa.me',
    });
    expect(subject).toContain('42');
    expect(text).toContain('בוטלה במלואה');
  });
  it('partial_charge body includes the amount', () => {
    const { text } = cancellationRequestResponseEmail({
      recipientName: 'דנה', requestNumber: 42, resolution: 'partial_charge', resolutionAmount: 50,
      resolutionNote: 'עבור 12 הודעות שכבר נשלחו', origin: 'https://beta.kalfa.me',
    });
    expect(text).toContain('50');
  });
  it('declined body includes the staff note', () => {
    const { text } = cancellationRequestResponseEmail({
      recipientName: 'דנה', requestNumber: 42, resolution: 'declined',
      resolutionNote: 'האירוע כבר בעיצומו', origin: 'https://beta.kalfa.me',
    });
    expect(text).toContain('האירוע כבר בעיצומו');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Write the implementation** (append to `templates.ts`)

```typescript
const CANCELLATION_RESOLUTION_COPY: Record<
  'full_cancellation' | 'partial_charge' | 'declined',
  (amount?: number) => { subjectSuffix: string; opening: string }
> = {
  full_cancellation: () => ({
    subjectSuffix: 'בקשתך אושרה',
    opening: 'בקשתך לביטול האירוע אושרה — הביטול בוצע במלואו, ללא חיוב.',
  }),
  partial_charge: (amount) => ({
    subjectSuffix: 'בקשתך אושרה עם חיוב חלקי',
    opening: `בקשתך לביטול האירוע אושרה, עם חיוב חלקי של ₪${amount} עבור שירות שכבר סופק.`,
  }),
  declined: () => ({
    subjectSuffix: 'עדכון לגבי בקשתך',
    opening: 'בדקנו את בקשתך לביטול האירוע — לא ניתן לאשר את הביטול בשלב זה.',
  }),
};

export function cancellationRequestResponseEmail(input: {
  recipientName: string;
  requestNumber: number;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined';
  resolutionAmount?: number;
  resolutionNote: string;
  origin: string;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  const copy = CANCELLATION_RESOLUTION_COPY[input.resolution](input.resolutionAmount);
  const subject = `בקשת ביטול #${input.requestNumber} — ${copy.subjectSuffix}`;
  const note = stripDuplicateFraming(input.resolutionNote);
  const text = `שלום ${name},

בקשת ביטול #${input.requestNumber}: ${copy.opening}

${inlineMarkdownToText(note, input.origin)}

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">בקשת ביטול #${input.requestNumber}</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <p style="margin:8px 0">${esc(copy.opening)}</p>
    <div style="margin:12px 0;white-space:pre-line">${inlineMarkdownToHtml(esc(note), esc(input.origin))}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0 14px">
    <p style="margin:0 0 6px;color:#888;font-size:12px">בברכה,</p>
    <img src="${esc(input.origin)}/brand/kalfa-signature.png" width="200" height="63"
         alt="נתנאל ק׳ — KALFA"
         style="display:block;width:200px;height:63px;border:0;outline:none;max-width:100%">
  </div>
</body>
</html>`;
  return { subject, html, text };
}
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/templates.ts src/lib/email/templates.test.ts
git commit -m "feat(events): add cancellation-request response email template"
```

---

## Task 8: Data layer — `src/lib/data/event-cancellation.ts`

**Files:**
- Create: `src/lib/data/event-cancellation.ts`
- Test: `src/lib/data/event-cancellation.test.ts`

**Interfaces:**
- Consumes: `createCancellationRequestSchema`/`resolveCancellationRequestSchema` (Task 5), `buildCancellationSmsText` (Task 6), `cancellationRequestResponseEmail` (Task 7), `closeCampaignAndCharge` with the new override param (Task 4), `creditHeldCardSumit` (Task 4B), `requireOwnedEvent` + `closeEvent`-sibling added here as `adminCloseEvent`, `requirePlatformPermission` (`src/lib/auth/dal.ts`), `getCampaignBillingSummary`/`getCampaignCreditTotal` (`src/lib/data/billing.ts`), `getEmailSender` (`src/lib/email/sender.ts`), `getSmsSender` (`src/lib/sms/sender.ts`), `getAppOrigin` (`src/lib/url.ts`), `logActivity` (`src/lib/data/activity.ts`), `createClient`/`createAdminClient` (`src/lib/supabase/{server,admin}.ts`), `createAdminClient` again for the campaign's `card_token_ref`/`card_exp_month`/`card_exp_year`/`card_citizen_id`/`auth_external_ref` (same columns `getCampaignForCharge` already reads in `close-charge.ts` — needed here too, for the credit call).
- Produces: `createCancellationRequest`, `listCancellationRequestsForAdmin`, `getCancellationRequestForAdmin`, `computeSuggestedCancellationAmount`, `resolveCancellationRequest`, `adminCloseEvent` — consumed by Task 9 (customer action) and Task 10 (admin actions/detail page).

**Design — how a resolution actually moves money:**

1. Look up the event's single campaign (`campaign-rework-constraint`: one-campaign-per-event) and its `charge_status` + the card fields needed for a credit (`card_token_ref`, `card_exp_month`, `card_exp_year`, `card_citizen_id`, `auth_external_ref`).
2. **`charge_status` is `null`/`charge_failed`/`charge_review`/`nothing_to_charge`** (nothing has been captured yet, the hold is still just a hold) — this is the common case, since a campaign only reaches `charged` at its own close-charge time (normally event-day+). Resolution EXECUTES via `closeCampaignAndCharge(campaignId, { overrideAmount, overrideReason })`:
   - `full_cancellation` → `overrideAmount: 0` → the existing `nothing_to_charge` branch fires, no SUMIT call, hold is simply never captured (it expires on the card network side on its own — the same non-outcome a normal ₪0 campaign settle already produces today).
   - `partial_charge` → `overrideAmount` = the staff-confirmed amount (pre-filled by `computeSuggestedCancellationAmount`) → real SUMIT capture, real receipt.
   - `capture_outcome` recorded as `'captured'` (or `'not_applicable'` for `declined`, which never calls `closeCampaignAndCharge` at all).
3. **`charge_status` is already `'charged'`** (e.g. the cancellation request arrives after the event) AND the campaign still has its card fields on file — resolution EXECUTES via `creditHeldCardSumit` (Task 4B) for `full_cancellation` (credit the full previously-charged amount) or `partial_charge` (credit the difference between what was charged and what should have been kept, i.e. `charged_amount − resolutionAmount`). `capture_outcome` recorded as `'refunded'` on success. If the credit call itself throws (`SumitDeclinedError`/`SumitNetworkError`) OR the campaign is missing the card fields needed to attempt it at all (very old data), the error propagates / `capture_outcome` falls back to `'manual_refund_required'` respectively — staff handles that ONE case manually, it is not the default path anymore. The email always states the actual outcome (refunded automatically vs. pending manual processing within `cancellation_refund_days`), never a generic promise.

- [ ] **Step 0: Write the failing test for `computeSuggestedCancellationAmount`**

> Per `legal-cancellation-research`'s verified finding (Task 3's callout): the right to charge for service-already-rendered exists ONLY for a transaction classified as "continuous" (14ה(ב1)), which is a genuinely open question, NOT yet confirmed. This function therefore suggests ONLY the capped cancellation fee (5%/₪100 of the ceiling) — it deliberately does NOT add `campaign_billing_summary.accrued` (the service-already-rendered value) to the suggestion, even though that number is available. Staff can still type a higher amount by hand in the resolve form; the software just won't pre-suggest one resting on an unconfirmed legal basis.

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { computeSuggestedCancellationAmount } from './event-cancellation';

type Mock = ReturnType<typeof vi.fn>;

describe('computeSuggestedCancellationAmount', () => {
  it('suggests min(5% of ceiling, cap), never the accrued service-already-rendered amount', async () => {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { cancellation_fee_percent: 5, cancellation_fee_cap: 100 }, error: null }) }),
          single: async () => ({ data: { max_charge_ceiling: 88 }, error: null }),
        }),
      }),
    });
    // fee = min(5% of 88, 100) = min(4.4, 100) = 4.4
    const amount = await computeSuggestedCancellationAmount('c1');
    expect(amount).toBeCloseTo(4.4, 2);
  });

  it('never suggests more than the campaign ceiling even with a very high fee_cap', async () => {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { cancellation_fee_percent: 5, cancellation_fee_cap: 100000 }, error: null }) }),
          single: async () => ({ data: { max_charge_ceiling: 12 }, error: null }),
        }),
      }),
    });
    // fee = min(5% of 12, 100000) = 0.6, still ≤ ceiling — but assert the cap invariant explicitly:
    const amount = await computeSuggestedCancellationAmount('c1');
    expect(amount).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 0b: Run to verify it fails, then implement**

```typescript
// Suggested amount ONLY — the admin UI (Task 10) shows this pre-filled but
// editable; the actual charged amount is whatever the admin confirms in
// resolveCancellationRequest's input, never this value directly. Deliberately
// EXCLUDES service-already-rendered (campaign_billing_summary.accrued) — see
// Task 3's legal callout: that charge basis (14ה(ב1)) applies only to a
// "continuous transaction", not yet confirmed for KALFA campaigns.
export async function computeSuggestedCancellationAmount(campaignId: string): Promise<number> {
  const admin = createAdminClient();
  const [settingsRes, campaignRes] = await Promise.all([
    admin.from('app_settings').select('cancellation_fee_percent, cancellation_fee_cap').maybeSingle(),
    admin.from('campaigns').select('max_charge_ceiling').eq('id', campaignId).single(),
  ]);
  const feePercent = settingsRes.data?.cancellation_fee_percent ?? 0;
  const feeCap = settingsRes.data?.cancellation_fee_cap ?? 0;
  const ceiling = campaignRes.data?.max_charge_ceiling ?? 0;
  const fee = Math.min((ceiling * feePercent) / 100, feeCap);
  return Math.min(fee, ceiling);
}
```

- [ ] **Step 0c: Run to verify it passes, commit separately or fold into Step 5 below.**

- [ ] **Step 1: Write the failing tests** (mirrors `campaign-actions.test.ts`/`close-charge.test.ts` mocking conventions — mock every imported module, assert call order and error propagation)

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({
  requireOwnedEvent: vi.fn(),
  requirePlatformPermission: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/close-charge', () => ({ closeCampaignAndCharge: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ cancellationRequestResponseEmail: vi.fn() }));
vi.mock('@/lib/data/cancellation-sms', () => ({ buildCancellationSmsText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://beta.kalfa.me') }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { requireOwnedEvent, requirePlatformPermission } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { getEmailSender } from '@/lib/email/sender';
import { getSmsSender } from '@/lib/sms/sender';
import { cancellationRequestResponseEmail } from '@/lib/email/templates';
import { buildCancellationSmsText } from '@/lib/data/cancellation-sms';
import {
  createCancellationRequest,
  resolveCancellationRequest,
} from './event-cancellation';

type Mock = ReturnType<typeof vi.fn>;

describe('createCancellationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts via the owner-scoped client and returns the request number', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const insertMock = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'r1', request_number: 42 }, error: null }),
      }),
    });
    (createClient as unknown as Mock).mockResolvedValue({
      from: () => ({ insert: insertMock }),
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    });
    const r = await createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: true });
    expect(r).toEqual({ id: 'r1', requestNumber: 42 });
  });
});

describe('resolveCancellationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  // `chargeStatus` controls which branch fires: null/failed/review/nothing_to_charge
  // ⇒ campaign is still pre-charge ⇒ closeCampaignAndCharge IS called; 'charged'
  // ⇒ post-charge ⇒ it must NOT be called (no refund capability exists).
  function happy(opts: { chargeStatus: string | null; smsConsent?: boolean }) {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'r1', request_number: 42, status: 'pending', sms_consent: opts.smsConsent ?? true,
        event_id: 'e1', reason: 'שינוי תוכניות',
        events: { id: 'e1', status: 'active', owner_id: 'u1', campaigns: [{ id: 'camp1', charge_status: opts.chargeStatus }] },
        profiles: { full_name: 'דנה' },
      },
      error: null,
    });
    const update = vi.fn().mockReturnValue({ eq: () => ({ error: null }) });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single }) }), update }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'dana@example.com' } } }) } },
    });
    (cancellationRequestResponseEmail as unknown as Mock).mockReturnValue({ subject: 's', html: '<p>h</p>', text: 't' });
    (buildCancellationSmsText as unknown as Mock).mockReturnValue('sms text');
    const send = vi.fn().mockResolvedValue(undefined);
    (getEmailSender as unknown as Mock).mockResolvedValue({ send });
    const smsSend = vi.fn().mockResolvedValue({ id: 'sms1' });
    (getSmsSender as unknown as Mock).mockResolvedValue({ send: smsSend });
    (closeCampaignAndCharge as unknown as Mock).mockResolvedValue({
      outcome: 'charged', amount: 24.4, paymentId: 999,
    });
    return { send, smsSend, update };
  }

  it('pre-charge campaign: calls closeCampaignAndCharge with overrideAmount=0 for full_cancellation', async () => {
    happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 0, overrideReason: 'cancellation_full' });
  });

  it('pre-charge campaign: calls closeCampaignAndCharge with the confirmed amount for partial_charge', async () => {
    happy({ chargeStatus: 'charge_failed' });
    await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 24.4, resolutionNote: 'עבור שירות שסופק' });
    expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 24.4, overrideReason: 'cancellation_partial_charge' });
  });

  it('post-charge campaign (charge_status="charged"): does NOT call closeCampaignAndCharge, records manual_refund_required', async () => {
    const { update } = happy({ chargeStatus: 'charged' });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, יש להחזיר ידנית' });
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ capture_outcome: 'manual_refund_required' }),
    );
  });

  it('declined: never calls closeCampaignAndCharge regardless of charge_status, records not_applicable', async () => {
    const { update } = happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable' }));
  });

  it('sends email THEN SMS (consent=true) THEN persists, in that order', async () => {
    const { send, smsSend } = happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(send).toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalled();
  });

  it('does NOT send SMS when sms_consent is false', async () => {
    const { smsSend } = happy({ chargeStatus: null, smsConsent: false });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'לא ניתן' });
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('throws and persists NOTHING when the email send fails (checked BEFORE any SUMIT capture)', async () => {
    const { update } = happy({ chargeStatus: null });
    (getEmailSender as unknown as Mock).mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'x' }),
    ).rejects.toThrow();
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects resolving a request that is already resolved', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'r1', status: 'resolved', sms_consent: false, events: { id: 'e1', status: 'closed', owner_id: 'u1', campaigns: [] } },
      error: null,
    });
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    (createAdminClient as unknown as Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ single }) }) }) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'x' }),
    ).rejects.toThrow();
  });
});
```

(The seven behavioral assertions above — pre-charge full/partial routing into `closeCampaignAndCharge` with the right override, post-charge NEVER calling it, declined NEVER calling it, email-before-SMS-before-persist ordering, consent gating, email-failure-aborts-everything-including-any-capture, and terminal-state rejection — are the non-negotiable contract. Adjust mock shapes to the real Supabase query-builder chain as needed, same as `close-charge.test.ts` already does.)

- [ ] **Step 2: Run to verify it fails** — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
import 'server-only';

import { requireOwnedEvent, requirePlatformPermission } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { creditHeldCardSumit } from '@/lib/sumit/capture';
import { getSumitServerConfig } from '@/lib/data/payments'; // same config source close-charge.ts already reads
import { getEmailSender } from '@/lib/email/sender';
import { getSmsSender } from '@/lib/sms/sender';
import { cancellationRequestResponseEmail } from '@/lib/email/templates';
import { buildCancellationSmsText } from '@/lib/data/cancellation-sms';
import { getAppOrigin } from '@/lib/url';
import { logActivity } from '@/lib/data/activity';
import type {
  createCancellationRequestSchema,
  resolveCancellationRequestSchema,
} from '@/lib/validation/event-cancellation';
import type { z } from 'zod';

type CreateInput = z.infer<typeof createCancellationRequestSchema>;
type ResolveInput = z.infer<typeof resolveCancellationRequestSchema>;

// Owner-initiated: request to cancel an active/closed event. Uses the
// owner-scoped cookie client (RLS-enforced ecr_owner_insert), NOT the admin
// client — mirrors how callback_requests customer-facing inserts work.
export async function createCancellationRequest(
  eventId: string,
  input: CreateInput,
): Promise<{ id: string; requestNumber: number }> {
  const event = await requireOwnedEvent(eventId);
  if (event.status === 'draft') {
    throw new Error('אירוע בטיוטה ניתן למחיקה ישירה — אין צורך בבקשת ביטול');
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('נדרשת התחברות');

  const { data, error } = await supabase
    .from('event_cancellation_requests')
    .insert({
      event_id: eventId,
      owner_id: user.id,
      reason: input.reason,
      sms_consent: input.smsConsent,
    })
    .select('id, request_number')
    .single();

  if (error || !data) throw new Error('פתיחת בקשת הביטול נכשלה');

  await logActivity({
    eventId,
    action: 'event_cancellation.requested',
    meta: { requestId: data.id, requestNumber: data.request_number },
  });

  return { id: data.id, requestNumber: data.request_number };
}

export type CancellationRequestForAdmin = {
  id: string;
  requestNumber: number;
  eventId: string;
  eventName: string;
  eventStatus: string;
  reason: string;
  smsConsent: boolean;
  status: 'pending' | 'resolved';
  resolution: 'full_cancellation' | 'partial_charge' | 'declined' | null;
  resolutionAmount: number | null;
  resolutionNote: string | null;
  createdAt: string;
};

export async function listCancellationRequestsForAdmin(): Promise<CancellationRequestForAdmin[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('event_cancellation_requests')
    .select('id, request_number, event_id, reason, sms_consent, status, resolution, resolution_amount, resolution_note, created_at, events(name, status)')
    .order('status', { ascending: true }) // pending first (alphabetically before resolved)
    .order('created_at', { ascending: true });

  if (error) throw new Error('טעינת בקשות הביטול נכשלה');

  return (data ?? []).map((r) => ({
    id: r.id,
    requestNumber: r.request_number,
    eventId: r.event_id,
    eventName: (r.events as { name: string } | null)?.name ?? '',
    eventStatus: (r.events as { status: string } | null)?.status ?? '',
    reason: r.reason,
    smsConsent: r.sms_consent,
    status: r.status as 'pending' | 'resolved',
    resolution: r.resolution as CancellationRequestForAdmin['resolution'],
    resolutionAmount: r.resolution_amount,
    resolutionNote: r.resolution_note,
    createdAt: r.created_at,
  }));
}

// Admin-mediated close, twin of events.ts closeEvent but requirePlatformPermission
// instead of ownership — mirrors campaigns.ts cancelCampaign's admin-only
// wind-down pattern. Same R7 DB trigger applies (operational-campaign guard).
export async function adminCloseEvent(eventId: string): Promise<void> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { error } = await admin.from('events').update({ status: 'closed' }).eq('id', eventId);
  if (error) {
    throw new Error('סגירת האירוע נכשלה — ייתכן שיש קמפיין פעיל שיש לסגור קודם');
  }
  await logActivity({ eventId, action: 'event.closed_by_admin', meta: {} });
}

// Money is decided and MOVED here (when there's still something to move),
// then notified, then persisted. Three sub-cases per campaign.charge_status:
//   - pre-charge (null/charge_failed/charge_review/nothing_to_charge): calls
//     closeCampaignAndCharge with an override amount — a REAL SUMIT capture
//     for partial_charge, or the existing nothing_to_charge branch (no SUMIT
//     call at all) for full_cancellation/declined.
//   - post-charge ('charged'): calls creditHeldCardSumit (Task 4B) — a REAL
//     SUMIT credit for the amount being refunded. Falls back to
//     capture_outcome='manual_refund_required' ONLY if the campaign is
//     missing the card fields needed to even attempt it (very old data) —
//     a declined/network error from the credit call itself PROPAGATES
//     instead (see the try/catch below), it does not silently downgrade to
//     "manual" — staff sees the real failure and decides what to do.
// EMAIL IS CHECKED FIRST, before any SUMIT call — same send-then-persist
// contract as sendInquiryReply (contacts.ts:130), extended so a broken mail
// server can't leave a charge/credit executed with no notification sent. SMS
// is best-effort AFTER a successful email/capture/credit — see
// sendNoContactSms (callback-scheduling.ts:461) for the "never block the
// core outcome" contract.
export async function resolveCancellationRequest(
  requestId: string,
  input: ResolveInput,
): Promise<void> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();

  const { data: reqRow, error: fetchError } = await admin
    .from('event_cancellation_requests')
    .select(
      'id, request_number, event_id, sms_consent, status, ' +
      'events(id, status, owner_id, campaigns(id, charge_status, final_charge_amount, ' +
      'card_token_ref, card_exp_month, card_exp_year, card_citizen_id, auth_external_ref))',
    )
    .eq('id', requestId)
    .single();

  if (fetchError || !reqRow) throw new Error('בקשת הביטול לא נמצאה');
  if (reqRow.status !== 'pending') throw new Error('בקשה זו כבר טופלה');

  const event = reqRow.events as {
    id: string; status: string; owner_id: string;
    campaigns: {
      id: string; charge_status: string | null; final_charge_amount: number | null;
      card_token_ref: string | null; card_exp_month: number | null; card_exp_year: number | null;
      card_citizen_id: string | null; auth_external_ref: string | null;
    }[];
  } | null;
  if (!event) throw new Error('האירוע המקושר לבקשה לא נמצא');
  // One-campaign-per-event (campaign-rework-constraint) — at most one row.
  const campaign = event.campaigns[0] ?? null;
  const hasCardOnFile = !!(campaign?.card_token_ref && campaign.card_exp_month && campaign.card_exp_year && campaign.card_citizen_id);

  const { data: owner } = await admin.auth.admin.getUserById(event.owner_id);
  const { data: prof } = await admin.from('profiles').select('full_name, phone').eq('id', event.owner_id).maybeSingle();
  const ownerEmail = owner?.user?.email ?? '';
  const ownerName = (prof?.full_name ?? '').trim() || ownerEmail;
  const ownerPhone = prof?.phone ?? null;
  if (!ownerEmail) throw new Error('לא נמצאה כתובת אימייל לבעל האירוע — לא ניתן לשלוח עדכון');

  // Decide WHICH BRANCH before sending anything (not the final amount yet for
  // the credit branch — that depends on what was actually charged, read from
  // `campaign.final_charge_amount`, already available here).
  let captureOutcome: 'captured' | 'refunded' | 'manual_refund_required' | 'not_applicable';
  let finalAmount = 0;
  let sumitDocumentId: number | null = null;
  let sumitDocumentUrl: string | null = null;

  const isPreCharge = campaign && campaign.charge_status !== 'charged';
  const isPostCharge = campaign?.charge_status === 'charged';

  if (input.resolution === 'declined') {
    captureOutcome = 'not_applicable';
  } else if (isPostCharge) {
    if (!hasCardOnFile) {
      captureOutcome = 'manual_refund_required';
      const charged = campaign?.final_charge_amount ?? 0;
      finalAmount = input.resolution === 'full_cancellation' ? charged : Math.max(0, charged - (input.resolutionAmount ?? 0));
    } else {
      captureOutcome = 'refunded'; // executed below, after the email send succeeds
    }
  } else if (isPreCharge) {
    captureOutcome = 'captured'; // executed below, after the email send succeeds
  } else {
    captureOutcome = 'not_applicable'; // no campaign was ever authorized — nothing to move
  }

  const { subject, html, text } = cancellationRequestResponseEmail({
    recipientName: ownerName,
    requestNumber: reqRow.request_number,
    resolution: input.resolution,
    resolutionAmount: captureOutcome === 'manual_refund_required' ? finalAmount : input.resolutionAmount,
    resolutionNote: input.resolutionNote,
    origin: await getAppOrigin(),
  });

  try {
    const sender = await getEmailSender();
    await sender.send({ to: ownerEmail, subject, html, text });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'EmailConfigError') {
      throw new Error('שירות הדואר אינו מוגדר — הגדירו SMTP במסך ההגדרות ונסו שוב.');
    }
    if (name === 'EmailSendError') {
      throw new Error('שליחת הדואר נכשלה — הבקשה לא עודכנה, שום חיוב/זיכוי לא בוצע; אפשר לנסות שוב.');
    }
    throw err;
  }

  // NOW execute the actual money movement. Any SumitDeclinedError/
  // SumitNetworkError propagates — the customer already got an email
  // promising an outcome the charge/credit then failed to deliver;
  // surfacing the error to the admin (rather than silently persisting a
  // mismatched resolution) is the least-bad option, matching close-charge.ts's
  // own "never silently settle a wrong amount" discipline.
  if (captureOutcome === 'captured') {
    const overrideAmount = input.resolution === 'full_cancellation' ? 0 : (input.resolutionAmount ?? 0);
    const result = await closeCampaignAndCharge(campaign!.id, {
      overrideAmount,
      overrideReason: input.resolution === 'full_cancellation' ? 'cancellation_full' : 'cancellation_partial_charge',
    });
    finalAmount = result.amount;
    if (result.outcome === 'charged') {
      sumitDocumentId = result.documentId ?? null;
      sumitDocumentUrl = result.documentUrl ?? null;
    }
  } else if (captureOutcome === 'refunded') {
    const charged = campaign!.final_charge_amount ?? 0;
    const creditAmount = input.resolution === 'full_cancellation' ? charged : Math.max(0, charged - (input.resolutionAmount ?? 0));
    finalAmount = creditAmount;
    if (creditAmount > 0) {
      const result = await creditHeldCardSumit({
        companyId: (await getSumitServerConfig())!.companyId, // same config source close-charge.ts already reads
        apiKey: (await getSumitServerConfig())!.apiKey,
        cardToken: campaign!.card_token_ref!,
        expMonth: campaign!.card_exp_month!,
        expYear: campaign!.card_exp_year!,
        citizenId: campaign!.card_citizen_id!,
        externalRef: campaign!.auth_external_ref ?? '',
        amount: creditAmount.toString(),
        customerEmail: ownerEmail,
        customerName: ownerName,
      });
      sumitDocumentId = result.documentId;
      sumitDocumentUrl = result.documentUrl;
    }
  }

  // Best-effort, never blocks: a failed/skipped SMS must not undo the email
  // (or capture) that already happened, and must not leave the request open.
  if (reqRow.sms_consent && ownerPhone) {
    try {
      const smsSender = await getSmsSender();
      const smsText = buildCancellationSmsText({
        fullName: ownerName,
        requestNumber: reqRow.request_number,
        resolution: input.resolution,
        resolutionAmount: finalAmount || undefined,
      });
      await smsSender.send({ to: ownerPhone, text: smsText });
    } catch {
      // Recorded via activity log only (no PII) — never rethrown.
    }
  }

  if (input.resolution !== 'declined' && event.status !== 'closed') {
    await adminCloseEvent(event.id);
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from('event_cancellation_requests')
    .update({
      status: 'resolved',
      resolution: input.resolution,
      resolution_amount: finalAmount || null,
      capture_outcome: captureOutcome,
      sumit_document_id: sumitDocumentId,
      sumit_document_url: sumitDocumentUrl,
      resolution_note: input.resolutionNote,
      resolved_at: now,
    })
    .eq('id', requestId);

  if (updateError) {
    throw new Error('העדכון נשלח ללקוח (והחיוב, אם היה, בוצע), אך שמירת הרשומה נכשלה — נא לרענן ולתעד ידנית לפני פעולה נוספת');
  }

  await logActivity({
    eventId: event.id,
    action: 'event_cancellation.resolved',
    meta: { requestId, resolution: input.resolution, captureOutcome },
  });
}
```

(The `documentId`/`documentUrl` fields read here come from Task 4's extension to `CloseChargeOutcome` — implement Task 4 before this step, in task order, so this compiles.)

**SMS `to` field — RESOLVED (verified live during planning, 2026-08-21):** `public.profiles` has a `phone text` column (`id, full_name, phone, created_at, updated_at` — confirmed via `information_schema.columns`), one row per `auth.users` id. Per the owner's explicit instruction, the SMS goes to the CONNECTED/LOGGED-IN user's own phone on file — i.e. `profiles.phone` for `event.owner_id` — the same row already being read for `full_name` in Step 3 below, not a separate contact/celebrant lookup. If `profiles.phone` is null for a given owner (never captured at signup, or an older account), skip the SMS silently — same "best-effort, never blocks" contract as the rest of the SMS path — and let the mandatory email be the only channel.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/data/event-cancellation.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/event-cancellation.ts src/lib/data/event-cancellation.test.ts
git commit -m "feat(events): add cancellation-request data layer (create/list/resolve)"
```

---

## Task 9: Customer-facing request form

**Files:**
- Create: `src/app/(customer)/app/events/[id]/cancellation-request-form.tsx`
- Modify: `src/app/(customer)/app/events/[id]/actions.ts` (add `createCancellationRequestAction`)
- Modify: `src/app/(customer)/app/events/[id]/page.tsx` (render the form when `status !== 'draft'`, pass the event's existing request if any)
- Test: `src/app/(customer)/app/events/[id]/actions.test.ts` (extend)

**Interfaces:**
- Consumes: `createCancellationRequest` (Task 6), `createCancellationRequestSchema` (Task 3).
- Produces: `createCancellationRequestAction: BoundAction` (same `FormState` shape as every other action in `actions.ts`).

- [ ] **Step 1: Write the failing test** (mirrors the existing `actions.test.ts` pattern for another action in the same file — read that file's top-of-file mock setup first and follow it exactly, do not invent a different mocking style)

```typescript
// Added to the existing describe blocks in actions.test.ts:
describe('createCancellationRequestAction', () => {
  it('returns a notice with the request number on success', async () => {
    vi.mocked(createCancellationRequest).mockResolvedValue({ id: 'r1', requestNumber: 42 });
    const fd = new FormData();
    fd.set('reason', 'שינוי תוכניות משפחתיות');
    fd.set('smsConsent', 'on');
    const result = await createCancellationRequestAction('e1', null, fd);
    expect(result?.notice).toContain('42');
  });
  it('surfaces a validation error for a too-short reason', async () => {
    const fd = new FormData();
    fd.set('reason', 'קצר');
    const result = await createCancellationRequestAction('e1', null, fd);
    expect(result?.fieldErrors?.reason).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the action** (append to `actions.ts`, following the exact `FormState`/`unstable_rethrow`/`revalidatePath` pattern every other action in that file already uses)

```typescript
import { createCancellationRequest } from '@/lib/data/event-cancellation';
import { createCancellationRequestSchema } from '@/lib/validation/event-cancellation';

export async function createCancellationRequestAction(
  eventId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createCancellationRequestSchema.safeParse({
    reason: formData.get('reason'),
    smsConsent: formData.get('smsConsent') === 'on',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const { requestNumber } = await createCancellationRequest(eventId, parsed.data);
    revalidatePath(`/app/events/${eventId}`);
    return { notice: `בקשת הביטול נשלחה — מספר בקשה #${requestNumber}. נעדכן אותך במייל.` };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'פתיחת בקשת הביטול נכשלה' };
  }
}
```

- [ ] **Step 4: Implement the form component** — mirror `event-status-actions.tsx`'s `ActionButton` styling exactly (same classes), but as a `<form>` with a `<textarea name="reason">`, a `<label><input type="checkbox" name="smsConsent"></label>` reading **"אני מאשר/ת קבלת עדכון SMS לגבי בקשה זו (בנוסף לעדכון במייל, שיישלח בכל מקרה)"** — unchecked by default, matching the RSVP call-consent checkbox convention (`rsvp-form.tsx:259-268`: explicit opt-in, never pre-checked. If a request already exists for the event (`existingRequest` prop non-null), render its status/number/resolution instead of the form (one open request at a time — the DB has no uniqueness constraint enforcing this; enforce it in the UI/query: `listCancellationRequestsForAdmin`-sibling `getCancellationRequestForEvent(eventId)` reads the latest row and the form only renders when there is none or the latest is `resolution='declined'`).

- [ ] **Step 5: Wire into `page.tsx`** — fetch the event's latest cancellation request (new small read function `getCancellationRequestForEvent`, owner-scoped via the cookie client + `ecr_owner_select` policy) and pass it + the bound action to the new component, rendered below `EventStatusActions` only when `status !== 'draft'`.

- [ ] **Step 6: Run to verify it passes** — `npx vitest run src/app/'(customer)'/app/events/\[id\]/actions.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/app/'(customer)'/app/events/\[id\]/cancellation-request-form.tsx \
        src/app/'(customer)'/app/events/\[id\]/actions.ts \
        src/app/'(customer)'/app/events/\[id\]/actions.test.ts \
        src/app/'(customer)'/app/events/\[id\]/page.tsx
git commit -m "feat(events): customer-facing cancellation request form"
```

---

## Task 10: Admin queue + resolve UI

**Files:**
- Create: `src/app/(admin)/admin/cancellations/page.tsx` (mirrors `admin/contacts/page.tsx`)
- Create: `src/app/(admin)/admin/cancellations/[id]/page.tsx`
- Create: `src/app/(admin)/admin/cancellations/actions.ts`
- Create: `src/app/(admin)/admin/cancellations/resolve-form.tsx` (mirrors `contact-reply-form.tsx`)
- Modify: admin nav (wherever `admin/contacts` or `admin/callbacks` is registered — grep the admin-shell nav config for the exact file before editing, follow its permission-gating pattern for the new `manage_billing`-gated entry)
- Test: `src/app/(admin)/admin/cancellations/actions.test.ts`

**Interfaces:**
- Consumes: `listCancellationRequestsForAdmin`, `getCancellationRequestForAdmin`, `computeSuggestedCancellationAmount`, `resolveCancellationRequest` (Task 8), `resolveCancellationRequestSchema` (Task 5).
- Produces: `resolveCancellationRequestAction: BoundAction`.

- [ ] **Step 1: Write the failing test** for `resolveCancellationRequestAction` — same shape as Task 9 Step 1, three cases (full_cancellation success, partial_charge requires amount, declined success), plus one asserting `unstable_rethrow` is used for a Next.js redirect signal (mirror `settleCampaignAction`'s test in `campaign-actions.test.ts:203-209`).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `actions.ts`** — same `FormState`/Zod-parse/`unstable_rethrow`/`revalidatePath('/admin/cancellations')` shape as every other admin action file (read `admin/contacts/actions.ts` first and match its exact structure, including its error-message style).

- [ ] **Step 4: Implement `page.tsx`** (queue list) — table with columns: request number, event name, owner, reason (truncated), status, created date; pending rows first, linked to the detail page. Mirror `admin/contacts/page.tsx`'s `PageHeading`/`Table`/`EmptyState` usage exactly.

- [ ] **Step 5: Implement `[id]/page.tsx`** (detail) — full reason text, event + campaign billing summary (reuse `getCampaignBillingSummary`), and whichever of the two applies BEFORE rendering the form: if the campaign's `charge_status` is `'charged'`, show a clear banner ("קמפיין זה כבר חויב — אישור כאן לא יבצע חיוב/זיכוי אוטומטי, יש לטפל בהחזר ידנית ב-SUMIT") so staff never mistake this for an automatic refund; otherwise show a banner confirming that a `partial_charge`/`full_cancellation` decision here WILL execute a real SUMIT capture immediately. Render `resolve-form.tsx` only when `status === 'pending'`; once resolved, show the recorded resolution/note/`capture_outcome`/receipt link (if any) read-only.

- [ ] **Step 6: Implement `resolve-form.tsx`** — three-way radio (`full_cancellation` / `partial_charge` / `declined`); a `resolutionAmount` number input that only renders (client-side toggle) when `partial_charge` is selected, PRE-FILLED from `computeSuggestedCancellationAmount(campaignId)` (passed down as a prop from the server component in Step 5) so staff sees a number grounded in real usage + the agreement's fee formula, but can still edit it before submitting — never a blind auto-charge; a `resolutionNote` textarea. Confirm dialog before submit (mirroring `ActionButton`'s `confirm` prop), with wording that differs by whether the campaign is pre- or post-charge (from Step 5's banner state) so the confirm text never claims an automatic action that won't actually happen.

- [ ] **Step 7: Nav entry** — add a `manage_billing`-gated nav item, following whatever pattern gates the existing `admin/sumit-test`/`admin/webhooks` entries (grep the nav config first; do not invent a new gating mechanism).

- [ ] **Step 8: Run to verify it passes.**

- [ ] **Step 9: Commit**

```bash
git add src/app/'(admin)'/admin/cancellations/
git commit -m "feat(admin): cancellation-request review queue and resolve UI"
```

---

## Task 11: Full verification gate

- [ ] **Step 1:** `npx tsc --noEmit -p .` — expect clean.
- [ ] **Step 2:** `npx eslint <every file touched above>` — expect clean.
- [ ] **Step 3:** `npx vitest run` (full suite, not just the new files) — expect all pass, no regressions in `admin-data-layer-coverage.test.ts` (it may need a new entry for `listCancellationRequestsForAdmin`/`getCancellationRequestForAdmin`/`resolveCancellationRequest`/`adminCloseEvent` if that test mechanically enumerates admin DAL functions — check it first) and no regressions in the EXISTING `close-charge.test.ts`/`campaign-actions.test.ts` suites (Task 4 modifies a live, already-shipped billing file).
- [ ] **Step 4:** `npm run build` (uses `NEXT_DIST_DIR=.next-verify`, isolated from the live `.next` pm2 serves — safe to run without a deploy). Check no other `next build` is running first (`pgrep -af "next build"`) per [[concurrent-build-collision]].
- [ ] **Step 5:** A real-money dry run BEFORE the first production use, on a held test card only (never a real customer's card): create a throwaway test campaign with a small J5 hold, submit a cancellation request against it, resolve as `partial_charge` with a small confirmed amount, and confirm in the SUMIT dashboard that the actual capture matches `resolution_amount` exactly and the receipt document exists. This is the one step in this plan that touches real payment-provider state — get explicit owner sign-off on the test amount/card before running it, per CLAUDE.md's billing-change approval requirement.
- [ ] **Step 6:** Runtime check per [[verification-gate-runtime]] — an authed browser pass (owner or a session with the Chrome extension connected) through: open a non-draft event → submit a cancellation request → confirm the request number shown → as admin, resolve it (all 3 resolution types, across separate test requests, including one against a campaign already `charge_status='charged'` to exercise the manual-refund branch) → confirm email arrives with the right numbers/amounts, SMS arrives only for the consent=true case, and the event closes only for full_cancellation/partial_charge.
- [ ] **Step 7: Final report** — changed files, verification results (tsc/lint/vitest/build/Step 5's live capture test), and explicitly note SMS/email were verified against a real inbox/phone or only unit-tested (per [[verifying-kalfa-changes]], static gates don't prove the runtime behavior).

---

## Self-Review Notes (per the writing-plans skill)

- **Spec coverage**: FK hardening (Task 1) ✓, request-number (Task 2) ✓, three resolution outcomes actually EXECUTED via SUMIT when pre-charge, honestly manual when post-charge (Tasks 2,4,8) ✓, cancellation-fee formula as configurable data pending legal confirmation (Task 3) ✓, email on every resolution (Tasks 7,8) ✓, SMS gated by an explicit non-pre-checked consent checkbox collected at request time, sourced from the logged-in owner's own `profiles.phone` per the owner's explicit instruction (Tasks 2,6,8,9) ✓, no invented refund capability where none exists (Global Constraints + Task 8's `manual_refund_required` branch) ✓.
- **Known open item, flagged not hidden**: this entire plan's DEFAULT numbers (Task 3: 5%, ₪100, 14 days) are the agreement's current text, not yet confirmed against the statutory formula in חוק הגנת הצרכן — `legal-cancellation-research` was dispatched mid-planning and Task 3 is explicitly gated on its answer (or an explicit owner override) before applying that migration. Every other task is independent of that answer and can proceed regardless.
- **Type consistency check**: `closeCampaignAndCharge`'s new `opts` parameter (Task 4) is threaded through unchanged into Task 8's single call site; `CloseChargeOutcome`'s new `documentId`/`documentUrl` fields (Task 4) are consumed by name in Task 8's `sumitDocumentId`/`sumitDocumentUrl` assignment — verified matching on both sides while writing this plan.
