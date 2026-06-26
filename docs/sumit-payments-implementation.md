# SUMIT Payments Implementation

> Implementation record for the SUMIT payment integration described in
> `/var/www/vhosts/kalfa.me/.claude/plans/lexical-leaping-crescent.md`.
> This is a faithful, grounded record produced after the implementation steps ran.
> **It is NOT a statement that the feature is shippable.** See sections 4 and 5.

## 1. Overview

KALFA is a per-event B2C RSVP platform. This feature lets a customer pay for a
pending (or previously-failed) order through SUMIT (app.sumit.co.il). The browser
tokenizes the card with SUMIT's `payments.js` library (no PAN ever touches our
server), submits the resulting single-use `og-token` to a Next.js Route Handler,
which atomically locks the order, charges SUMIT server-side with the service-role
key, and records the result (`paid` / `failed` / `payment_review`). Ambiguous
outcomes are quarantined to `payment_review` and resolved by an admin
reconciliation endpoint. The flow adds two `order_status` enum values
(`processing`, `payment_review`), four payment-tracking columns on `orders`, and
tightens the `orders` RLS policy from ALL to SELECT-only (status writes go through
the admin client only).

## 2. What was implemented (grouped by area)

### Database migrations (files only — NOT applied to any DB)
- `supabase/migrations/202606240002_order_payment_statuses.sql` — adds the two new
  enum values (`'processing'`, `'payment_review'`) via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.
  Isolated in its own migration because Postgres cannot use a new enum value in the
  same transaction that adds it; this must be committed before `_0003`.
- `supabase/migrations/202606240003_order_payment_flow.sql` — adds 4 columns
  (`sumit_document_id`, `paid_at`, `payment_attempt_ref uuid NOT NULL DEFAULT gen_random_uuid()`,
  `payment_processing_started_at`), two unique indexes (`orders_payment_attempt_ref_unique`;
  `orders_sumit_document_id_unique` partial WHERE not null), and swaps RLS
  `orders_owner` (ALL) for `orders_owner_select` (SELECT-only).

### Types & validation
- `src/lib/supabase/types.ts` — `order_status` widened to 6 values in both the
  literal union and the const array; `orders` Row/Insert/Update gained the new
  payment fields.
- `src/lib/validation/schemas.ts` — `ORDER_STATUSES` widened to 6 values; new
  `payPendingOrderSchema` (Zod 4 `{ error: ... }` syntax: `order_id` uuid +
  `'og-token'` trimmed non-empty).

### Status label maps (4 parallel maps, all expanded to 6 statuses)
- `src/lib/data/orders.ts` — customer `ORDER_STATUS_LABELS`.
- `src/lib/data/admin/labels.ts` — admin `ORDER_STATUS_LABELS`.
- `src/app/(customer)/app/settings/settings-client.tsx` — local label map.
- (`schemas.ts` `ORDER_STATUSES` above is the 4th source of truth.)

### SUMIT server module (server-only)
- `src/lib/sumit/env.ts` — `getSumitServerEnv()`: reads `NEXT_PUBLIC_SUMIT_COMPANY_ID`
  + `SUMIT_API_KEY`, throws if missing/invalid.
- `src/lib/sumit/charge.ts` — `chargeSumit()`, `SumitChargeParams`/`SumitChargeResult`,
  and the `SumitNetworkError` (ambiguous) vs `SumitDeclinedError` (definitive decline)
  error classes. Sends `payment_attempt_ref` as `Customer.ExternalIdentifier`,
  `og-token` as `SingleUseToken`, Hebrew item description, `SendDocumentByEmail`
  gated on a non-empty email.

### Data access for the pay flow
- `src/lib/data/orders.ts` — added `OrderDetail` type, `ORDER_DETAIL_COLUMNS`, and
  `getOrder()` (user/RLS-scoped read; `notFound()` on missing row). **See section 4 —
  this file holds the build-blocking defect.**
- `src/lib/data/admin/orders.ts` — `AdminOrder` extended with
  `payment_processing_started_at` and a server-derived `isStuckProcessing` flag
  (processing older than 10 min); column projection updated.

### Route Handlers (API)
- `src/app/api/orders/[id]/pay/route.ts` — the customer pay endpoint (POST): CSRF
  origin check, auth, `og-token` validation, atomic `pending|failed → processing`
  lock returning the locked amounts, amount validation, `chargeSumit`, and the
  outcome routing (`failed`+retry vs `payment_review`). All redirects are 303.
- `src/app/api/admin/orders/[id]/reconcile/route.ts` — admin reconciliation (POST),
  `requireAdmin`-gated, `action: auto | manual | reset` via a Zod discriminated union.
  Auto path calls `/billing/payments/get/` and gates on `Data.Payment.ValidPayment`;
  inconclusive lookups make no status transition.

### Customer UI
- `src/app/(customer)/app/orders/[id]/pay/page.tsx` — Server Component: renders by
  status (paid → success; payment_review → warning, no retry; pending|failed → form),
  decodes only fixed error codes from the querystring (no raw SUMIT text surfaced).
- `src/app/(customer)/app/orders/[id]/pay/payment-form.tsx` — Client Component:
  native `data-og="form"`, loads jQuery then injects `payments.js`, calls
  `OfficeGuy.Payments.BindFormSubmit`, disables submit until ready; card fields use
  `data-og` attributes with no `name`.
- `src/app/(customer)/app/orders/page.tsx` — "שלם עכשיו" Link for pending|failed,
  distinct badges for processing/payment_review, success banner on `?paid=1`.

### Admin UI
- `src/app/(admin)/admin/orders/reconcile-button.tsx` — Client Component button that
  POSTs `{ action }` to the reconcile endpoint (auto / reset modes), handling the
  three contract outcomes inline (no window.confirm/alert).
- `src/app/(admin)/admin/orders/page.tsx` — renders the reconcile CTAs: `auto` for
  `payment_review` rows, `reset` + a "תקוע" badge for stuck `processing` rows.

### Environment
- `.env.example` — appended the SUMIT block (`NEXT_PUBLIC_SUMIT_COMPANY_ID`,
  `NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY`, `SUMIT_API_KEY`) and `APP_ORIGIN`, all with
  **empty values** and explanatory comments. No secrets written.

### Tests
- `src/lib/sumit/charge.test.ts` — 8 cases (success, declined, network, HTTP 500,
  bad JSON, missing DocumentID, ExternalIdentifier wiring, empty-email behavior).
- `src/lib/data/orders.test.ts` — added a `getOrder` describe block (owner/notFound/error).
- `src/lib/validation/schemas.test.ts` — added `payPendingOrderSchema` cases.
- `src/lib/data/admin/orders.test.ts` — fixture updated for the two new `AdminOrder` fields.

## 3. Key security decisions

- **Atomic lock with a rotating ref.** The pay endpoint does a single conditional
  `UPDATE ... WHERE status IN ('pending','failed') SET status='processing',
  payment_attempt_ref=crypto.randomUUID(), payment_processing_started_at=now()` and
  reads back the row. 0 rows updated means the order is already being processed or is
  not payable — this blocks double-charge from concurrent tabs. A fresh
  `payment_attempt_ref` is minted on every attempt (including retries of a `failed`
  order), and every post-lock write is filtered by that exact ref.
- **Decline vs. ambiguity drives retry safety.** Only a definitive SUMIT decline
  (`SumitDeclinedError`) moves the order to `failed` (which is retry-eligible).
  *Every other* error — network failure, non-2xx, parse failure, missing DocumentID —
  is treated as an unknown outcome and moves the order to `payment_review`, which has
  **no retry button**, so a possibly-captured charge is never silently re-attempted.
- **`sumit_document_id` is saved even on `payment_review`.** If the charge succeeds
  but the mark-paid DB write fails/matches 0 rows, the order goes to `payment_review`
  *with* `sumit_document_id` set — so admin reconciliation path A can call
  `/billing/payments/get/` by PaymentID instead of relying on manual lookup.
- **303 redirects, never 307.** All redirects from the Route Handler use
  `NextResponse.redirect(url, 303)` (not `redirect()` from next/navigation, which
  returns 307 outside a Server Action). 303 converts the POST to a GET, preventing the
  browser from re-POSTing card data to the error/success page.
- **CSRF fail-closed.** `isAllowedOrigin()` hard-throws if `APP_ORIGIN` is unset (no
  silent fallback for a security variable), checks Origin then Referer, and **denies**
  when both are absent. `http://localhost:3002` is allowed **only** in development.
- **Server-only secrets + admin client.** `SUMIT_API_KEY` and the service-role key
  live server-side (`import 'server-only'`); status writes go exclusively through
  `createAdminClient()`. Logs carry only `orderId` / `paymentAttemptRef` / `documentId`
  — never the og-token, card data, API keys, or raw SUMIT bodies.
- **RLS reduced to SELECT-only.** Migration `_0003` drops the `orders_owner` ALL policy
  and replaces it with `orders_owner_select` (SELECT, `user_id = auth.uid()`). Users can
  read their own orders but cannot write status; all status transitions are performed by
  the admin client server-side, which is the trusted authorization boundary.

## 4. Verification results (honest, per gate)

Run from repo root after all steps. Nothing was fixed during verification.

| Gate | Result | Notes |
|------|--------|-------|
| `npm run lint` (eslint) | **PASS (with 1 warning)** | 0 errors, 1 warning: `src/app/api/orders/[id]/pay/route.ts:5:23` — `'SumitNetworkError' is defined but never used` (`@typescript-eslint/no-unused-vars`). |
| `npx tsc --noEmit` | **FAIL (exit 1)** | 1 error — `src/lib/data/orders.ts:96:10 TS2352`: `Conversion of type 'GenericStringError' to type 'OrderDetail' may be a mistake`. |
| `npm test` (vitest run) | **PASS** | 19 test files, 213 tests passing. |
| `npm run build` (`next build --webpack`) | **FAIL (exit 1)** | Webpack compiled successfully; the build's TS type-check failed at the **same** `orders.ts:96` error. |

**The feature does NOT build or type-check as committed.** Both the `tsc` and `build`
failures share a single root cause, verified on disk: in `src/lib/data/orders.ts`,
`ORDER_DETAIL_COLUMNS` (lines 77–79) is assembled with string **concatenation**
(`'...package_id, ' + 'sumit_document_id, ...'`). Supabase/PostgREST can infer a typed
row only from a **string literal** passed to `.select()`; a concatenated argument
collapses to `GenericStringError`, so `return data as OrderDetail` (line 96) is a
non-overlapping cast and TS rejects it. The sibling `listOrders()` uses a single
literal `ORDER_COLUMNS` and type-checks cleanly — confirming the diagnosis.

**Fix (owned by plan step 4.5 / 6a, NOT done here):** collapse `ORDER_DETAIL_COLUMNS`
to a single string literal (or cast through `unknown`). Regenerating Supabase types does
not help. This one-line change is the only thing standing between the current state and
a green `tsc`/`build`. The `route.ts:5` unused-import warning should be cleaned up at the
same time (drop `SumitNetworkError` from the import, or reference it).

## 5. DEFERRED manual steps (NOT done by automation, and why)

These were intentionally left for a human with explicit approval. The hard constraints
on this work forbid running SQL/migrations, writing real secrets, or restarting services.
Note: `src/lib/supabase/types.ts` was hand-edited to assume columns and enum values that
**do not yet exist in the live DB**, so runtime will not work until the migrations are
applied — even after the `orders.ts:96` fix.

1. **Apply migration `202606240002` (enum values) and COMMIT it — first, on its own.**
   Postgres cannot use a newly-added enum value inside the same transaction that adds it,
   so `_0002` must be a committed transaction before `_0003` runs. Requires explicit
   approval to run against the live Supabase project (the beta is linked to the live
   `kalfa-event-magic` project — never push schema from scratch; apply these two files).
2. **Then apply migration `202606240003`** (columns, unique indexes, RLS swap). Only after
   `_0002` is committed. Also requires explicit approval — it drops/recreates the `orders`
   RLS policy.
3. **Add real values to `.env.local`** (not committed, not edited by automation):
   `NEXT_PUBLIC_SUMIT_COMPANY_ID`, `NEXT_PUBLIC_SUMIT_API_PUBLIC_KEY`, `SUMIT_API_KEY`,
   a real `SUPABASE_SERVICE_ROLE_KEY` (the current one is a placeholder; `createAdminClient()`
   throws on a placeholder), and `APP_ORIGIN` (e.g. `https://beta.kalfa.me`).
4. **`pm2 restart kalfa-beta`** after the migrations are applied and `.env.local` is
   populated (beta is served by pm2 `kalfa-beta` running `next start :3002`). Do this only
   after the `orders.ts:96` build blocker (section 4) is fixed and the build is green.

## 6. Deviations & open items (as flagged by the implementing agents)

### Functional — must address before this is trusted in production

- **`orders.ts:96` build blocker** — see section 4. Concatenated `ORDER_DETAIL_COLUMNS`
  → `GenericStringError` → TS2352. Fix: single string literal. Owned by step 4.5/6a; not done.

- **`charge.ts` decline gate may never fire (HIGH-VALUE RISK).** `chargeSumit()` decides a
  definitive decline with `if (json.Status?.IsError)`. But `swagger.json` defines the SUMIT
  response `Status` as a **string enum**, `Teva.Common.ResponseStatus =
  "Success (0)" | "BusinessError (1)" | "TechnicalError (2)"` — and the token `IsError`
  appears **nowhere** in `swagger.json` (verified by grep). Reading `.IsError` off a string
  is always `undefined`, so `SumitDeclinedError` would never be thrown and **every** SUMIT
  decline would fall through to `payment_review` instead of `failed`+retry — defeating the
  core retry design described in section 3. The reconcile agent independently noticed the
  same inconsistency and deliberately gated *its* path on the boolean `Data.Payment.ValidPayment`
  rather than copying `charge.ts`'s `Status?.IsError`. **Action:** confirm the actual
  `/billing/payments/charge/` response shape against SUMIT (the swagger evidence says
  `Status` is a string enum, so the gate should likely be
  `if (json.Status && json.Status !== 'Success (0)')` or equivalent), then align the
  `ChargeResponse` type and the decline check. This was transcribed verbatim from the plan,
  so it is a latent plan bug, not a transcription error.

### Design deviations (intentional, consistent with plan intent)

- **Reconcile UI lives on the LIST page, not a detail page.** The plan referenced
  `/admin/orders/[id]`; no such detail route exists, so the CTAs were wired into the
  existing `/admin/orders` list rows per the assignment instruction.
- **Reconcile auto-path gates on `Data.Payment.ValidPayment`** (the unambiguous boolean per
  swagger) and treats any inconclusive SUMIT response (network/non-2xx/parse/missing Payment)
  as `{ reconciled: false }` with **no** status transition, to avoid re-enabling retry on a
  possibly-captured charge.
- **`isStuckProcessing` computed in the data module, not the page.** ESLint
  `react-hooks/purity` rejects `Date.now()` in a Server Component render path, so the
  10-minute stuck-processing derivation was relocated into `listAllOrders()` in
  `src/lib/data/admin/orders.ts` (request-time, server-side) — keeping the page render pure.

### Cosmetic / test-hygiene (low risk)

- `src/lib/validation/schemas.test.ts` — a pre-existing `ORDER_STATUSES` assertion still
  expected the old 4-value vocabulary and was updated to the explicit 6 values (kept as a
  hardcoded tripwire, not made tautological).
- `src/lib/data/admin/orders.test.ts` — fixture extended with the two new required
  `AdminOrder` fields (`payment_processing_started_at: null`, `isStuckProcessing: false`);
  no assertion/behavior change.
- `.env.example` — `APP_ORIGIN` was added with an empty value. The plan's `.env.example`
  code block did not itself list it (it appeared in the `.env.local` section), but the
  execution order explicitly puts it in `.env.example`. `https://beta.kalfa.me` appears only
  as a non-binding example inside a comment.
- `src/lib/supabase/types.ts` — punctuation adapted to the generated file's style (double
  quotes, no trailing semicolons/commas) rather than the plan block's cosmetics; the
  semantic tokens (field names, type unions, enum value ordering, `| null`) are exact.
