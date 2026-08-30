# Plan — Persist SUMIT `CustomerID`: stop duplicate customers + make holds reconcilable

Status: **DRAFT — awaiting approval** (billing / cross-cutting → plan-then-approve per CLAUDE.md)
Date: 2026-07-14
Updated: 2026-08-27 — (a) "Where CustomerID Helps" full-use-case survey, live-verified against
`https://api.sumit.co.il/swagger/v1/swagger.json`; (b) storage moved to a server-only
`sumit_customers` table; (c) hold status found readable via the CRM API (folder 1076735289,
`Billing_Status` 1/2/3) — supersedes the July "not re-queryable" conclusion; (d) hold body
changes: create the Order document (drop `VATRate`), send `Name`/`Phone`, persist the Order
`DocumentID` as the CRM-entity key (existing column `sumit_order_document_id`, never written).
Related memory: `sumit-charge-verified-behavior`, `outcome-billing-model`

## Problem

A J5 authorize-only hold is **not re-queryable through the billing/payments API** (`Payment.ID:0`;
`payments/list`, `payments/get`, `creditguy/gateway/gettransaction` all return "not found" —
verified live 2026-07-14 for the brit hold, campaign `15a8730e`).

> **SUPERSEDED IN PART, 2026-08-27 — the hold IS readable, via the CRM API.** The owner found
> that SUMIT stores every hold as an entity in CRM folder `1076735289` ("תפיסות מסגרת").
> `POST /crm/data/listentities/ {Folder: 1076735289, LoadProperties: true}` lists them all with
> `Billing_Status` (decoded from the owner's dashboard: **1 = ממתינה לחיוב / open, 2 = בוצע
> חיוב / captured, 3 = בוטלה / released**), plus links to the customer, payment method, Order
> document, payment document and the terminal transaction (`CreditGuy_ParamJ: 5`,
> `TransactionStatus: 12 = Deposit_NotNeeded`). Measured 27.8: 16 holds ever placed, **14
> still open (status 1)** including the 1.7 ₪4 "stuck" hold and the brit ₪152 — open records
> in SUMIT, not necessarily bank-blocked money. `getforcustomer` therefore stops being the
> only lookup; `CustomerID` remains the right anchor for dedup, and the CRM listing is the
> right tool for hold status/reconciliation. (`creditguy/billing/getstatus` is the separate
> BATCH-terminal path and does NOT apply — checked exhaustively, don't retry it.)

For the payer's **saved card** specifically, the unambiguous lookup is
`POST /billing/paymentmethods/getforcustomer/` `{Customer:{ID:<CustomerID>}}`, which needs the
SUMIT **CustomerID**. (For the hold's *status*, use the CRM listing above instead.)
(`GetForCustomer_Request.Customer` is the same `Accounting_Typed_Customer`
schema as the charge endpoints, so it can in principle accept `SearchMode`+`EmailAddress`/
`ExternalIdentifier` instead — but that path stays unreliable for us: `ExternalIdentifier` is a
`crypto.randomUUID()` minted fresh per hold attempt [`authorize/route.ts:162`], never stable per
real customer, and an `EmailAddress` search risks matching multiple ambiguous records precisely
*because of* the duplicate-customer gap documented in "Problem 2" below. `CustomerID` is the only
lookup with no ambiguity.)

The J5 response DOES return it as `Data.CustomerID` ("Customer number"), but `authorize.ts`
drops it — the `Resp.Data` type omits `CustomerID`, and the charge sends
`Customer:{EmailAddress, ExternalIdentifier}`, never `Customer.ID`.

**Impact:** holds are not reconcilable/auditable after the fact. Two ids are thrown away:
`Data.CustomerID` (needed for `getforcustomer` and for dedup), and — once the Order document
is enabled (Changes §3) — the Order's `Data.DocumentID`, which is the ONLY key that links our
campaign row to the hold's CRM entity (`Billing_OrderDocument.ID`), and therefore to its
`Billing_Status`. The hold response never returns the CRM entity id itself.

> Note: this is a **reconciliation/robustness** fix, NOT a blocker for charging. The existing
> token-based charge (`capture.ts` → saved `CreditCard_Token`) already works a month+ later and
> is unaffected.

## Problem 2 — a repeat customer's next hold creates a NEW SUMIT customer (CONFIRMED; within-campaign hold→capture does NOT duplicate — settled, see below)

Live-fetched `https://api.sumit.co.il/swagger/v1/swagger.json` directly (`curl`, 2026-08-27,
593,190 bytes / 19,502 lines) — not the vendored `swagger.json` alone — and cross-checked every
claim below against that live copy. The two matched for every section examined.

- `Customer.SearchMode`: *"Customer searching mode. **Defaults to None**"* —
  `Accounting_Typed_CustomerSearchMode` enum: `Automatic (0)`, `None (1)`, `ExternalIdentifier (2)`,
  `Name (3)`, `CompanyNumber (4)`, `Phone (5)`, `EmailAddress (6)`.
- `/accounting/customers/create/` is itself titled *"Create customer or find existing customer
  **according to SearchMode**"* — the endpoint's own summary frames matching as conditional on
  `SearchMode`, not automatic from `EmailAddress`/`ExternalIdentifier` being present.
- **Our code never sets `SearchMode`** anywhere: `grep -rn "SearchMode" src/lib/sumit/` → zero
  matches (verified 2026-08-27). We send `Customer:{EmailAddress, ExternalIdentifier}` with no
  `SearchMode`.

**Resolution (2026-08-27).** The swagger file carries an apparent contradiction: the schema
description says *"Defaults to None"*, while the illustrative request *example* for the exact
endpoint we call (`/billing/payments/charge/`) shows `"SearchMode": 0` (= `Automatic`). The
examples for `beginredirect` and `recurring/charge` also show `0`; the `customers/create` /
`customers/update` examples show `None`. This is **settled by SUMIT's official SearchMode
documentation** (owner supplied it 2026-08-27; it is SUMIT's own product doc, not the spec):

> "אם לא מגדירים אותו, הערך ברירת המחדל הוא **None**" … "**None** – לא מחפשים לקוח קיים.
> **ייווצר לקוח חדש** במסמך." … "**Automatic** – המערכת מנסה לזהות אוטומטית לפי השדות שנשלחו."

So the example's `0` is merely an illustrative populated value; the **omitted-field default is
`None`**, and `None` explicitly means "create a new customer". Since our code omits `SearchMode`,
the claim *"a first hold creates a new SUMIT customer"* is **CONFIRMED** — by documentation AND
by the one live response ever captured (POC 2026-07-01: a J5 hold returned a freshly created
`Data.CustomerID`).

**Within-campaign hold→capture — SETTLED 2026-08-27 (an earlier draft wrongly claimed each
receipt lands on its own duplicate customer; the owner caught it).** It does NOT duplicate. Two independent
sources, one of them empirical:
1. SUMIT's own documentation (owner-supplied): *"המסמך שייך לאותו לקוח שבוצעה עבורו תפיסת
   המסגרת. לא נוצר לקוח חדש במסגרת התהליך הזה."* — the capture's document is attached to
   the hold's customer; no new customer is created by hold→capture.
2. It was already verified LIVE on 2026-06-29 ([[sumit-charge-verified-behavior]]: real ₪4
   hold + partial ₪1 capture on the saved token → "real receipt created + emailed"). The
   earlier statement in this section that "no hold→capture pair has ever run live" was
   **wrong** — it confused the zero *production campaigns* with the zero *live tests*; the
   POC did run the full pair. Corrected.

**What actually links hold → capture** (so nobody re-derives this): NOT `ExternalIdentifier`
and NOT `SearchMode`. The capture re-uses the hold's `CreditCard_Token` in `PaymentMethod`,
and SUMIT attaches the payment method — and therefore the document — to the customer that
token was saved under at hold time. This is why the capture correctly lands on the hold's
customer even though our code sends no `Customer.ID`.

**So the confirmed duplication is ONLY cross-campaign:** a repeat customer's *next* hold
(new event) arrives with a fresh `SingleUseToken`, a fresh `ExternalIdentifier`, and no
`Customer.ID` → SUMIT creates a second customer. That — not the receipt/hold link — is the
whole of Problem 2, and it is exactly what persisting `CustomerID` and sending `Customer:{ID}`
on the next hold fixes.

The SUMIT-dashboard count check the previous draft proposed as the *gate* is no longer needed to
establish the fact. It is still worth one look to **size the existing damage** (how many duplicate
records already exist for owners with 2+ charged campaigns, e.g. the brit owner behind campaign
`15a8730e`) and to decide whether SUMIT's dashboard can merge them — but it no longer blocks the
fix.

**The fix (superseding the options an earlier draft listed):** the decision "existing customer
or new?" is made in exactly ONE place — the HOLD (`authorize.ts`), the first SUMIT contact for
an event. Persist `Data.CustomerID` per paying person (Changes §1/§5a); on the next hold send
`Customer:{ID}` and omit `SearchMode`; on a first-ever hold send the one-time `SearchMode`
bridge. `capture.ts` / `creditHeldCardSumit` are NOT touched — see Changes §5a for why.
Pre-existing duplicates in SUMIT are a separate cleanup question (owner decision, below).

- **Note on `ExternalIdentifier (2)` specifically:** it would NOT dedupe across campaigns as
  currently coded — `authorize/route.ts:162` mints a fresh `crypto.randomUUID()` per hold attempt,
  not a stable per-person id. Only `EmailAddress`/`Automatic` search, or a persisted `Customer.ID`,
  can dedupe across a real customer's multiple events. Also verify with SUMIT support whether
  `EmailAddress` search is exact-match and safe when one email pays for two different real
  people's events (a shared family email) before ever turning it on.

## Where CustomerID Helps — full use-case survey (owner request, 2026-08-27)

The owner asked explicitly: don't scope this to hold-reconciliation alone — survey **every**
place a persisted SUMIT `CustomerID` genuinely matters. "Problem" and "Problem 2" above cover the
first two (hold-reconciliation; duplicate-customer creation). This section covers the rest,
researched against the live SUMIT API, not assumed.

### 1. The correct usage model — SearchMode is a one-time bridge, CustomerID is the steady state (SUMIT official docs, 2026-08-27)

SUMIT's own documentation (owner-supplied) defines the two mechanisms as **complementary, not
alternatives**:

> "*SearchMode* – משמש לחיפוש לקוח לפי שדות (שם, טלפון, אימייל וכו'). *CustomerID* – משמש
> כשיש לך כבר את מזהה הלקוח ואין צורך בחיפוש." … "כאשר כבר יש לך את *CustomerID* של הלקוח,
> פשוט שולחים אותו ישירות בקריאת ה‑API. **אין צורך ב‑SearchMode**."

This dictates the lifecycle, and it unifies Problem 1 and Problem 2 into ONE design:

```
first ever charge for a person   →  no ID yet  →  send SearchMode (+ the field it searches on)
SUMIT response                   →  Data.CustomerID  →  PERSIST it (Problem 1)
every later charge, any event    →  send Customer:{ID}  →  no SearchMode, no search, deterministic
```

**Consequence for the SearchMode ambiguity flagged in Problem 2** (shared family email, exact-
match semantics): it only ever applies to the *first* charge of a person, before an ID exists.
Once the ID is stored, no search happens again. So `SearchMode: EmailAddress` (or `Phone`) is an
acceptable one-time bridge — it does NOT have to be a robust permanent dedup strategy, which is
what made it look risky in isolation.

### 2. Where the CustomerID must be anchored — the paying PERSON, NOT `campaigns` (design correction)

> **Storage (2026-08-27, after option review):** the id lives in a new server-only table
> `sumit_customers(user_id → auth.users)`, NOT as a column on `profiles` — see Changes §1
> "Migration" for the verified reasons. The identity conclusion below (anchor on the paying
> account) is what that table implements.

The 2026-07-14 draft persisted `sumit_customer_id` on **`campaigns` only**. That cannot deliver
the lifecycle above, and the reason is structural, verified 2026-08-27:

- `campaigns` has **no owner/org column at all** — it links to a person only through
  `event_id` (live `types.generated.ts`: no `owner_id`/`org_id`/`user_id` on `campaigns.Row`).
- A repeat customer's second event is a **new campaign row** → `sumit_customer_id` would be
  `null` again → we'd fall back to SearchMode → and if their email changed in between, a
  duplicate customer is created **despite** the fix. The per-campaign column only helps within
  the single campaign that already knows its own hold.
- The payer identity is the **logged-in account**: `authorize/route.ts:173` sends
  `customerEmail: user.email` — i.e. `auth.users`. The stable per-person entity is therefore
  the auth user id itself (`auth.users.id`) — the same key `profiles` uses (verified on the LIVE
  DB via `pg_constraint`: `profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)`). The new
  `sumit_customers.user_id` is keyed to it identically. Reachable from any campaign via
  `campaigns.event_id → events.owner_id`.

**Corrected schema decision — two columns, two tables, different jobs:**

| column | table | semantics |
|---|---|---|
| `sumit_customer_id` | **`sumit_customers`** (server-only, keyed `user_id` → `auth.users`) | the person's canonical SUMIT customer number — written once on first successful hold, reused on every later event. This is the dedup anchor. |
| `sumit_customer_id` + `sumit_payment_method_id` | `campaigns` (as originally planned) | per-hold reconciliation snapshot — what THIS hold returned. Keeps the original Problem-1 use case (getforcustomer for a stuck hold) exactly as designed, and doubles as an audit trail if the `sumit_customers` value ever diverges. |
| **`sumit_order_document_id`** (column ALREADY EXISTS on `campaigns`, currently never written) | `campaigns` | the hold's Order `Data.DocumentID` — the key to the hold's CRM entity (`Billing_OrderDocument.ID`) and thus its live `Billing_Status`. Written by `recordCampaignHold` once §3 enables the Order document. No migration needed for this one. |

Write path: on a successful J5/charge, write `Data.CustomerID` to the campaign row (snapshot)
AND, if no `sumit_customers` row exists for the paying user, insert one (anchor). Never overwrite
an existing `sumit_customers.sumit_customer_id` with a differing later value — if they differ, alert (it means SUMIT returned a
different customer than the one we sent `Customer:{ID}` for, which should be impossible and
warrants a look).

Read path: **the hold only** (`authorize/route.ts` → `authorize.ts`) looks up
`sumit_customers.sumit_customer_id` for the paying user (admin client). Present → `Customer:{ID}`
and omit `SearchMode`. Absent → the one-time bridge (`SearchMode` + email) — the branch every
existing customer's *next* hold takes until their id is captured. The capture does not read it
(Changes §5a).

**Open decisions this creates (owner):**
- Which bridge field for the first charge: `EmailAddress` or `Phone`? (`profiles.phone` exists;
  `user.email` is what we send today.) One-time exposure only, per §1 above.
- Existing customers already duplicated in SUMIT (Problem 2's pre-existing damage): the first
  post-fix charge will bridge on email and pick **one** of their N records; `sumit_customers` then
  locks to it. Acceptable, or merge in SUMIT's dashboard first? Owner call.

**Why the payer is the person and not any other entity (settled, not open):** the SUMIT customer
is whoever presented the card — `authorize/route.ts:173` sends `customerEmail: user.email`, the
account that clicked pay. Two different people paying for two events are, correctly, two SUMIT
customers. The anchor therefore follows the paying account (`sumit_customers.user_id` = the auth user), full stop.

### 3. Refunds — CustomerID is NOT needed (confirmed)

Two refund-adjacent mechanisms exist in the codebase/API, and neither needs `CustomerID`:

- **Credit via the charge endpoint** (`creditHeldCardSumit`, `src/lib/sumit/capture.ts`) — already
  implemented, uses `SupportCredit:true` + a negative item total on `/billing/payments/charge/`,
  authenticated via `PaymentMethod:{CreditCard_Token, expiry, CitizenID}` (already stored on
  `campaigns.card_token_ref`/`card_exp_*`/`card_citizen_id`). No `Customer.ID` involved — only the
  token. Its own `Customer:{}` block *also* omits `ID`/`SearchMode`, so a refund via this path is
  just one more instance of Problem 2's dedup question, not a separate CustomerID need.
  ⚠️ **Caveat unrelated to CustomerID but material for any real refund:** the function's own
  header comment states it is *"UNTESTED against the live SUMIT API as of this writing"* — it is
  unit-tested (`capture.test.ts`) but has never been exercised against SUMIT for a real customer.
  `captureHeldCardSumit`'s hard-won request gotchas (no `VATRate`, no `CreditCardAuthNumber`,
  `AutoCapture:true`) may or may not carry over to the credit direction. A live verification of
  the credit path is its own prerequisite before relying on it — tracked here so it is not
  mistaken for a working feature.
- **Document cancellation** (`/accounting/documents/cancel/`, live-verified) — request schema
  `Accounting_Documents_Cancel_Request` requires only `DocumentID` + `Description` (the reason). No
  `CustomerID` field exists on this request at all. `documentId` is already captured and persisted
  by `close-charge.ts` → `recordCampaignCharge`, so this path is already unblocked by data we have
  today, independent of this plan.

**Conclusion: not adding refunds as a justified use case for CustomerID.**

### 4. Repeat-customer payment-method reuse (skip re-collecting card) — NOT justified now

`getforcustomer` could, in principle, return a returning owner's saved card and let a second event
skip card re-entry. Real SUMIT capability — but four independent reasons say don't build it now:

1. **Billing-unit mismatch:** KALFA bills per-campaign/per-event ([[outcome-billing-model]]), not
   per-customer; there is no existing persistent "customer profile" to attach a reusable card to.
2. **A headless re-authorization IS possible, but it is not a reason to build this.** SUMIT
   support confirmed (14.07.2026, recorded in [[sumit-charge-verified-behavior]] 29.07) that a
   fresh J5 accepts the SAVED `PaymentMethod` token server-side, no browser, no customer present.
   So "skip card re-entry" is technically feasible — which makes reasons 1 and 4 (product
   model, CLAUDE.md guardrail) the real gate, not a technical gap. Do not cite "no headless
   path" as the reason again; it was corrected.
3. **The per-person anchor this plan adds (`sumit_customers`) makes the lookup *possible*, but
   possible ≠ wanted** — reasons 1, 2 and 4 stand on their own.
4. **CLAUDE.md guardrail:** *"KALFA is a per-event B2C product. Do not introduce recurring
   subscription, trial, or entitlement assumptions unless explicitly requested."* A persistent
   "your saved card" UX is exactly that shape of assumption.

**Conclusion: real capability, not currently useful for KALFA's product model. Not adding to
scope** unless the owner explicitly wants a "returning customer" UX as its own product decision.

### 5. Owner-facing admin/support value — CONFIRMED, the strongest case in this survey

Live-verified: `/accounting/customers/getdetailsurl/` (`Accounting_Customers_GetDetailsURL_Request`)
takes a **bare top-level `CustomerID`** (integer — no `SearchMode`/email fallback exists on this
endpoint) and returns `CustomerHistoryURL`: *"Link to the customer details page (דף מידע
ללקוח/ה)"* — a direct deep link into SUMIT's own dashboard for that customer. This is a concrete,
buildable feature — an admin "View in SUMIT" link — and it is possible **only** once
`sumit_customer_id` is persisted (this plan's Phase A).

Current state, confirmed by reading the code, not assumed:
- **Nothing SUMIT-related is surfaced in KALFA's admin UI today.** `listCampaignsForAdmin`
  (`src/lib/data/admin/campaigns.ts:91-114`) deliberately selects only
  `status/charge_status/final_charge_amount/credit_applied`, with an explicit comment *"never
  card/token fields"* — this is a **prior intentional decision**, not an oversight, and should be
  respected as such (any addition is an owner decision, not an assumed yes).
- Separately: `documentId`/`documentUrl`/`documentNumber`/`authNumber`/`paymentId` are already
  captured and persisted by `close-charge.ts` → `recordCampaignCharge`, but
  `grep -rln "documentUrl\|documentNumber" src/app` returns **nothing** — even the receipt link is
  invisible in every UI today (owner or admin). This is a broader, pre-existing gap that CustomerID
  visibility would sit alongside, not create.
- `sumit_customer_id`/`sumit_payment_method_id` are opaque reference ids, not card/token data — the
  plan's own "PII scope" risk note (below) already classifies them as safe to store/log. Surfacing
  them admin-only would not conflict with `listCampaignsForAdmin`'s "never card/token fields"
  principle, since that principle is about credentials, not reference identifiers.

**Recommended scoped addition (small, owner-decision, NOT auto-included in Phase A1):** an
admin-only reveal — on the per-campaign admin/manage view — of `sumit_customer_id` (as a "View in
SUMIT" link via `getdetailsurl`) alongside the already-captured `document_number`/`document_url`/
`auth_number`. Consistent with the existing masked+reveal pattern
([[admin-secrets-in-forms-owner-ruling]]). Genuinely useful, narrowly scoped — flagged here as an
option for the owner to approve, not assumed.

### 6. Other endpoints sharing the same Customer{ID/SearchMode} pattern — noted, not new scope

- `/billing/paymentmethods/setforcustomer/` and `PaymentMethodsController_PaymentMethods_Remove_Request`
  both take the identical `Accounting_Typed_Customer` object — a future "remove saved card" /
  data-deletion-request feature would face the same ID-vs-search ambiguity as Problem 2. No such
  feature exists in KALFA today. Noted for completeness only.
- `/accounting/customers/update/` confirms customers are addressable/updatable by `ID` after
  creation — reinforces that persisting `Customer.ID` (once resolved) is SUMIT's own intended way
  to keep one customer record current, rather than creating fresh ones.

### Provenance

Live-fetched `https://api.sumit.co.il/swagger/v1/swagger.json` on 2026-08-27 (`curl`, 593,190
bytes, 19,502 lines) and diffed by hand against the vendored `swagger.json` in this repo (19,468
lines) for every schema/endpoint cited in "Problem 2" and this section (`Accounting_Typed_Customer`,
`Accounting_Typed_CustomerSearchMode`, `Accounting_Documents_Cancel_Request`,
`Accounting_Customers_GetDetailsURL_Request`/`_Response`, and the `/billing/payments/charge/`
request example) — content matched everywhere checked. **Not** a claim that the vendored copy is
current end-to-end: the two files differ in overall line count and path ordering, and were not
fully diffed beyond the sections above.

## Scope

Persist `Data.CustomerID` from the J5 response in two places: the per-person anchor
`sumit_customers` (dedup — Problem 2) and the per-hold snapshot on `campaigns` (reconciliation —
Problem 1). On every later hold for that person send `Customer:{ID}`. The admin "View in SUMIT"
link (survey §5) is a related but separate owner decision.

## Changes

### 1. Migration (schema) — a SEPARATE server-only table (option 1), NOT a column on `profiles`

**Decision changed 2026-08-27 after the owner brought two options for review.** The earlier
draft used option 2 (keep the column on `profiles`, harden with column privileges). Option 1 —
a separate table with **no client grants at all** — is the right one here, for three
verified reasons, not preference:

1. **It is already this codebase's established pattern for exactly this class of data.** The
   live DB has 13 tables with zero `authenticated` grants (`console_call_pii`,
   `console_agent_secrets`, `call_attempts`, `sales_call_attempts`, `exchange_connections`, …).
   The recipe is written in our own migration for `console_call_pii`:
   `enable row level security` + **zero policies** + `revoke all … from anon, authenticated` =
   service-role only. Reads go through the admin client only
   (`console-calls.ts:994`, `console-agent-provisioning.ts:183`). Reusing a proven house pattern
   beats introducing a second, subtler mechanism.
2. **Column privileges on `profiles` are fragile in a way a closed table is not.** Every
   future `GRANT UPDATE ON profiles` (a new feature, a `supabase db reset`, a well-meaning
   migration) silently re-opens the column, and nothing fails loudly. A table that has never
   been granted to `authenticated` cannot be accidentally re-opened by touching `profiles`.
   The column-privilege approach also imposes a permanent tax on every `profiles` query
   (`select *` / `returning *` break for `authenticated` — Supabase's own caveat) that a
   separate table avoids entirely.
3. **It matches how `campaigns` already keeps `card_token_ref`** — not user-updatable at all
   (RLS: SELECT-only policy `camp_org_select`, no UPDATE/INSERT policy). Billing identifiers
   in this app are server-owned by convention; the new table makes that explicit.

Option 2 remains a valid Supabase-documented technique and its privilege analysis (kept in
git history) was correct — it is simply the weaker fit here.

**Verified against Supabase's own recommendation, not just this repo's habit (2026-08-27,
owner asked "did you verify this is the recommended way?"):** the official *Hardening the
Data API* guide frames the principle as separation, not column-locking:
> "Internal tables and helper functions remain in schemas that aren't exposed."
> "…preventing unintended exposure by controlling which schemas are accessible through the
> API, rather than trying to secure sensitive columns within exposed tables."
And Supabase's own migrations use the exact recipe this plan copies (`revoke all … from anon,
authenticated` + RLS): *"PostgREST only exposes tables that at least one role has any privilege
on"* — a table with no client grant is invisible to the API, not merely restricted.

**One step further exists and is deliberately NOT taken here:** the guide's fullest form is a
separate **schema** (`private.`) hidden from the API by default. This repo's 13 server-only
tables all live in `public` + `revoke all` instead. Both are documented-correct; moving to
`private.` would be a repo-wide consistency decision touching those 13 tables, i.e. a separate
hardening item, not this plan. `sumit_customers` follows the existing house pattern.

`supabase migration new add_sumit_customers`
```sql
-- Per-person canonical SUMIT customer anchor. SERVER-ONLY: written on first successful
-- charge/hold, read on every later charge to send Customer:{ID} (no SearchMode). Keyed 1:1
-- to the paying account. Same recipe as console_call_pii (RLS on, zero policies, zero client
-- grants) — the browser can neither read nor write it, so the "user points their account at
-- another SUMIT customer" attack is impossible by construction, not by a grant that could
-- drift.
create table public.sumit_customers (
  user_id            uuid        primary key references auth.users(id) on delete cascade,
  sumit_customer_id  bigint      not null,
  first_seen_campaign_id uuid    references public.campaigns(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.sumit_customers is
  'SUMIT Customer number per paying account (Data.CustomerID). Server-only; send as Customer:{ID} on every charge once set. Never overwritten by a differing later value — alert instead.';
comment on column public.sumit_customers.first_seen_campaign_id is
  'The hold/charge whose response first produced this id — audit anchor for reconciliation.';

create trigger trg_sumit_customers_updated
  before update on public.sumit_customers
  for each row execute function public.set_updated_at();

alter table public.sumit_customers enable row level security;
-- RLS on with ZERO policies + zero client grants: service-role only (house pattern).
revoke all on table public.sumit_customers from anon, authenticated;

-- Per-hold reconciliation snapshot on campaigns, UNCHANGED from the original plan: what THIS
-- hold returned. campaigns is already not user-updatable (SELECT-only RLS), so no new
-- privilege work is needed here.
alter table public.campaigns
  add column if not exists sumit_customer_id       bigint,
  add column if not exists sumit_payment_method_id bigint;
comment on column public.campaigns.sumit_customer_id is
  'SUMIT Customer number returned by THIS hold (Data.CustomerID). Reconciliation snapshot — the canonical per-person anchor is sumit_customers.sumit_customer_id.';
```
- Additive; no backfill required (existing brit row can be seeded manually with
  `2127277236` / `2127277247` if desired — separate one-off, not in this migration).
- **No change to `profiles` at all.** Its existing `own_profile_write` policy, grants, and the
  `updateProfile()` upsert are untouched — the entire privilege-impact question from the
  option-2 draft disappears, because nothing user-editable is modified.
- The only client that may touch `sumit_customers` is `createAdminClient()` (service_role);
  only the hold path (`authorize/route.ts`) reads it, server-side. Reads must name columns
  explicitly (house style) — never `select('*')`.
- **Verification gate before merge (not optional):** an integration test through PostgREST
  as `authenticated` asserting both `select` and `update` on `sumit_customers` return
  `42501`, and a service-role write succeeds — proving the closure end-to-end, not just at the
  SQL layer. (Option 2's rolled-back SQL tests established the *Postgres* behaviour; this
  test covers the API layer the browser actually uses.)
- Default-ACL note (still true, still out of scope): Supabase's default ACL grants
  `authenticated` full CRUD on every NEW public table. The explicit `revoke all` above is what
  neutralises it for this table — the same reason every server-only table in this repo
  carries that line. A repo-wide `alter default privileges … revoke` is a separate hardening
  item.
### 2. Regenerate types
`supabase gen types typescript --linked > src/lib/supabase/types.ts`
(NEVER hand-edit — per `no-hand-editing-generated-artifacts`.)

### 3. `src/lib/sumit/authorize.ts`
- Extend `Resp.Data` type: add `CustomerID?: number | null` and
  `Payment.PaymentMethod.ID?: number | null` (already partially typed).
- Extend `SumitAuthorizeResult` (line 18): add `sumitCustomerId: number | null`,
  `sumitPaymentMethodId: number | null`.
- In the return block (line ~151): read `json.Data?.CustomerID ?? null` and
  `payment?.PaymentMethod?.ID ?? null` via the existing `toInt` helper.
- **Also read `json.Data?.DocumentID ?? null` and `json.Data?.DocumentNumber ?? null`** — the
  Order document the hold now creates (below). Add `orderDocumentId: number | null` and
  `orderDocumentNumber: number | null` to `SumitAuthorizeResult`. Live shape (owner's 27.8
  hold at 05:09): `Data.DocumentID: 2297030745`, `Data.DocumentNumber: 1001`,
  `Data.Payment.ID: 0` (still 0 on a hold — the DocumentID is the usable key, not Payment.ID).
  **Matching rule for reconciliation: join on `DocumentID` only.** `PaymentMethod.ID` and
  `CustomerID` repeat across every hold on the same card/person (verified: 4 holds on 27.8
  share both), and timestamps drift; `DocumentID` is globally unique in SUMIT. Also note
  `AuthNumber` comes back with a LEADING SPACE sometimes (`" 042456"`, `" 031237"` in our DB)
  — `.trim()` before any comparison.

**Three further hold-request changes (owner-instructed 2026-08-27, from live CRM evidence):**

- **Create the Order document on the hold** — flip `PreventDocumentCreation: true → false`.
  Owner ruling: the Order is the audit reference ("אסמכתא") for the hold and is required.
  Evidence: every hold our code placed (13 of them, 25.6→27.8) has `Billing_OrderDocument =
  null` in SUMIT's CRM, while the three the owner placed by hand on 27.8 each got
  `הזמנה / 1000..1002` — SUMIT's documented normal behaviour for `AutoCapture:false` ("Order
  documents will be issued instead of invoices/receipts"). We were suppressing it.
  **`VATRate` interaction — SETTLED by the owner's live request (27.8, hold at 05:50, Order
  `הזמנה / 1002` created, `ValidPayment:true`).** The hold currently sends an explicit
  `VATRate` and survives only *because* no document is created
  ([[sumit-charge-verified-behavior]] line 13). The capture had to **omit** `VATRate` for its
  document to balance (line 17). The owner's working hold body sent **no `VATRate` and no
  `VATIncluded`** with `PreventDocumentCreation:false` → Order created. So the rule is
  confirmed for holds too: **document ⇒ omit `VATRate`**. Exact diff to `authorize.ts`:
  | field | today | change to |
  |---|---|---|
  | `VATRate` | `parseFloat(p.vatRate)` | **remove** |
  | `VATIncluded` | `true` | remove (owner's body had neither; harmless either way) |
  | `PreventDocumentCreation` | `true` | **`false`** |
  | `Items[].Total` | absent | add (= `UnitPrice`; owner's body had it) |
  | `SendDocumentByEmail` | `false` | keep `false` — the Order is an internal אסמכתא, not customer mail |
  | `AuthorizeAmount` | `parseFloat(p.ceiling)` | **keep, but note:** owner's body omitted it and SUMIT took the hold amount from the item `Total`. Ours sets both to `ceiling` so they agree today; if they ever diverge (Order for full amount, hold for less) the precedence is unverified — ask SUMIT, non-blocking. |
  Verification before merge: one ₪1 live hold via the app path with the new body → assert
  `Data.DocumentID` non-null AND `ValidPayment:true`, then confirm in CRM folder 1076735289
  the entity has `Billing_OrderDocument` set and `Billing_Status = 1`.
- **Send `Name` on the hold** — `authorize.ts` sends only `EmailAddress` + `ExternalIdentifier`,
  so every hold-created customer appears in SUMIT as **"כרטיס ללא שם"** until (if ever)
  captured. Evidence: customer `2127277236` (the brit hold) has no `Customers_FullName`.
  (Customer `2078920344` DOES have name/phone/company — but only because the owner filled
  them in by hand in the SUMIT panel on 27.8, not from any API call of ours. No code path
  populates them today.) Use the same `profiles.full_name → email` fallback chain
  `close-charge.ts` already uses for the receipt.
- **Send `Phone` on the hold** — `profiles.phone` exists and is unused here; SUMIT's customer
  record has `Customers_Phone`. Same read as the name.

### 4. `src/app/api/campaigns/[id]/authorize/route.ts`
- Pass `sumitCustomerId` / `sumitPaymentMethodId` / `orderDocumentId` / `orderDocumentNumber`
  from `holdResult` into `recordCampaignHold`.
- Read the payer's `profiles.full_name` + `profiles.phone` (admin client, same fallback chain
  as `close-charge.ts`) and pass them to `authorizeHoldSumit` for the `Customer` block (§3).
- Read `sumit_customers.sumit_customer_id` for `user.id` (§5a) and pass it as
  `sumitCustomerId` so the hold sends `Customer:{ID}` when present.

### 5. `src/lib/data/campaigns.ts` — `recordCampaignHold` (line 377)
- Add `sumitCustomerId`, `sumitPaymentMethodId`, `orderDocumentId`, `orderDocumentNumber`
  (all `number | null`) to the `hold` arg.
- Write `sumit_customer_id` / `sumit_payment_method_id` (new columns) AND
  `sumit_order_document_id` (existing column, currently never written — verified 27.8) in the
  `.update({...})`. This is the per-hold snapshot on `campaigns`.

### 5a. NEW — `src/lib/data/sumit-customers.ts` — the per-person anchor write + read
This is the step the earlier draft never spelled out: the campaign snapshot alone does nothing
for dedup. Two server-only functions, both via `createAdminClient()` (service_role — the only
role with any grant on `sumit_customers`):
- `getSumitCustomerId(userId): Promise<number | null>` — read; explicit column list, never
  `select('*')`.
- `recordSumitCustomerId({ userId, sumitCustomerId, campaignId })` — **insert-if-absent
  only**. If a row exists with the SAME id → no-op. If a row exists with a DIFFERENT id →
  do NOT overwrite; `sendSlackAlert` (category `errors`, ids only) — SUMIT returned a customer
  other than the one we sent `Customer:{ID}` for, which should be impossible. Use an
  `insert … on conflict (user_id) do nothing` then compare, so two concurrent first charges
  cannot race into two different ids.
- Call sites: `authorize/route.ts` (after a successful hold) and `close-charge.ts` (after a
  successful capture, for accounts whose first SUMIT contact was a capture without a hold).
- **Only `authorize.ts` (the HOLD) takes the optional `sumitCustomerId`** — when present it
  sends `Customer:{ ID }` and **omits** `SearchMode`; when absent it sends the one-time bridge
  (`SearchMode` + email). This is the ONLY place the "existing customer or new?" decision is
  made, because the hold is the first SUMIT contact for the event.
- **`capture.ts` and `creditHeldCardSumit` are NOT changed.** The capture charges the hold's
  saved `CreditCard_Token`, and SUMIT attaches that payment method — and the receipt — to the
  customer the token was saved under at hold time (SUMIT doc + live-verified 2026-06-29). There
  is nothing to look up or dedup at capture; the customer is already fixed by the token.
  Touching the capture body would also risk the hard-won verified request shape
  ([[sumit-charge-verified-behavior]]: no `VATRate`, no `CreditCardAuthNumber`) for zero
  benefit. (Optional §6 below — `Customer:{ID}` on capture as belt-and-braces — stays optional
  and low priority for exactly this reason.)

### 5b. `src/lib/data/close-charge.ts` — charge-≤-hold guard (belt-and-suspenders)
SUMIT rule: a J5 hold authorizes only up to its amount — you cannot charge MORE than the held
frame (to charge more you must place a FRESH J5 at the higher amount, then J4). Our design
already guarantees `charge ≤ hold` structurally via the recipient-freeze SAFETY INVARIANT
(`prepareCampaignHold`, campaigns.ts:535: `reached ⊆ frozen set ⇒ charge ≤ frozenSetSize×price ≤
hold`; note `max_charge_ceiling = full×price` MAY exceed the hold, but the actual charge is bounded
by the frozen set, not the ceiling). Charge < hold is fine (verified: partial J4 on token).

Add an explicit assertion so the invariant is ENFORCED at charge time, not merely relied upon:
- Before calling `captureHeldCardSumit`, if `amount > campaign.auth_amount` → do NOT charge.
  Route to `charge_review` (`markCampaignChargeOutcome`) + ops alert. Never charge over the held
  frame.
- On such a breach the correct recovery is a FRESH J5 at the higher amount then J4 (SUMIT's
  prescribed flow) — surface it for admin action; do not auto-charge-over-hold.
- This backstops the recipient-freeze P0 ([[campaign-recipient-freeze-p0]] — a guest added after
  the freeze): if the freeze invariant were ever violated so `reached` exceeded the frozen set,
  this guard prevents charging above what was authorized.

### 6. (Optional, follow-up) `src/lib/sumit/capture.ts`
- When `sumit_customer_id` is present, send `Customer:{ ID: sumitCustomerId }` (canonical payer)
  alongside the token. Keep the token path as the primary/fallback (it is verified working and
  charges a fresh J4). Guard behind presence so pre-fix holds still charge via token only.
- Low priority — do NOT change the working charge config (AutoCapture:true, OMIT VATRate, OMIT
  CreditCardAuthNumber) per `sumit-charge-verified-behavior`.

## Risks

- **Type regen churn:** `gen types` may reorder/rewrite unrelated bits of `types.ts`. Review the
  diff to ensure only the two new columns changed.
- **Response shape assumption:** `Data.CustomerID` confirmed present in the live J5 response
  (brit) + swagger (`Payments_Charge_Response.CustomerID` "Customer number"). Read defensively
  (`?? null`) — a null must NOT fail the hold (it's additive metadata, not required to charge).
- **PII scope:** `sumit_customer_id` / `sumit_payment_method_id` are opaque SUMIT ids, not PII —
  fine to store/log as reconciliation anchors (unlike CitizenID/token).

## Verification

1. `npm run lint` · `npx tsc --noEmit` · `npm run build --webpack` (all must pass).
2. Focused: `authorize.ts` adapter test (mock a J5 response incl. `Data.CustomerID` → assert it
   flows to `recordCampaignHold` AND `recordSumitCustomerId`); `recordSumitCustomerId` is
   insert-if-absent and alerts (never overwrites) on a differing id; a hold for a user WITH a
   stored id sends `Customer:{ID}` and NO `SearchMode`, a user WITHOUT one sends `SearchMode`.
3. Live J5 sanity via the app path (authed browser flow — `logActivity` needs cookies): one ₪1
   hold with the new body → assert `ValidPayment:true`, `Data.DocumentID` non-null,
   `Data.CustomerID` non-null; then `listentities` on CRM folder 1076735289 and confirm the
   entity whose `Billing_OrderDocument.ID` = that `DocumentID` has `Billing_Status = 1` and a
   `Billing_Customer` carrying the sent `Name`/`Phone`. Then place a SECOND hold as the same
   user → assert `Billing_Customer.ID` is the SAME (dedup works) and no new customer appeared.
4. Confirm the token-based charge path is unchanged (no diff to `capture.ts` body if §6 deferred).
5. Regression: the `Order` document must NOT be emailed (`SendDocumentByEmail:false` on the
   hold) and must NOT change what the capture produces (still a receipt, still emailed).

## Table decision (investigated 2026-07-14 via 2 subagents)

**No dedicated SUMIT payment/charge/hold/transaction/audit table exists** in any schema —
nothing to reuse (`payment_events` confirmed absent; charge/hold data lives ONLY as columns on
`campaigns`, overwritten in place). Closest precedents `billed_results` (per-contact billing
evidence) and `activity_log` (generic jsonb audit) do NOT model SUMIT transactions.

**Cardinality is NOT 1:1.** Holds and charges are retryable at the attempt level —
`lockCampaignForHold`/`lockCampaignForCharge` (campaigns.ts:362, :603) match
`null`/`*_failed`/`*_review`; `authorize/route.ts:162` mints a **fresh `authRef` UUID per
attempt**; `markCampaignHoldFailed`/`markCampaignChargeOutcome` only flip the status enum. So the
`campaigns` columns keep only the LAST attempt — a declined attempt preceding a successful charge
is not reconstructable from the DB (only Slack/logs). This is a standing **audit gap** vs
CLAUDE.md's "preserve auditability for payment state changes".

**Decision → two phases, NOT either/or:**
- **Phase A (this plan):** the `sumit_customers` anchor table + the 2 snapshot columns on
  `campaigns` (same "current authorized state" semantics as `card_token_ref`/`card_exp_*`).
  Unblocks dedup on the next hold + stuck-hold reconciliation. Does NOT fix the audit gap.
- **Phase B (separate plan + approval — tracked, not blocking):** append-only `payment_events`
  (`campaign_id, kind hold|charge, attempt_ref, outcome authorized|declined|review|charged,
  sumit_customer_id, sumit_payment_method_id, amount, raw_response REDACTED (no PAN/CVV/token/
  CitizenID), created_at`), written ALONGSIDE the campaigns columns (which stay as the fast
  "current state" cache). Closes the audit gap without disturbing the idempotency-lock logic.
  Cross-cutting (new table + RLS + every write call-site) → own written plan + approval.

## Charge-over-hold flow (designed 2026-07-14 via code-architect subagent)

SUMIT: a J5 authorizes only up to its amount; charging MORE needs a FRESH J5 at the higher
amount, then J4. Below is the flow for when `final_amount > auth_amount`.

### Breach analysis (can it happen?)
- **Bounded today, not impossible.** `funded_cap = least(max_contacts, floor(auth_amount/price))`
  (migration `20260712115459_billing_exposure_funded_cap.sql:72-80`) keeps `accrued ≤ auth_amount`
  when the exposure gate is on; the freeze membership gate caps it when off. `price_per_reached`
  is locked post-approval; `max_charge_ceiling` only (re)computed inside `prepareCampaignHold`.
  `billed_results.manual_adjustment` is currently DEAD (written/read nowhere) — a future admin
  adjustment tool summing it into `accrued` would open a live breach path (flag for that feature).
- **The live gap:** `close-charge.ts:96` caps at `min(accrued, ceiling)` — `ceiling` (full×price)
  is NOT the hold. When `covered < full` the hold `auth_amount < ceiling`, so if the cap machinery
  is ever bypassed/misconfigured, close-charge would charge up to `ceiling > auth_amount`.
  `CHARGE_COLUMNS` (campaigns.ts:583) doesn't even select `auth_amount` → guard uncodable until fixed.

### Consent distinction (§14ג — critical)
`max_charge_ceiling` is what the customer SIGNED (rendered into the agreement PDF, `agreements.ts:159`).
`auth_amount` (J5) is a security instrument sized to `covered`, legitimately ≤ ceiling.
- **Case (a): `auth_amount < amount ≤ ceiling`** — WITHIN the signed contract; customer already
  consented. Only a technical SUMIT gap → fresh J5 then J4. **This is the only case the flow handles.**
- **Case (b): `amount > ceiling`** — OUTSIDE consent = §14ג violation. Already structurally
  impossible (`min(accrued, ceiling)` caps it). Add a defensive assert; if ever detected →
  hard-stop, NO re-hold, escalate as data-integrity incident.

### Decision: (A) exception → admin-triggered re-hold. NOT auto.
- **Not (B) auto re-hold — but for a DIFFERENT reason than the July draft gave.** The July text
  claimed a fresh J5 needs a browser `SingleUseToken` and that no headless path was verified.
  **That was corrected 2026-07-29** ([[sumit-charge-verified-behavior]]): SUMIT support confirmed
  a fresh, higher J5 accepts the SAVED token server-side, so headless re-hold is FEASIBLE. The
  reasons it stays admin-triggered rather than automatic are: (i) auto-raising a customer's
  authorization silently mid-charge is poor §14ג practice; and (ii) **releasing a J5 hold is
  NOT possible via the API — it is a SUMIT-dashboard-only operation** (owner-confirmed
  2026-08-27; verified against the spec: no path/field/enum voids an authorization —
  `TransactionType`'s only non-debit value is `Credit (51)`, which refunds a *charge*, not a
  hold). So a re-hold placed while the original hold is still open STACKS on the card until
  the issuer expires it; one stuck hold already exists ([[stuck-j5-hold-bac77347-cleanup]]).
  **Therefore the re-hold flow must include a manual dashboard step: an admin releases the
  prior hold in SUMIT, THEN triggers the headless re-hold.** It cannot be fully automated,
  and no "hold-release code" should be attempted — an earlier draft of this section said
  "build release first", which was wrong.

  ⚠️ **Do not confuse the two operations** (they were conflated once tonight):
  | | applies to | how |
  |---|---|---|
  | **Release / cancel a hold** | a J5 authorization that was NEVER charged | SUMIT dashboard only — no API |
  | **Refund / credit** | a charge that WAS captured | API: `creditHeldCardSumit` (`SupportCredit:true`, negative amount) |
- **Not (C) charge-up-to-hold + flag:** permanently under-collects owed revenue with no recovery.
- **(A) matches KALFA's existing `hold_review`/`charge_review` retry-tolerant, admin-gated pattern.**

### Flow / state machine
New `charge_status` value **`hold_insufficient`** (vocabulary at campaigns.ts:331).
```
close-charge: amount = min(accrued,ceiling) − credits
  amount ≤ 0            → nothing_to_charge
  amount ≤ auth_amount  → captureHeldCardSumit (J4) → charged / charge_failed / charge_review
  amount > auth_amount  → hold_insufficient   ← NEW GUARD, terminal-pending-admin (NO charge)
        │
        ▼  admin reviews (blocked-money alert), triggers "request re-authorization"
        │  → step 1 (MANUAL, SUMIT dashboard): admin releases the prior J5 hold — there is
        │     no API for this (see Decision). step 2 (headless, our code): admin triggers a
        │     fresh J5 at the new amount on the saved token (SUMIT-confirmed 14.07; no
        │     customer, no browser). Then update auth_amount, keep prior_auth_amount for audit
        ▼
  charge_status reset to null → re-enter close-charge → now amount ≤ auth_amount → J4 → charged
```

### Code touch-points
- `campaigns.ts:583` — add `auth_amount` to `CHARGE_COLUMNS` / `CampaignChargeState` (**prerequisite**).
- `close-charge.ts` (~after the `amount ≤ 0` check, before `lockCampaignForCharge`) — the guard:
  `if (amount > (campaign.auth_amount ?? 0)) → markCampaignChargeOutcome(id,'hold_insufficient')
   + error alert (category campaign_billing) + return {outcome:'hold_insufficient', amount}`.
- `close-charge.ts:25-34` `CloseChargeOutcome.outcome` union + `campaigns.ts:646` `markCampaignChargeOutcome`
  outcome union → add `'hold_insufficient'` (tsc will flag exhaustive consumers; audit if/else at
  `close-charge` route + tests `src/app/api/campaigns/[id]/close-charge/route.test.ts`).
- `closeCampaignAndCharge` must treat `hold_insufficient` as **terminal-pending-admin** (return
  immediately, do NOT re-lock) so a bare retry can't loop; only the reauth route resets to `null`.
- **Re-hold recovery (bigger — own sub-phase, A2):** an ADMIN-triggered headless re-hold on
  the saved token (`PaymentMethod:{CreditCard_Token…}` + `AutoCapture:false` +
  `AuthorizeAmount`), after the manual dashboard release. No owner-facing `/reauth` screen and
  no owner email — the July "customer-present" premise was corrected (see Decision). Extend
  `recordCampaignHold` to keep `prior_auth_amount`.
- Defensive assert `amount ≤ ceiling` (case b fail-closed).

### Open verifications BEFORE building the recovery route
1. ~~Confirm with SUMIT whether a J5 can be placed server-side from a stored token~~ —
   **ANSWERED 14.07.2026 (SUMIT support): YES.** Re-hold can be admin-triggered-headless. The
   open item this exposed is NOT buildable: releasing the prior hold is dashboard-only (no
   API — owner-confirmed 2026-08-27). So the recovery flow includes a **manual release step
   in SUMIT before the re-hold**. No code-side gate around it (owner ruling 2026-08-27).
2. `campaigns.auth_expires_at` exists but is never written/read — populate at hold time + check
   staleness (a stale hold is a distinct failure mode from "hold too small").

### Verification (tests)
- `close-charge.test.ts`: accrued > mocked `auth_amount` but ≤ `ceiling` → assert
  `outcome:'hold_insufficient'`, `markCampaignChargeOutcome('hold_insufficient')`,
  `captureHeldCardSumit` NEVER called. Plus a case that `amount ≤ ceiling` cap still holds (case b).
- lint / tsc / build (union widening forces consumer updates).

### Phasing
- **A1 (fail-closed guard, small, ship first):** add `auth_amount` to CHARGE_COLUMNS + the guard +
  `hold_insufficient` state + alert + tests. Pure protection — never charges over the frame.
- **A2 (recovery, bigger, own approval):** admin-triggered headless re-hold on the saved token,
  preceded by a MANUAL release of the prior hold in the SUMIT dashboard (no API for release —
  open verification #1); `auth_expires_at` wired (#2). No owner-facing reauth screen is needed — the July "customer-present" premise
  was corrected.

## Out of scope
- Changing the charge model (fresh J4 on saved token stays).
- Building a J5 "status" surface in THIS plan. (One now exists — the CRM folder listing, see
  the Problem section — but wiring it into admin UI / reconciliation sweeps is its own scope.
  This plan only persists the key that makes it possible: `sumit_order_document_id`.)
- Cleaning up the 14 holds currently open (`Billing_Status = 1`) in SUMIT's CRM — a
  dashboard action the owner decides on; not code.
- Recurring/standing-order retry behavior.
- Phase B (`payment_events` audit table) — its own plan; do not bundle here.
