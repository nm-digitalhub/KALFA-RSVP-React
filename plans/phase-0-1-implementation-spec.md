# Phase 0 + Phase 1 — Full implementation spec (KALFA billing back-half)

> Implementation grain: every file (extend/create), function signature, migration DDL, RPC SQL, test, and verification gate. SUMIT-docs-grounded exact-charge computation included. All [מרחיב]=extend existing / [יוצר]=create new — verified against the live code (no duplicates).

---

## 0. EXACT FINAL-CHARGE COMPUTATION (the "bypass", grounded in the SUMIT swagger)

**The agreed terms:** charge = (unique reached contacts) × `price_per_reached`, **VAT-inclusive**, capped at the approved `max_charge_ceiling`. One-time per event, settled at close.

**SUMIT mechanics (swagger-verified):**
- `Item.UnitPrice` is "the single unit price in payment currency — Required". The CHARGED amount = Σ(Quantity × UnitPrice) of items.
- `VATIncluded:true` ⇒ the UnitPrice **already includes** VAT (VAT is NOT added on top).
- `VATRate` is "Document VAT Rate … relevant for **items only**" ⇒ it only affects the document's VAT-line **breakdown**, NOT the charged total. (Empirically, sending an explicit `VATRate` on a saved-token charge unbalances the document → omit it.)

**Settled decisions (rulings):** D1=**No** (ceiling governs, hold is security) · A1=**price is VAT-inclusive (gross)** · D2=bill while paused (within window+ceiling) · D3=call reached = DTMF/ASR‑human, not voicemail, admin‑config · D4=removal request **bills** (unless wrong‑number) · D5=credits **per‑campaign, gross** · D6=reopen admin‑only, default off.

**⇒ The exact, condition-faithful charge (per D1/A1/D5):**
```
locked_price[i] = campaign.price_per_reached at reach time   (VAT-INCLUSIVE/gross, frozen per row, §12/§18.15)
accrued         = Σ locked_price                              (campaign_billing_summary RPC, ALL control_status §16)
ceiling         = campaign.max_charge_ceiling = authorized_billable_count × price   (FULL approved count × price, §7 — D1=No)
                  // covered_contacts (≈min(full,300)) sizes the HOLD only, NOT the ceiling — never conflate.
credits         = Σ billing_credits.amount WHERE campaign_id = this   (gross, D5)
final           = max(0, round( min(accrued, ceiling) − credits , 2))  (§14, floored at 0)
SUMIT charge    = ONE Item { Quantity:1, UnitPrice: final }, VATIncluded:true, NO VATRate
                  → SUMIT charges EXACTLY `final` (gross). (already how capture.ts builds the body.)
```
So the charged total is **exact** by construction. The receipt's VAT-line uses the **company-default VAT** ⇒ **ACTION (verify): SUMIT company VAT must equal the agreed rate (18%)** so the receipt breakdown is correct (the TOTAL is already exact regardless). Confirm in the SUMIT company settings; if it isn't 18%, set it there (do NOT re-introduce `VATRate` on the capture).

### 0.x CROSS-CHANNEL DEDUP INVARIANT — one charge per contact per event, across ALL channels (§2/§13/§18.3-4)
**Binding rule:** the same person confirming via MORE THAN ONE channel (WhatsApp reply + AI-call interaction + the RSVP self-service link) is **ONE charge**, never two — enforced at the DATA level, not the UI.
- **Single billing entry point:** EVERY reach signal — WhatsApp inbound, call human-interaction, AND the RSVP-link confirmation (Phase 4) — records through the SAME `try_record_billed_result(event_id, contact_id, …)` RPC. No channel may write a billable row by any other path.
- **Keyed on CONTACT, not guest/channel:** `billed_results UNIQUE(event_id, contact_id)` (§13) makes the 2nd/3rd channel's RPC return `already_billed` (no row). WhatsApp-then-link, link-then-call, two-guests-same-phone, dual-channel → exactly one row; the winning row keeps the first channel's `evidence_source`.
- **RSVP-link requirement (Phase 4):** `r/[token]` resolves guest → its `contact_id` and routes a confirmation through `try_record_billed_result` (NOT a separate write) → dedups against WhatsApp/call by construction. Multi-guest-same-phone collapses to one contact → one charge.
- **DECISION D7 (needs a ruling):** is a self-service RSVP-link confirmation itself a **billable reach**, or only an RSVP-OUTCOME update (not billable, since it isn't outreach-driven)? Either way the dedup prevents double-billing; D7 only decides whether a *link-only* confirmation (no WhatsApp/call) creates a charge at all.

Rounding: `computeCeiling` already `round()`s; `locked_price` is stored per row as the campaign price; `accrued`/`final` are plain numeric sums in Postgres (no float drift) → string at the SUMIT boundary. Spec: `campaign_billing_summary.accrued` = `sum(locked_price)`; close-charge sends `final.toString()` (already does).

---

## Phase 0 — Correctness fixes (small; pre-go-live)

### 0.1 [מרחיב] Zero-bill guard — `billing.ts` + `close-charge.ts` (TOP RISK)
**Problem:** `getCampaignBillingSummary` returns `null` on ANY RPC error (`billing.ts:65`); close-charge maps `null → accrued 0 → nothing_to_charge` → permanently settles at ₪0. A transient RPC failure silently zero-bills.
**Fix:**
- `src/lib/data/billing.ts` — `getCampaignBillingSummary`: distinguish error from a real 0. Make it **throw** on RPC `error` (not return null); return a value only on success (a genuine 0-reached campaign returns `reached_count:0, accrued:0`).
- `src/lib/data/close-charge.ts` — wrap the summary read in try/catch: on throw → `markCampaignChargeOutcome(id,'charge_review')` + return `{outcome:'review', amount:0}`. Settle `nothing_to_charge` ONLY when the RPC succeeded AND `accrued===0 && reached_count===0`.
**Tests** (`close-charge.test.ts`): add "summary RPC error → review, NOT nothing_to_charge"; keep "genuine 0 reached → nothing_to_charge".

### 0.2 [מרחיב] Hold success asymmetry — `src/lib/sumit/authorize.ts`
Tighten the hold-accept to `payment?.ValidPayment === true` (today `!== false`, so `undefined` passes). An ambiguous hold → `SumitNetworkError` → `hold_review`, never silent-authorized. **Test** (`authorize.test.ts`): `ValidPayment:undefined` + Status 0 → throws (review).

### 0.3 [מרחיב] Orphaned-contact prune (hygiene; root fix is Phase 2 set-source)
- `src/lib/data/guests.ts` — `deleteGuest`: after deleting the guest, delete its `contacts` row **iff** no other guest references it (`not exists (select 1 from guests where contact_id = …)`), within the same `requireOwnedEvent` scope, service-role.
- `src/lib/data/contacts.ts` — `linkGuestContact`: on a phone change that repoints `guests.contact_id`, prune the previous contact iff now unreferenced.
**Tests** (`guests.test.ts`/`contacts.test.ts`): delete-last-guest-of-phone prunes contact; shared-phone keeps it; phone-change prunes old.
> NOTE (from audit #10): an orphaned consented contact CAN be reached+billed (`listSendableContacts`/`resolveInboundContact` key on contact_id, no guest join). Phase 2 closes this at the root by sourcing the authorized set from current-guest contacts; 0.3 is defense-in-depth.

### 0.4 [מרחיב] Dashboard correctness — `src/app/(customer)/app/page.tsx` (+ `events.ts`)
- Counts ("סך האירועים"/"פעילים") from a real COUNT, not `listEvents()`'s default `limit=20`. Add `countEvents()` / `countActiveEvents()` to `events.ts` ([מרחיב]) or use a head-count query.
- `event_date` → `.slice(0,10)` (timestamptz, per `[[events-event-date-timestamptz]]`).
- Recent-event rows → link `/app/events/${event.id}` (today `/app/events`).
**Test:** none required (UI); covered by build.

### 0.5 [מרחיב] Credit subtraction in the final charge — `close-charge.ts` (G1 / §14 / D5)
Today close-charge never subtracts `billing_credits` (§14). Add: read `credits = Σ billing_credits.amount WHERE campaign_id = <this>` (gross, D5; new helper in `billing.ts` or `close-charge.ts`), compute `final = max(0, round(min(accrued,ceiling) − credits, 2))`, and move the `final ≤ 0 → nothing_to_charge` short-circuit to AFTER the subtraction. Event-level credits (null campaign_id) are NOT applied here (apply to the event account / next campaign). **Test** (`close-charge.test.ts`): credits reduce the charge; credits ≥ amount → `nothing_to_charge` (no SUMIT call). **G4:** round `final` to agorot before `.toFixed(2)` for the SUMIT `UnitPrice` string.

---

## Phase 1 — Back-half migration (make the money loop runnable)

### 1.1 [יוצר] Migration `supabase/migrations/202606290028_billing_backhalf.sql`
Author from scratch (these objects exist in NO migration on any ref — the "pending migration" comments were never realized). Additive + guarded.

**a. app_settings flags + WhatsApp config** (gates are fail-closed by default):
```sql
alter table public.app_settings add column if not exists outreach_enabled boolean not null default false;
alter table public.app_settings add column if not exists close_charge_enabled boolean not null default false;
alter table public.app_settings add column if not exists whatsapp_phone_number_id text;
alter table public.app_settings add column if not exists whatsapp_access_token text;   -- secret
alter table public.app_settings add column if not exists whatsapp_app_secret text;     -- secret (HMAC verify)
alter table public.app_settings add column if not exists whatsapp_verify_token text;   -- webhook verify
```
**b. contacts consent:**
```sql
alter table public.contacts add column if not exists whatsapp_consent_at timestamptz;
```
**c. RPC `try_record_billed_result`** (SECURITY DEFINER; cap+window+dedup in ONE locked txn) — outcome enum `billed|already_billed|ceiling_reached|not_active|before_window|closed_window|removal_requested|no_campaign`:
```sql
create or replace function public.try_record_billed_result(
  p_event uuid, p_campaign uuid, p_contact uuid, p_channel campaign_channel,
  p_attempt text, p_evidence text, p_provider_ref text
) returns text language plpgsql security definer set search_path=public as $$
declare v_status text; v_price numeric; v_max int; v_start timestamptz; v_close timestamptz; v_count int; v_removed boolean;
begin
  select status::text, price_per_reached, max_contacts, start_at, close_at
    into v_status, v_price, v_max, v_start, v_close
    from campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v_status not in ('active','paused') then return 'not_active'; end if;  -- D2: paused still bills inbound
  if v_start is not null and now() < v_start then return 'before_window'; end if;
  if v_close is not null and now() > v_close then return 'closed_window'; end if;
  select removal_requested into v_removed from contacts where id=p_contact;
  if coalesce(v_removed,false) then return 'removal_requested'; end if;
  select count(*) into v_count from billed_results where campaign_id=p_campaign;
  if v_count >= v_max then return 'ceiling_reached'; end if;
  -- Phase 2 hook: AND p_contact in (select contact_id from campaign_authorized_contacts where campaign_id=p_campaign)
  insert into billed_results(event_id,campaign_id,contact_id,channel,attempt_id,locked_price,evidence_source,provider_ref)
    values (p_event,p_campaign,p_contact,p_channel,p_attempt,v_price,p_evidence,p_provider_ref)
    on conflict (event_id,contact_id) do nothing;
  if not found then return 'already_billed'; end if;
  return 'billed';
end; $$;
```
**d. RPC `campaign_billing_summary`** (exact accrued = Σ locked_price):
```sql
create or replace function public.campaign_billing_summary(p_campaign uuid)
returns table(reached_count int, accrued numeric, ceiling numeric, max_contacts int)
language sql security definer set search_path=public as $$
  select count(b.*)::int, coalesce(sum(b.locked_price),0), c.max_charge_ceiling, c.max_contacts
  from campaigns c left join billed_results b on b.campaign_id=c.id
  where c.id=p_campaign group by c.id;
$$;
grant execute on function public.try_record_billed_result(uuid,uuid,uuid,campaign_channel,text,text,text) to service_role;
grant execute on function public.campaign_billing_summary(uuid) to service_role;
```
> Verify exact column names/enum types (`campaign_channel`, `billed_results` cols, `campaigns.start_at/close_at`) by reading the live schema before applying. Apply via approval-gated run.

### 1.2 [מרחיב] Regenerate types + drop casts
After apply: regenerate `src/lib/supabase/types.ts`; then remove the `createAdminClient() as unknown as SupabaseClient` casts now that `billing.ts`/`contacts.ts`/`campaigns.ts` reference real columns/RPCs (the RPCs become typed). Re-run tsc.

### 1.3 [מרחיב] No new wiring needed
`billing.ts` (`recordReached`, `getCampaignBillingSummary`), `outreach.ts`, `outreach-config.ts`, `payments.ts` (`getOutreachEnabled`/`getCloseChargeEnabled`/`getWhatsAppConfig`) already CALL these — they just start returning real values. (The lifecycle UI that drives them is Phase 3.)
**D4 sequencing — the WhatsApp webhook ALREADY EXISTS** (`src/app/api/webhooks/whatsapp/route.ts:107` already calls `recordReached`); what's MISSING is removal handling (no `removal_requested=true` write anywhere). Make it an EXPLICIT task: an inbound that IS a removal request is still a reach → `recordReached` (bills) FIRST, then set `removal_requested=true` (for FUTURE outreach). The RPC's `removal_requested` guard thus blocks only contacts removed in a PRIOR interaction, never the reach that carries the removal. Wrong-number/not-the-invitee → no bill (op_status `wrong_number`).
> **0.1 edge (verify-billing):** `getCampaignBillingSummary` must throw ONLY on a real RPC `error` — a nonexistent campaign yields an EMPTY set (LEFT JOIN + group by), which `close-charge` already pre-validates via `getCampaignForCharge`; treat empty-set as benign, never as a reason to `review`.
> **Dispute-phase flag (verify-billing):** `campaign_billing_summary` sums ALL `billed_results` (no `control_status` filter, ignores `manual_adjustment`) — intentional for Phase 1, but accrued won't honor voids/credits-via-adjustment; revisit in the dispute/adjustment phase (§16).

### 1.4 Verification gates (Phase 0 + 1)
`npm run lint` · `npx tsc --noEmit` · `npm run build` (`next build --webpack`) · `npx vitest run` (extended: zero-bill-review, hold-asymmetry, contact-prune). Live-DB: `sb-query` confirms the 2 RPCs + 6 columns exist; a scripted call to each RPC returns the expected enum/shape. Everything stays **config-gated OFF** (`outreach_enabled`/`close_charge_enabled` default false) → no live charge until explicitly enabled.

---

## Extend / Create map (verified — no duplicates)
**[יוצר]** only: `202606290028_billing_backhalf.sql`. **[מרחיב]** everything else: `billing.ts`, `close-charge.ts`, `authorize.ts`, `guests.ts`, `contacts.ts`, `events.ts`, `app/page.tsx`, `supabase/types.ts`, the 3 test files. No new components/pages in Phase 0–1.

## Open product confirmations (do not block Phase 0–1)
- Confirm SUMIT company VAT = 18% (receipt breakdown).
- Phase 2+ (frozen-set, lifecycle UI, RSVP, orders) specced after the orders/RSVP decisions.
