# Area: Campaign & Orders (billing flows)
_Files read: 5 pages, 5 co-located components (`manage-client.tsx`, `agreement-sheet.tsx`, `sign-agreement-form.tsx`, `hold-form.tsx`, `payment-form.tsx`). Also read `src/components/forms.tsx`, `src/components/ui/sheet.tsx`, `src/components/app-shell.tsx` (DirectionProvider scope), `src/lib/constants.ts` (`ORDER_STATUS_LABELS`), `src/app/(customer)/app/events/[id]/guests/labels.ts` (`OP_STATUS_LABELS`/`REMOVAL_REQUESTED_LABEL`), and `src/lib/validation/campaigns.ts` for field validation. Noted but did not fully read: `src/app/(customer)/app/orders/page.test.ts` (test file, not a UI file) and `.../campaign/[campaignId]/agreement/route.ts` (a Route Handler, not a page — out of scope for briefs, listed for completeness). No `loading.tsx`/`error.tsx`/`not-found.tsx` exist in any of the five owned route folders._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/app/events/[id]/campaign/[campaignId]` | `.../campaign/[campaignId]/page.tsx` | Server | AppShell | Campaign lifecycle management board |
| `/app/events/[id]/campaign/[campaignId]` (client) | `.../campaign/[campaignId]/manage-client.tsx` | Client | — | Status board, billing stats, delivery breakdown, lifecycle action buttons |
| `/app/events/[id]/campaign/[campaignId]/approve` | `.../campaign/[campaignId]/approve/page.tsx` | Server | AppShell | Agreement summary + gate to signing |
| `/app/events/[id]/campaign/[campaignId]/approve` (sheet) | `.../approve/agreement-sheet.tsx` | Client | — | Full agreement text in a slide-in Sheet |
| `/app/events/[id]/campaign/[campaignId]/approve` (form) | `.../approve/sign-agreement-form.tsx` | Client | — | OTP request + signature pad + consent checkboxes |
| `/app/events/[id]/campaign/[campaignId]/payment` | `.../campaign/[campaignId]/payment/page.tsx` | Server | AppShell | Card-hold (J5) step, gated by campaign/event state + feature flags |
| `/app/events/[id]/campaign/[campaignId]/payment` (form) | `.../payment/hold-form.tsx` | Client | — | SUMIT card-tokenize form for the hold |
| `/app/orders` | `src/app/(customer)/app/orders/page.tsx` | Server | AppShell | List of the user's orders with pay CTA |
| `/app/orders/[id]/pay` | `.../orders/[id]/pay/page.tsx` | Server | AppShell | Order payment step, gated by order status + feature flags |
| `/app/orders/[id]/pay` (form) | `.../orders/[id]/pay/payment-form.tsx` | Client | — | SUMIT card-tokenize form for order payment (J4) |
| (not a page) `.../campaign/[campaignId]/agreement/route.ts` | Route Handler | — | — | Likely serves the agreement doc/PDF; out of scope (no UI) |

## 2. Design Briefs

### /app/events/[id]/campaign/[campaignId]
- **Route:** `/app/events/[id]/campaign/[campaignId]`
- **Page name:** ניהול קמפיין / Campaign management
- **Component type:** Server (page) + Client (`manage-client.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Owner-facing board for a campaign's billing summary, WhatsApp delivery/outcome breakdown, and lifecycle transitions (activate/pause/close/settle/send-gift-reminder).
- **Primary user goal:** See how much has accrued vs. the ceiling and take the next lifecycle action.
- **Main content sections:** Back link + title; status chip + final-charge line; 6-stat grid (price/contact, max contacts, ceiling, reached, accrued, balance); explanatory note on what isn't billed; optional WhatsApp delivery breakdown (message delivery bars + contact-outcome stat tiles); lifecycle action button row (with a past-event warning banner when relevant).
- **Actions:** Server Actions bound with `eventId`/`campaignId`: activate, pause, close (confirm), settle (confirm), send gift reminder (confirm). Each rendered conditionally by campaign status (`canActivate`/`canPause`/`canClose`/`canSettle`) and `isPast`.
- **Forms / fields:** No data-entry form — each lifecycle action is a single-button `<form>` (via `useActionState`) with no fields, just a submit + optional `window.confirm()` gate. — 
- **Tables / lists:** No table; stat tiles in a `grid` and delivery bars in a `grid lg:grid-cols-2`.
- **Status states:** Campaign status chip, one of `draft, pending_approval, approved, scheduled, active, paused, closed, awaiting_invoice, billed, paid, cancelled` (Hebrew labels in local `STATUS_LABELS`). `capture_status === 'authorized'` gates the settle action. Delivery breakdown shows message states `sent/delivered/read/failed` (via shared `deliveryStatusLabel`) and outcome states `reached_billed`/`wrong_number`/opt-out (`REMOVAL_REQUESTED_LABEL`), both from `@/app/(customer)/app/events/[id]/guests/labels`.
- **Empty / loading / error states:** No `loading.tsx`/`error.tsx`. Page-level: `getCampaignBillingSummary`/`getCampaignDeliveryBreakdown` failures are swallowed to `null` server-side (board shows zeros / hides the delivery section — never crashes). Delivery section has a deliberate empty state: hidden entirely until `delivery.totalContacts > 0`. Each action button shows its own `FormError`/`FormNotice` from `useActionState`.
- **Existing shared components used:** `shared`: `FormError`, `FormNotice` (`@/components/forms`); label helpers from the guests area (`OP_STATUS_LABELS`, `REMOVAL_REQUESTED_LABEL`, `deliveryStatusLabel`). No `ui` primitives used at all on this page.
- **Components that should be reused:** The status chip (`<span className="rounded-full border border-border px-3 py-1 text-sm font-semibold">`) is a hand-rolled badge — a shared Badge/status-chip primitive doesn't exist yet (per spec) but this is exactly the shape it should take. The `Stat` tile pattern duplicates a metric-card idiom seen elsewhere in the app (e.g. dashboard-style stat grids) — worth checking against other areas for a shared `StatCard`.
- **Components that should be extracted:** (1) `Stat` (local function, lines 61-68) — generic label/value tile, reusable beyond this page. (2) `ActionButton` (local function, lines 70-107) — a `useActionState`-wrapped confirm button; this exact shape (bound Server Action + `window.confirm` + `FormError`/`FormNotice`) is a strong candidate for a shared `ConfirmActionButton` given it's the primary lifecycle-control idiom on this page and likely elsewhere (admin ops). (3) `DeliveryBar` — a manual RTL-safe progress bar built from a plain `div` with `inlineSize`; no shared Progress primitive exists, this is a reasonable inline candidate to promote if repeated.
- **Mobile considerations:** Stat grid degrades `grid-cols-1` implicit → `sm:grid-cols-2` → `lg:grid-cols-4`, safe down to narrow viewports. Delivery breakdown grid is `grid gap-5 lg:grid-cols-2` (stacks on mobile, fine). Action button row is `flex flex-wrap gap-3` — buttons wrap, no fixed widths. No fixed pixel widths found anywhere in this file.
- **Desktop considerations:** 4-column stat grid and 2-column delivery grid use the available width well at `max-w-5xl` (AppShell content container); no desktop-specific enhancement needed.
- **RTL considerations:** All spacing/alignment classes are logical (`gap`, `justify-between`, `items-center`) — no physical `left/right`/`ml-/mr-` found. `DeliveryBar` uses `inlineSize` (a logical CSS property) rather than `width`, which is correct for RTL fill direction. No `dir` overrides needed (all content is Hebrew/numeric-neutral).
- **Design risks:** (1) No shared Badge component — every status chip in the app is presumably hand-rolled slightly differently (only this page's shape was verified here). (2) `ActionButton`'s `variant` prop only supports `default | primary | danger` — string-typed, not shared with the `Button` UI primitive's variant set (`default, outline, secondary, ghost, destructive, link`), so this bespoke button doesn't inherit any future Button styling changes. (3) `window.confirm()` is used for destructive/high-stakes confirmations (close, settle, send-gift) instead of a dialog — no Dialog/Modal primitive exists in the shared set (spec confirms), so this is a known gap, not a new one introduced here.
- **Recommended redesign scope:** Medium (extract `Stat`/`ActionButton` as shared components; introduce a real Badge and a confirm-Dialog once those primitives exist).

### /app/events/[id]/campaign/[campaignId]/approve
- **Route:** `/app/events/[id]/campaign/[campaignId]/approve`
- **Page name:** אישור וחתימה על ההסכם / Approve & sign agreement
- **Component type:** Server (page) + Client (`agreement-sheet.tsx`, `sign-agreement-form.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Show the campaign's key terms, let the owner read the full legal agreement, then sign it (OTP + signature) to move the campaign to `approved`.
- **Primary user goal:** Understand what they're agreeing to and sign it.
- **Main content sections:** Back link + title; explanatory paragraph; terms summary card (`dl` of price/ceiling/contacts/channels/window) with a "read full agreement" Sheet trigger; conditional: past-event warning, missing-phone warning, or the sign form. A distinct early-return branch renders when `campaign.status !== 'pending_approval'` (already approved / not eligible).
- **Actions:** Open agreement Sheet; send/resend OTP; submit signature+consents to sign; link to `/app/settings` if phone is missing; link to payment step once approved (from the non-`pending_approval` branch).
- **Forms / fields:**
  - OTP request form: no visible fields, just a resend/cooldown button (`requestSigningOtpAction`).
  - Sign form (`signAgreementAction`, `../../campaign-actions`):
    - `signature` (hidden input, populated from `SignaturePad` canvas as a `data:image/…` PNG) — server: must start with `data:image/` → "יש לחתום בתיבת החתימה".
    - `otp_code` — `dir="ltr"`, `inputMode="numeric"`, `maxLength={6}` — server: non-empty check → "יש להזין את קוד האימות (6 ספרות)".
    - `terms_accepted`, `privacy_accepted`, `authorization_accepted` — plain checkboxes, no `name`-based required attr — server (`approveCampaignSchema`, Zod): each must be `z.literal(true)` → per-field Hebrew errors.
- **Tables / lists:** `dl`/`dt`/`dd` definition list for terms summary (not a data table).
- **Status states:** Gated by `campaign.status === 'pending_approval'` (the only status that shows the form); `'approved'` shows a success message + CTA to payment; any other status shows a generic "not awaiting approval" message. `isPast` (event-date-derived) blocks signing regardless of campaign status.
- **Empty / loading / error states:** No `loading.tsx`/`error.tsx`. `SignButton`/`ResendButton` use `useFormStatus` for pending copy ("רגע…"/"שולח…"). `FormError`/`FieldError`/`FormNotice` used per-field and per-form.
- **Existing shared components used:** `ui`: `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `Button` (all in `agreement-sheet.tsx`). `shared`: `FieldError`, `FormError`, `FormNotice` (`@/components/forms`).
- **Components that should be reused:** The three checkbox rows (`<label className="flex items-start gap-2 text-sm"><input type="checkbox".../><span>...</span></label>`) are hand-rolled — no shared Checkbox primitive exists (per spec), but this exact repeated markup (×3 in this file) is the strongest local case for one. The text `<input>`/`<label>` pairs (`otp_code`) use a local `inputClass`/`labelClass` string duplicated from the same pattern in `hold-form.tsx`/`payment-form.tsx` (see §5).
- **Components that should be extracted:** (1) The checkbox+label row → shared `CheckboxField`. (2) `SignaturePad` canvas wrapper (init/resize/clear/dataURL logic, lines 89-123) is a self-contained, non-trivial piece of client logic — if signature capture is ever needed elsewhere, extract as a `SignaturePadField`. (3) The labeled-input pattern (`inputClass`/`labelClass` + `label`+`input`+`FieldError`) repeats across this file and the two payment forms — candidate for a shared `TextField`.
- **Mobile considerations:** Page wrapper is `mx-auto max-w-2xl` — comfortably fits 360px. Signature canvas is `h-40 w-full` (no fixed pixel width) and resizes via a `resize()` handler bound to `window.resize` — should work on mobile, but canvas-based signature on a small touch screen is inherently cramped (UX risk, not a layout bug). `dl` terms grid is `grid-cols-1 sm:grid-cols-2` — stacks correctly below `sm`.
- **Desktop considerations:** `max-w-2xl` caps width appropriately for a legal/signing flow; Sheet opens as `sm:max-w-2xl` panel, doesn't compete with page width.
- **RTL considerations:** OTP input is deliberately `dir="ltr"` with `text-start` (a Latin/numeric field forced LTR inside an RTL form — correct pattern, matches the auth area's convention for phone/email fields). Phone display in the identity block also uses `dir="ltr"`. The Sheet opens `side="right"`, which is the correct reading-start edge for this RTL app (AppShell's own sidebar uses the same `side="right"` convention) — verified the Sheet's `DirectionProvider` is provided once at `AppShell` (`src/components/app-shell.tsx:148`), which wraps all of `(customer)/app/*` via React context, so the portaled Sheet content is correctly RTL-aware despite portaling out of the DOM tree. No physical `left/right`/`ml-/mr-` classes found in these three files.
- **Design risks:** (1) `dangerouslySetInnerHTML` renders both the page's inline `AGREEMENT_CSS` `<style>` tag and the full agreement HTML (in the Sheet) — the comment states the HTML is "server-generated…and trusted," which the audit cannot independently verify; flagged as `Needs verification` against `@/lib/agreements/template` (out of this area's file list). (2) Consent checkboxes have no visible `required` HTML attribute — invalid submissions are only caught server-side after a full round trip (no client-side prevention), though the Zod messages do surface per-field via `FieldError`. (3) Signature capture on mobile touch is a known general UX friction point for this pattern (not a code defect).
- **Recommended redesign scope:** Medium (extract `CheckboxField`/`TextField`; consider a lighter mobile-specific signature affordance).

### /app/events/[id]/campaign/[campaignId]/payment
- **Route:** `/app/events/[id]/campaign/[campaignId]/payment`
- **Page name:** אמצעי תשלום / Payment method (campaign hold)
- **Component type:** Server (page) + Client (`hold-form.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Capture a card and place a J5 authorization hold up to the campaign's charge ceiling (actual charge happens later, at campaign close/settle).
- **Primary user goal:** Enter card details once to authorize the hold and unblock campaign activation.
- **Main content sections:** Back link + title; one of several mutually-exclusive state branches (past-event block, event-not-active block, already-authorized confirmation, non-approved-status block, or the live form path); when live: signed-agreement confirmation banner, hold-summary explainer, optional query-param error banner, the SUMIT card form (only if `paymentsEnabled && holdsEnabled && publicConfig`) or a "we'll contact you" fallback notice, and a closing disclaimer line.
- **Actions:** Submit card hold (native form POST to `/api/campaigns/${campaignId}/authorize`, not a Server Action — see `hold-form.tsx`); back-link navigation.
- **Forms / fields:** `hold-form.tsx` (`CampaignHoldForm`) — all fields carry `data-og` attributes (read by SUMIT's `payments.js`), most have **no `name`** attribute so they never reach the app's own server: `cardnumber` (text, numeric, `autoComplete="cc-number"`, `maxLength=20`), `expirationmonth`/`expirationyear` (text, numeric, `maxLength=2`/`4`), `cvv` (text, numeric, `maxLength=4`), `citizenid` (text, numeric — explicitly documented as PII that must never get a `name`). No visible client-side validation beyond `inputMode`/`maxLength`; SUMIT's own `payments.js` tokenizes and writes errors into a `.og-errors` div. Server: `authorizeHoldSchema` (referenced from `campaigns.ts`, not in this file) validates only the resulting `og-token`.
- **Tables / lists:** None.
- **Status states:** Branches on `campaign.capture_status` (`authorized` = done state), `campaign.status` (whitelist: only `approved` renders the live form), `event.status !== 'active'`, and `isPast`. Query-param error codes mapped via local `ERROR_MESSAGES`: `token_missing, holds_disabled, bad_state, already_held, hold_declined, hold_review, event_past, event_not_active`.
- **Empty / loading / error states:** No `loading.tsx`/`error.tsx`. Form-internal states: `ready` (payments.js bound), `submitting` (tokenizing), `loadError` (script load failed) — each drives button label/disabled state and an inline error banner.
- **Existing shared components used:** None — no `ui` or `shared` imports in either file. Purely hand-rolled markup and `next/script`.
- **Components that should be reused:** All banner/notice paragraphs on this page (`bg-green-50`, `bg-red-50`, `bg-amber-50`) duplicate the shape of the shared `FormNotice`/`FormError` components (`@/components/forms`) but don't use them, and use literal Tailwind palette classes instead of this app's semantic tokens (`success`/`warning`/`destructive`) — inconsistent with `manage-client.tsx` and `approve/page.tsx` in the very same feature area, which do use `bg-success/10 text-success` / `bg-warning/10 text-warning`. This is a structural reuse gap, not a color-choice judgment.
- **Components that should be extracted:** The entire `CampaignHoldForm` is near byte-identical to `orders/[id]/pay/payment-form.tsx` (`PaymentForm`) — same jQuery/payments.js loading, same poll/bind logic, same four fields, same class names — differing only in `campaignId`/`orderId` prop name, the form `action` URL, and the submit button's idle label ("אישור ותפיסת מסגרת" vs "שלם עכשיו"). Strong candidate for a single shared `SumitCardForm` component parameterized by `action`/`submitLabel`/`companyId`/`apiPublicKey`. See §5.
- **Mobile considerations:** Page wrapper `mx-auto max-w-2xl` fits 360px. Card form fields stack full-width except month/year which sit `flex gap-4` two-up — at very narrow widths (≤340px) two `flex-1` number inputs with labels could feel tight but no fixed pixel width was found, so no hard overflow.
- **Desktop considerations:** `max-w-2xl` is appropriate for a short payment form; no desktop-specific layout.
- **RTL considerations:** `og-errors` and other injected-by-library text nodes are untranslated/library-controlled (external constraint, noted per spec). Card fields have no explicit `dir` — numeric card fields would conventionally be LTR; `Needs verification` whether SUMIT's `payments.js` applies its own `dir` internally, since none is set here (differs from the OTP field in `sign-agreement-form.tsx`, which explicitly sets `dir="ltr"`). No physical-direction classes (`left/right`/`ml-/mr-`) found.
- **Design risks:** (1) Duplicated SUMIT form (see extract candidate) — a fix or security change (e.g. adding a field, changing tokenization handling) must currently be applied in two places and has already drifted slightly in comments only, not logic, which is itself a maintenance risk. (2) Raw literal color classes for success/warning/error banners instead of the app's semantic tokens (see reuse note) — inconsistent within this very feature area. (3) Card number/expiry/CVV inputs have no `dir` attribute — worth verifying visually in RTL.
- **Recommended redesign scope:** Medium (extract shared `SumitCardForm`; replace literal color banners with `FormNotice`/`FormError` or semantic-token equivalents; verify card-field `dir`).

### /app/orders
- **Route:** `/app/orders`
- **Page name:** הזמנות / Orders
- **Component type:** Server (page); `OrderCard` is a plain (non-`'use client'`) local function, still Server-rendered
- **Shell/Layout:** AppShell
- **Current purpose:** List all of the current user's orders with status and a pay CTA where applicable.
- **Primary user goal:** See order history and pay any outstanding order.
- **Main content sections:** Title; optional `paid=1` success banner; error banner (load failure) OR empty state OR the order list.
- **Actions:** "שלם עכשיו" link per payable order → `/app/orders/${id}/pay`.
- **Forms / fields:** None (list page only). — 
- **Tables / lists:** `<ul>`/`<li>` card list (not an HTML `<table>`), one `OrderCard` per order: amount, created date, optional "כולל תוסף AI" note, status badge, conditional pay button.
- **Status states:** `order.status` — one of `pending, processing, paid, failed, demo, payment_review` (`ORDER_STATUS_LABELS`, `@/lib/constants.ts`). Badge styling: neutral default (`border-border text-muted-foreground`) for most statuses; distinct overrides only for `processing` (blue) and `payment_review` (amber) via a literal-color `statusBadgeOverrides` map — every other status (including `paid`/`failed`) gets the same neutral badge, so `paid` and `failed` are visually indistinguishable from each other and from `pending`/`demo` (label text is the only differentiator).
- **Empty / loading / error states:** No `loading.tsx`/`error.tsx`. Explicit inline branches: load-error banner (`role="alert"`), empty state (`Receipt` icon + "אין הזמנות עדיין", dashed border card), and the populated list. Auth redirect is explicitly re-thrown (`unstable_rethrow`) rather than caught, per the inline comment, so an unauthenticated user still reaches login instead of seeing a false error banner.
- **Existing shared components used:** None (`ui`/`shared`) — no imports from `@/components/ui/*` or `@/components/*` in this file.
- **Components that should be reused:** The status badge (`statusBadgeBaseClass` + `statusBadgeOverrides`) is another hand-rolled badge instance (3rd one found in this area, alongside campaign-status and payment-review chips) — same "no shared Badge primitive" gap noted area-wide. The success/error banners again duplicate `FormNotice`/`FormError`'s shape with literal `bg-green-50`/`bg-red-50` instead of semantic tokens or the shared components.
- **Components that should be extracted:** (1) A shared status-Badge component with a variant map (would also serve the campaign-status chip and order-status badge from one primitive). (2) `OrderCard` itself is reusable-shaped already (props in, JSX out) — no change needed beyond promoting the badge/banner pieces.
- **Mobile considerations:** `OrderCard` is `flex items-start justify-between gap-4` — two flex children (amount block, status+button block) that could compress at very narrow widths since neither side has a `min-w-0`/wrap fallback documented; `Needs verification` visually at ≤360px whether the amount/date text and the status+button column ever collide. No fixed pixel widths found.
- **Desktop considerations:** List content sits inside AppShell's `max-w-5xl` container — comfortable width, no desktop-specific enhancement (e.g. no table view at wide viewports), acceptable for an order list of this simplicity.
- **RTL considerations:** All layout classes are logical (`gap`, `items-start`, `justify-between`); `items-end` on the status column stacks the badge/button correctly for RTL (visually toward the reading-start side). No physical-direction classes found.
- **Design risks:** (1) Same literal-color banner pattern as the payment/campaign pages (`bg-green-50`/`bg-red-50` vs semantic tokens) — recurring inconsistency across this whole area. (2) Status badge only visually distinguishes 2 of 6 statuses; `paid` (a happy-path, high-frequency status) has no distinct styling at all today. (3) **Confirmed (not merely suspected):** `listOrders()` (`@/lib/data/orders.ts`) accepts `{limit, offset}` and defaults `limit` to `getOrdersPageSize()` (`@/lib/constants.ts`, env-configurable via `ORDERS_PAGE_SIZE`, default 20) — but `orders/page.tsx` calls `listOrders()` with no arguments and exposes no page/offset control in the UI (`searchParams` only reads `paid`). A customer with more than the default page size of orders has no way to reach older ones; the data layer already supports pagination, only the page is missing the wiring.
- **Recommended redesign scope:** Light–Medium (shared Badge with a fuller status-variant map; replace literal banners; wire pagination controls into the existing `listOrders({limit, offset})` support).

### /app/orders/[id]/pay
- **Route:** `/app/orders/[id]/pay`
- **Page name:** תשלום / Payment (order)
- **Component type:** Server (page) + Client (`payment-form.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Pay a single pending/failed order (J4 direct charge, distinct from the campaign's J5 hold-then-settle flow).
- **Primary user goal:** Enter card details and complete payment for this order.
- **Main content sections:** Title; one of several status-branch messages (`paid` success, `payment_review` info, disabled/unconfigured notice, generic "can't pay now" notice) OR the live pay path: amount, optional query-param error banner, the SUMIT card form.
- **Actions:** Submit payment (native form POST to `/api/orders/${orderId}/pay`).
- **Forms / fields:** `payment-form.tsx` (`PaymentForm`) — identical field set/shape to the campaign hold form: `cardnumber`, `expirationmonth`, `expirationyear`, `cvv` (all `data-og`, no `name`), `citizenid` (`data-og`, deliberately no `name`, PII stays client-→SUMIT-only). No client-side validation beyond `inputMode`/`maxLength`; server validates only the resulting token (schema not in this file's read set, but same `og-token` pattern as the campaign hold route per the shared comment style).
- **Tables / lists:** None.
- **Status states:** `order.status` branches: `paid` (success message, no form), `payment_review` (info message, no form), `pending`/`failed` (the live form path, gated further by `paymentsEnabled` + `getSumitPublicConfig()`), any other status (`processing`/`demo`) → neutral "can't pay now" message. Query-param error codes via local `PAYMENT_ERROR_MESSAGES`: `token_missing, already_paid, not_payable, already_processing, payment_declined, payment_review, payments_disabled` (comment notes `already_paid`/`payment_review` are included for completeness even though those statuses branch away from the form before the error banner could render).
- **Empty / loading / error states:** No `loading.tsx`/`error.tsx`. `getOrder(id)` is documented as RLS-scoped + calling `notFound()` for a missing/non-owned order, deliberately NOT wrapped in try/catch so `notFound()`/redirect signals propagate — `Needs verification` against `@/lib/data/orders` (not in this file's read set) but the inline comment is explicit and consistent with the orders-list page's `unstable_rethrow` pattern. Form-internal `ready`/`submitting`/`loadError` states identical to the campaign hold form.
- **Existing shared components used:** None (`ui`/`shared`) in either file.
- **Components that should be reused:** Same as the campaign payment page — this page's success/review/disabled/error banners are all literal-color (`bg-green-50`, `bg-yellow-50`, `bg-red-50`, `bg-muted`) instead of `FormNotice`/`FormError` or semantic tokens.
- **Components that should be extracted:** `PaymentForm` here is the near-duplicate twin of `CampaignHoldForm` — see the shared §5 entry; a single parameterized `SumitCardForm` would collapse both.
- **Mobile considerations:** `space-y-6` vertical stack, no wrapping container width constraint set on this page itself (relies on AppShell's `max-w-5xl`, unlike the campaign pages which self-impose `max-w-2xl`) — `Needs verification` whether the form reads comfortably at full `max-w-5xl` on a wide screen or would benefit from a narrower cap like its campaign-flow sibling (inconsistency between the two payment pages' width constraints).
- **Desktop considerations:** Because this page does NOT set its own `max-w-2xl` (unlike `payment/page.tsx`), the card form could stretch to the full `max-w-5xl` AppShell container width on desktop — likely a layout inconsistency vs. the campaign hold page, worth a visual check.
- **RTL considerations:** Same as the campaign hold form — no `dir` set on numeric card fields; `Needs verification`. No physical-direction classes found.
- **Design risks:** (1) Missing `max-w-2xl` wrapper (or equivalent) compared to the campaign payment page — inconsistent form width between the app's two SUMIT payment surfaces. (2) Duplicated SUMIT form logic (see extract candidate). (3) Literal-color banners recurring pattern.
- **Recommended redesign scope:** Medium (extract shared `SumitCardForm`; align page-width wrapper with the campaign payment page; replace literal banners).

## 3. UI Elements Per Page

### /app/events/[id]/campaign/[campaignId]
- buttons: lifecycle action buttons (`ActionButton`, inline/local) — variants `primary`/`danger`/default(outline-ish), none from `ui` Button
- inputs / selects / search / filters: none
- cards / tables / lists: `Stat` tiles (inline/local, `border border-border bg-card` cards); no tables
- badges / status chips: campaign status pill (inline/local `<span className="rounded-full border...">`)
- dropdown menus / dialogs / sheets: none (destructive actions use `window.confirm()` instead)
- empty / loading / error UI: delivery-breakdown hidden until `totalContacts > 0`; per-action `FormError`/`FormNotice` (shared)
- destructive actions: close campaign (danger variant + `window.confirm`), settle/charge (primary variant + `window.confirm`)

### /app/events/[id]/campaign/[campaignId]/approve
- buttons: `Button` (ui, `variant="outline"`, Sheet trigger); `SignButton`/`ResendButton` (inline/local, raw `<button>`, not `ui` Button); CTA link to payment step (inline/local anchor-styled)
- inputs / selects / search / filters: `otp_code` text input, signature hidden input + `<canvas>` (SignaturePad), 3 checkboxes — all inline/local
- cards / tables / lists: terms summary `dl` (inline/local); identity/OTP blocks are bordered `div`s (inline/local)
- badges / status chips: none (uses plain success/warning `<p>` banners instead)
- dropdown menus / dialogs / sheets: `Sheet`/`SheetTrigger`/`SheetContent`/`SheetHeader`/`SheetTitle` (ui) for the full agreement text
- empty / loading / error UI: `FormError`/`FieldError`/`FormNotice` (shared) per field/form; `useFormStatus` pending labels
- destructive actions: none directly (signing is consequential but not a delete/destroy action)

### /app/events/[id]/campaign/[campaignId]/payment
- buttons: submit button (inline/local raw `<button>`, primary-styled via literal classes, not `ui` Button)
- inputs / selects / search / filters: `cardnumber`, `expirationmonth`, `expirationyear`, `cvv`, `citizenid` (all inline/local, `data-og` attributes for SUMIT)
- cards / tables / lists: summary/explainer `section`s (inline/local bordered cards)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: literal-color inline banners for each branch (already-held, past-event, not-active, bad-state, load-error) — none use `FormNotice`/`FormError`
- destructive actions: none (this is a capture/authorize step, not a charge)

### /app/orders
- buttons: none as `<button>`; "שלם עכשיו" is a styled `next/link` (inline/local classes, not `ui` Button)
- inputs / selects / search / filters: none
- cards / tables / lists: `<ul>` of `OrderCard` `<li>` cards (inline/local) — list, not a table
- badges / status chips: order-status badge (inline/local, `statusBadgeOverrides` map)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: explicit empty state (`Receipt` icon, inline/local), load-error banner (literal-color), `paid=1` success banner (literal-color)
- destructive actions: none

### /app/orders/[id]/pay
- buttons: submit button (inline/local raw `<button>`, same shape as the campaign hold form's)
- inputs / selects / search / filters: `cardnumber`, `expirationmonth`, `expirationyear`, `cvv`, `citizenid` (inline/local, `data-og`)
- cards / tables / lists: none beyond the plain status paragraphs
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: per-status literal-color banners (paid/success, payment_review/info, disabled/muted, error) — none use `FormNotice`/`FormError`
- destructive actions: none (payment submission, not a destructive action)

## 4. Responsive & RTL Findings
### /app/events/[id]/campaign/[campaignId]: mobile-fit = yes; wide areas: 4-col stat grid collapses to 1/2/4 cols responsively, no fixed widths; RTL risks: none found — `inlineSize` used correctly for the delivery bar fill, all spacing logical.

### /app/events/[id]/campaign/[campaignId]/approve: mobile-fit = yes; wide areas: `dl` terms grid `grid-cols-1 sm:grid-cols-2`, signature canvas `h-40 w-full` (no fixed px width) but cramped UX on small touch screens (UX note, not overflow); RTL risks: none found — OTP/phone fields correctly forced `dir="ltr"`, Sheet opens from the correct RTL reading-start edge (`side="right"`, DirectionProvider confirmed at AppShell level covering portaled content).

### /app/events/[id]/campaign/[campaignId]/payment: mobile-fit = yes; wide areas: month/year fields sit `flex gap-4` two-up, tight but not overflowing at ≤340px, no fixed px widths found; RTL risks: card fields have no explicit `dir` — `Needs verification` how SUMIT's injected library markup (`.og-errors`) and the numeric fields render in RTL.

### /app/orders: mobile-fit = partial; wide areas: `OrderCard`'s `flex items-start justify-between` two-column layout has no `min-w-0`/wrap fallback documented for the amount block vs. status+button column — `Needs verification` visually at ≤360px; RTL risks: none found, all classes logical.

### /app/orders/[id]/pay: mobile-fit = yes; wide areas: page does not self-constrain width (relies on AppShell's `max-w-5xl`, unlike its `max-w-2xl`-capped sibling `payment/page.tsx`) — a desktop layout-consistency issue more than a mobile one; RTL risks: same as the campaign hold form — card fields have no explicit `dir`, `Needs verification`.

## 5. Duplications & Extract Candidates
- **SUMIT card-tokenize form** (`hold-form.tsx`'s `CampaignHoldForm` and `payment-form.tsx`'s `PaymentForm`) — near byte-identical: same jQuery/payments.js loading via `next/script`, same `bind()` poll logic, same four `data-og` fields (`cardnumber`/`expirationmonth`/`expirationyear`/`cvv`/`citizenid`), same `ready`/`submitting`/`loadError` state shape, same `inputClass` constant. Differ only in the form's `action` URL, the id prop name (`campaignId` vs `orderId`), and the submit button's idle label. → seen in `.../campaign/[campaignId]/payment/hold-form.tsx` and `.../orders/[id]/pay/payment-form.tsx` → suggest extract as `SumitCardForm` (props: `action`, `submitIdleLabel`, `companyId`, `apiPublicKey`).
- **Literal-color status/notice banners** — `bg-green-50/text-green-700`, `bg-red-50/text-red-700`, `bg-amber-50/text-amber-800`, `bg-yellow-50/text-yellow-800` used for success/error/warning/info messages, duplicating the shape of the already-shared `FormNotice`/`FormError` (`@/components/forms`, which use `bg-success/10 text-success` / `bg-destructive/10 text-destructive`) without using them or the app's semantic tokens (`success`/`warning`/`destructive`) that `manage-client.tsx` and `approve/page.tsx` DO use correctly. → seen in `campaign/[campaignId]/payment/page.tsx`, `orders/page.tsx`, `orders/[id]/pay/page.tsx` → suggest either reusing `FormNotice`/`FormError`/a new `InfoBanner`, or at minimum switching to the existing semantic tokens (`success`/`warning`/`destructive`/`muted`) for consistency with the rest of this same feature area.
- **Status/badge chip** — three independent hand-rolled badge shapes: campaign status pill (`manage-client.tsx`), order status badge with a partial override map (`orders/page.tsx`). No shared Badge primitive exists (confirmed per spec's known-gaps list). → seen in `manage-client.tsx`, `orders/page.tsx` → suggest extract as a shared `Badge`/`StatusChip` component with a variant map, once introduced it would also standardize the `paid`/`failed` visual gap noted on the orders page.
- **Stat/metric tile** (`Stat`, local to `manage-client.tsx`) — simple label/value card; check other areas of the app for a similar pattern before introducing a new shared `StatCard` (this audit only covered this area, so cross-area duplication is `Needs verification`).
- **Labeled text-input block** (`label` + `input` + `FieldError`, with local `inputClass`/`labelClass` constants) — repeated in `sign-agreement-form.tsx` (`otp_code`) and effectively the same shape (without `FieldError`, since SUMIT fields aren't app-validated) in both SUMIT card forms. → seen in `approve/sign-agreement-form.tsx`, `payment/hold-form.tsx`, `orders/[id]/pay/payment-form.tsx` → suggest a shared `TextField` once introduced app-wide (also flagged in the Auth area, per that area's fragment).
- **Checkbox+label consent row** — 3 near-identical rows in `sign-agreement-form.tsx` alone. → seen in `approve/sign-agreement-form.tsx` → suggest extract as `CheckboxField` if this pattern recurs elsewhere in the app (single-file duplication only within this area's read set).

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: `sheet` (`Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle` — used only in `agreement-sheet.tsx`), `button` (`Button` — used only as the Sheet trigger in `agreement-sheet.tsx`). No other `ui` primitives (`input`, `select`, `card`, `tabs`, etc.) are used anywhere in this area — all inputs/cards are inline/local.
- from `@/components`: `forms` (`FormError`, `FormNotice`, `FieldError` — used in `manage-client.tsx` and the two `approve/` files; notably NOT used in either payment page or the orders pages, which hand-roll equivalent banners instead — see §5).
- inline/local components defined in this area:
  - `manage-client.tsx` → `Stat` (metric tile), `ActionButton` (confirm-gated lifecycle button), `DeliveryBar` (RTL-safe progress bar), `DeliveryBreakdown` (WhatsApp delivery/outcome section)
  - `agreement-sheet.tsx` → `AgreementSheet` (wraps `ui` Sheet with the trusted agreement HTML)
  - `sign-agreement-form.tsx` → `SignButton`, `ResendButton`, `SignAgreementForm` (OTP + signature-pad + consents)
  - `hold-form.tsx` → `CampaignHoldForm` (SUMIT J5 hold form)
  - `orders/page.tsx` → `OrderCard`
  - `payment-form.tsx` → `PaymentForm` (SUMIT J4 payment form)
