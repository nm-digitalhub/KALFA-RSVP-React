# Area: Admin — Config & Users

_Files read: 6 pages, 7 co-located components (agreement-client.tsx, agreement-config-form.tsx, help-tip.tsx, company-form.tsx, settings-form.tsx, sumit-test-form.tsx, user-actions.tsx). Also read for context: 5 `actions.ts`/`config-actions.ts` server-action modules, `src/lib/validation/admin.ts` (schemas), `src/lib/data/admin/settings.ts` (getAppSettings), and the shared kit files `_components.tsx`, `forms.tsx`, `ui/card.tsx`, `ui/select.tsx`, `ui/input.tsx`, `ui/button.tsx`. Note: `ui/input.tsx` (confirmed present via `ls src/components/ui/`) corrects an earlier draft of this fragment that had wrongly asserted no `Input` primitive exists — it does; only `Textarea`/`Label` are genuinely absent, per the spec's known-components list._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| /admin/agreement | agreement/page.tsx | Server | AdminShell | Contract template edit/approve + config values + live preview |
| /admin/agreement | agreement/agreement-client.tsx | Client | (child of above) | Save/approve/revert forms for the contract body |
| /admin/agreement | agreement/agreement-config-form.tsx | Client | (child of above) | 7-field form for agreement-embedded config values |
| /admin/agreement | agreement/help-tip.tsx | Client | (child of above) | Reusable "?" popover explanation icon (local to this route) |
| /admin/company | company/page.tsx | Server | AdminShell | Company legal identity + contact + policy links |
| /admin/company | company/company-form.tsx | Client | (child of above) | 8-field company details form |
| /admin/settings | settings/page.tsx | Server | AdminShell | Payment/SMS/SMTP provider config + read-only infra status |
| /admin/settings | settings/settings-form.tsx | Client | (child of above) | Masked-secret form w/ reveal + edit-lock per field |
| /admin/sumit-test | sumit-test/page.tsx | Server | AdminShell | Live SUMIT payment API diagnostic/POC tool |
| /admin/sumit-test | sumit-test/sumit-test-form.tsx | Client | (child of above) | Two forms: tokenize+charge, and charge-saved-token |
| /admin/users | users/page.tsx | Server | AdminShell | Platform user list, search, pagination |
| /admin/users/[id] | users/[id]/page.tsx | Server | AdminShell | User detail: profile, orgs, orders, credits |
| /admin/users/[id] | users/[id]/user-actions.tsx | Client | (child of above) | Admin/suspend, grant-credit, update-plan forms |

No route in this area has a co-located `loading.tsx`, `error.tsx`, or `not-found.tsx`. All six pages fall back to the shared `src/app/(admin)/admin/loading.tsx` (generic pulse skeleton) and `src/app/(admin)/admin/error.tsx` (generic "משהו השתבש" boundary with version-skew auto-reload) — these are shared across the whole `/admin/*` tree, not owned by this area, so not given their own inventory row.

## 2. Design Briefs

### /admin/agreement
- **Route:** /admin/agreement
- **Page name:** חוזה / Agreement (contract) management
- **Component type:** Server (page.tsx), with Client children (AgreementEditor, AgreementConfigForm, HelpTip)
- **Shell/Layout:** AdminShell
- **Current purpose:** View/edit the campaign agreement template (custom HTML body + version + draft/approved status), tune the 7 config values embedded live into every signed agreement, and preview the exact rendered wording.
- **Primary user goal:** Keep the contract wording and its embedded parameters correct, and verify the rendered result before customers see it.
- **Main content sections:** header with status badges; AgreementEditor (save / approve / revert-to-default, 3 forms); "פרמטרים של ההסכם" config section (7 fields); live HTML preview (`dangerouslySetInnerHTML` + scoped `AGREEMENT_CSS`).
- **Actions:** Save (returns to draft), Approve (removes draft badge), Revert to default template (destructive-styled), Save config values.
- **Forms / fields:**
  - Save: `version` (text, required, max 80, `dir=ltr`), `body_html` (textarea, optional HTML, monospace) — `agreementEditSchema`.
  - Approve: `version` (text, required, max 80, `dir=ltr`, prefilled without `draft-` prefix) — `agreementApproveSchema`.
  - Revert: no fields.
  - Config (7 fields, all `z.string().trim()` — no numeric coercion despite `inputMode="numeric"` hints): `serviceActivationWindow`, `offerValidityDays`, `chargeWindowDays`, `holdReleaseDays`, `liabilityCap`, `retentionDays`, `recordRetentionMonths`.
- **Tables / lists:** none.
- **Status states:** `doc.status`: draft | approved (badge "טיוטה"/"מאושר"); `doc.bodyHtml != null` → "נוסח מותאם" vs "תבנית ברירת מחדל".
- **Empty / loading / error states:** none page-specific; shared admin loading/error. Per-form `FormError`/`FormNotice`/`FieldError` via `useActionState`.
- **Existing shared components used:** shared `PageHeading`, `Badge` (no variant passed → always neutral); shared `FieldError, FormError, FormNotice, SubmitButton`; Base UI `Popover` (via local `HelpTip`).
- **Components that should be reused:** `@/components/ui/card` instead of the hand-rolled `sectionClass = 'space-y-3/4 rounded-lg border border-border bg-card p-5'` repeated 3× in this page; `@/components/ui/input` — every text field on this page (version ×2, 7 config fields) is a hand-rolled native `<input>` with a local `inputClass` string, even though `Input` already exists as a shared primitive (only `body_html`'s `<textarea>` has no primitive to reuse — `Textarea` is confirmed absent).
- **Components that should be extracted:** hand-rolled `inputClass` text-input/textarea pattern (near-identical Tailwind string repeated in agreement-client.tsx and agreement-config-form.tsx) → shared `TextField`/`TextareaField` (wrapping the existing `Input` for the text case); `HelpTip` is a genuinely reusable "?" popover but currently lives local to this one route only.
- **Mobile considerations:** config grid is `sm:grid-cols-2` (stacks to 1 col <640px, correct); textarea/preview are full-width; no fixed px widths found.
- **Desktop considerations:** version inputs constrained `max-w-xs`; preview box unconstrained inside the shell's `max-w-5xl`.
- **RTL considerations:** version/body_html/numeric config fields forced `dir="ltr"` with Hebrew labels (consistent, intentional). Preview HTML is raw-injected via `AGREEMENT_CSS` — Needs verification whether that stylesheet (outside this area, `@/lib/agreements/template`) declares its own RTL rules.
- **Design risks:** (1) `dangerouslySetInnerHTML` for both `AGREEMENT_CSS` and the rendered preview — server-generated from trusted config today, but a pattern worth watching. (2) `text-green-700` hardcoded in agreement-client.tsx diverges from the `success` token used by `FormNotice` two lines away in the same file. (3) Config fields hinted numeric (`offerValidityDays`, `chargeWindowDays`, `holdReleaseDays`, `liabilityCap`, `recordRetentionMonths`) are validated only as trimmed strings server-side — no digits-only regex, unlike `sumit_company_id`/`smtp_port` in the settings schema which do enforce `^\d*$`.
- **Recommended redesign scope:** Light.

### /admin/company
- **Route:** /admin/company
- **Page name:** פרטי חברה והסכם / Company & legal details
- **Component type:** Server (page.tsx) + Client (CompanyForm)
- **Shell/Layout:** AdminShell
- **Current purpose:** Edit company legal identity, contact info, policy links, and warranty text — all embedded live into the signed customer agreement (§14ג mandatory disclosures).
- **Primary user goal:** Keep legally-required company disclosures accurate.
- **Main content sections:** single card, one form, 8 fields.
- **Actions:** Save.
- **Forms / fields:** `company_legal_name`, `company_legal_id`, `company_legal_address`, `company_contact_phone` (tel), `company_contact_email` (email), `privacy_url` (url), `terms_url` (url), `warranty_text` (textarea) — `companySettingsSchema`: all plain `z.string().trim()`, no format/email/URL validation despite the HTML `type` hints.
- **Tables / lists:** none.
- **Status states:** none.
- **Empty / loading / error states:** none page-specific; shared admin loading/error; `FormError`/`FormNotice`/`FieldError` per field.
- **Existing shared components used:** shared `PageHeading`; shared `FieldError, FormError, FormNotice, SubmitButton`.
- **Components that should be reused:** `@/components/ui/card` instead of hand-rolled `sectionClass`; `@/components/ui/input` — all 7 `<input>`s on this page (the `<textarea>` has no primitive to reuse) are hand-rolled with a local `inputClass` instead of the existing `Input` primitive.
- **Components that should be extracted:** the local `Field` (label+input+hint+error) helper is duplicated near-identically in company-form.tsx, settings-form.tsx (as `EditableField`), agreement-config-form.tsx, and inline in user-actions.tsx — the single most-repeated pattern across this whole area; strongest candidate for one shared `FormField`/`TextInput` wrapping the existing `Input` primitive (only `Label`/`Textarea` are genuinely absent from `@/components/ui/*`, per the known-components list — `Input` already exists and is simply unused everywhere in this area).
- **Mobile considerations:** two `sm:grid-cols-2` field pairs (phone/email, privacy/terms) stack correctly under 640px; no fixed widths.
- **Desktop considerations:** single-column fields run the full width of the `max-w-5xl` shell above the `sm:` breakpoint pairs.
- **RTL considerations:** no `dir` override on any field — tel/email/url values are not forced `dir="ltr"`, unlike the version/numeric fields elsewhere in this area. Needs verification whether that reads awkwardly for LTR-shaped values (phone numbers, URLs) inside RTL flow.
- **Design risks:** legal-identity fields (address, phone, email, URLs) have zero format validation server-side; a malformed value is silently saved and only becomes visible on the separate `/admin/agreement` preview page.
- **Recommended redesign scope:** Light.

### /admin/settings
- **Route:** /admin/settings
- **Page name:** הגדרות מערכת / System settings
- **Component type:** Server (page.tsx) + Client (SettingsForm)
- **Shell/Layout:** AdminShell
- **Current purpose:** Master on/off switches and provider credentials for payments (SUMIT), SMS OTP (ExtrA), and outbound email (SMTP/IONOS); plus a read-only infra/env config health panel.
- **Primary user goal:** Toggle integrations and rotate secret credentials safely.
- **Main content sections:** one card with a single `<form>` containing 3 logical groups (SUMIT / SMS / SMTP, separated by `<hr>`), each with an enable-checkbox + fields; a second card = read-only infra/env status list.
- **Actions:** Save (one submit for all groups); per-field "ערוך" (edit-unlock) / "הצג" (reveal) client-only toggles.
- **Forms / fields:** `payments_enabled`, `sumit_company_id` (regex `^\d*$`), `sumit_api_public_key` (maskable), `sumit_api_key` (maskable), `sms_enabled`, `extra_sms_sender`, `extra_sms_token` (maskable), `email_enabled`, `smtp_host`, `smtp_port` (regex `^\d*$`), `smtp_secure`, `smtp_user`, `smtp_password` (maskable), `smtp_from` — `appSettingsSchema`.
- **Tables / lists:** infra status `<ul>` (key/label/configured rows) — plain list, not a data table.
- **Status states:** infra `item.configured` → "מוגדר" (Check) / "חסר" (X), rendered with hardcoded `text-green-700`/`text-red-700`, not the `success`/`destructive` tokens.
- **Empty / loading / error states:** none page-specific; shared admin loading/error.
- **Existing shared components used:** shared `PageHeading`; shared `FieldError, FormError, FormNotice, SubmitButton`; lucide `Check/X/Eye/EyeOff`.
- **Components that should be reused:** `@/components/ui/card`; `@/components/ui/switch` exists as a shared primitive but all 4 boolean toggles (`payments_enabled`, `sms_enabled`, `email_enabled`, `smtp_secure`) are hand-rolled native checkboxes styled with `accent-primary` instead; `@/components/ui/input` — all 10 text/maskable fields (verified via `EditableField` call count) hand-roll a native `<input>` with a local `inputClass` instead of the existing `Input` primitive.
- **Components that should be extracted:** the infra-status row (icon + configured/missing text) duplicates the `Badge` concept with its own ad-hoc color logic instead of reusing the shared `Badge` success/destructive variants.
- **Mobile considerations:** all fields stack full-width (no grid) — mobile-safe by construction. Infra row is `flex items-center justify-between gap-4` with no wrap/truncate on the label+key text; could crowd against the status pill on very narrow screens — Needs verification.
- **Desktop considerations:** full-width single-column form inside `max-w-5xl` — noticeably wider/longer-line fields than the 2-column grids used on the company page.
- **RTL considerations:** no field in this form forces `dir="ltr"` (host/port/user/from are all inherently LTR-shaped values), which is inconsistent with the agreement/company forms in this same area that do force `dir="ltr"` on version/numeric fields.
- **Design risks:** (1) **Verified in code (`src/lib/data/admin/settings.ts` `getAppSettings`)**: `sumit_api_key`, `extra_sms_token`, and `smtp_password` are selected in full from the DB and passed as plain-text `defaultValue` into the client component — the real secret is present in the server-rendered HTML/DOM at all times, only visually hidden via `type="password"`; view-source or devtools reveals it regardless of the "הצג"/reveal toggle. Access is gated by `requireAdmin()`, but this is still a genuine plaintext-secret-to-browser pattern the project instructions flag as sensitive. (2) infra-status colors are raw Tailwind (`green-700`/`red-700`), not the `success`/`destructive` tokens used one section away by `FormNotice`/`FormError` in the same file's own imports.
- **Recommended redesign scope:** Medium — componentization plus the secret-exposure pattern above likely warrants a security-scoped follow-up (flagged here, not fixed).

### /admin/sumit-test
- **Route:** /admin/sumit-test
- **Page name:** בדיקת SUMIT (POC) / SUMIT diagnostic test tool
- **Component type:** Server (page.tsx) + Client (SumitTestForm)
- **Shell/Layout:** AdminShell
- **Current purpose:** Admin-only diagnostic/POC tool to exercise the live SUMIT payment API (tokenize+charge, J4/J5) with admin-chosen parameters and inspect the raw provider response, ahead of the production billing flow.
- **Primary user goal:** Verify SUMIT REST behavior against the real, live provider under controlled test parameters.
- **Main content sections:** amber warning banner ("hits live SUMIT"); Form A — card tokenize+charge (~12 fields, 3rd-party `payments.js` binds and tokenizes client-side before a native POST to `/api/admin/sumit-test`); Form B — charge an existing saved token (~7 fields, plain native POST, no tokenization).
- **Actions:** "שלח ל-SUMIT והצג תגובה" (Form A, disabled until the 3rd-party script is ready), "חייב טוקן שמור" (Form B).
- **Forms / fields:** Form A: `auto_capture` (select J5/J4), `amount`, `authorize_amount`, `vat_rate`, `card_token_not_needed` (checkbox), `prevent_document_creation` (checkbox, default checked), `email`, plus `data-og` tokenized card fields (`cardnumber`, `expirationmonth`, `expirationyear`, `cvv`, `citizenid` — the last has no `name` at all, so it never reaches our own POST). Form B: `saved_token`, `route_b_exp_month`, `route_b_exp_year`, `route_b_citizen_id`, `amount`, `email`. No Zod/client-side validation visible in this file — server-side validation lives in the Route Handler (`/api/admin/sumit-test`), outside this area's assigned files (Needs verification).
- **Tables / lists:** none.
- **Status states:** local `ready`/`submitting`/`loadError` component state (3rd-party script load gate) — not a domain status.
- **Empty / loading / error states:** `!ready` → disabled "טוען…" button; `loadError` → inline red alert "טעינת מערכת התשלום נכשלה"; missing-config case (no SUMIT company id/key) shown as an inline amber notice with a link to `/admin/settings` instead of rendering the form at all.
- **Existing shared components used:** none. Neither `@/components/forms` (SubmitButton/FieldError/FormError/FormNotice) nor any `@/components/ui/*` primitive is used anywhere on this page — fully hand-rolled inputs/select/buttons/alerts, and it posts to a Route Handler rather than using `useActionState`/Server Actions like every other form in this area.
- **Components that should be reused:** `@/components/ui/select` (the `auto_capture` dropdown); `@/components/ui/button` / shared `SubmitButton` (both submit buttons hand-duplicate the `Button` default-variant Tailwind almost verbatim); `@/components/ui/card` for the two form wrappers; `@/components/ui/input` — all ~15 text/number/email fields across both forms hand-roll a native `<input>` with a local `inputClass` instead of the existing `Input` primitive (the `data-og` tokenized card fields are a justified exception — they're bound by the third-party `payments.js` selector, not a styling choice).
- **Components that should be extracted:** the amber "dangerous live action" banner (page.tsx) and the red inline error alert (`.og-errors` / `loadError`) are two more instances of the area-wide missing shared Alert/Banner primitive.
- **Mobile considerations:** Form A's parameter grid is `grid-cols-2 gap-4` **unconditionally** (not `sm:grid-cols-2`) — squeezes label+input pairs into two columns even on a ~360px viewport. Form B's exp-month/exp-year/citizen-id row is `grid-cols-3 gap-4` unconditionally — three columns on mobile is worse. Both are concrete overflow/usability risks; every other multi-column grid in this area correctly gates behind `sm:`.
- **Desktop considerations:** both forms capped at `max-w-xl` (narrower than the shell's `max-w-5xl`) — reasonable for a diagnostic tool.
- **RTL considerations:** card/date/citizenid fields forced `dir="ltr"` — correct, consistent with the area's LTR-for-numeric-value convention.
- **Design risks:** (1) the only form in this area not built on the Server Action + `useActionState` + `FormState` pattern used everywhere else, so it can't reuse `FieldError`/`FormError`/`FormNotice`/`SubmitButton` without a structural rework. (2) explicitly documented as hitting the LIVE SUMIT provider with real card data (admin-gated, but a live-payment POC left permanently reachable in the codebase — Needs verification whether it's meant to be removed before general production launch, per its own "before we build the production flow" comment). (3) two structurally near-duplicate `<form>`s in one file with a documented but fragile mutual-exclusion trick (Form B deliberately omits `data-og="form"` so the 3rd-party script's jQuery selector skips it) — tightly coupled to an external script's exact selector behavior.
- **Recommended redesign scope:** Light — visual/componentization only; do not touch the `payments.js` binding logic, which the file's own comments say was hand-verified against live provider source.

### /admin/users
- **Route:** /admin/users
- **Page name:** משתמשים / Users (list)
- **Component type:** Server
- **Shell/Layout:** AdminShell
- **Current purpose:** Browse/search all platform users, see admin/suspended flags and org count, drill into a user's detail page.
- **Primary user goal:** Find a specific user (by email) and inspect/manage their account.
- **Main content sections:** search form (GET, single text input); user list (`<ul>` of full-row `<Link>` items); Pagination.
- **Actions:** Search (GET submit); row click → navigate to `/admin/users/[id]`.
- **Forms / fields:** `q` search input, GET method — plain string passed straight to `listAllUsers({ search })`, no Zod schema visible in this file.
- **Tables / lists:** `<ul>`/`<li>` list (not a `<table>`); each row shows name/email + Badge row (admin/suspended/org-count). Pagination via shared `Pagination` (prev/next links, `?page=`).
- **Status states:** `isPlatformAdmin` → "מנהל מערכת" Badge, `suspended` → "מושהה" Badge, always-shown "{orgCount} ארגונים" Badge — all rendered with the default/neutral `Badge` variant even though `_components.tsx` exports `success`/`warning`/`destructive` variants and "suspended" is semantically a state worth calling out.
- **Empty / loading / error states:** shared `EmptyState` ("לא נמצאו משתמשים.") when `items.length === 0`; no page-specific loading/error.
- **Existing shared components used:** shared `PageHeading, EmptyState, Badge, Pagination, parsePageParam` (all from `../_components`).
- **Components that should be reused:** none glaring — this page is already built almost entirely from the shared admin kit; the search `<input>`/`<button>` pair is hand-rolled, but no shared search primitive exists to reuse.
- **Components that should be extracted:** the "row = full-width Link, name/email start + badges end" pattern also appears (in a different shape) in `/admin/users/[id]`'s org/order/credit lists — a shared `<DetailList>`/`<ListRow>` would unify them (low priority).
- **Mobile considerations:** row uses `flex flex-wrap items-center justify-between gap-2` so badges wrap under the name/email on narrow screens; email uses `truncate`. Reasonable mobile behavior without a dedicated card breakpoint.
- **Desktop considerations:** simple horizontal rows inside `max-w-5xl`; no additional columns shown at wider breakpoints (e.g. last-sign-in only appears on the detail page).
- **RTL considerations:** email forced `dir="ltr"` in both the row and the search input — correct, consistent with the area-wide convention.
- **Design risks:** Badge used purely as a neutral label chip — "מושהה" (suspended, arguably the state most worth noticing at a glance) is visually identical to a neutral count badge, despite the component already supporting a `destructive`/`warning` variant.
- **Recommended redesign scope:** Light.

### /admin/users/[id]
- **Route:** /admin/users/[id]
- **Page name:** (dynamic — user's name/email) / User detail
- **Component type:** Server (page.tsx) + Client (UserActions)
- **Shell/Layout:** AdminShell
- **Current purpose:** Full detail + admin management actions for one platform user: profile fields, org memberships, package/order history, billing credits granted, and admin-only mutation actions.
- **Primary user goal:** Inspect a user's account state and perform support/admin interventions.
- **Main content sections:** header (name + "חזרה לרשימה" back link); "פרטי משתמש" (`dl` of 6 fields + admin/suspended badges); "ארגונים (N)" list; "תוכנית / חבילות" (orders) list; "הטבות שניתנו" (credits) list — rendered only when non-empty; `UserActions` block (permissions/status form; grant-credit form shown only if the user has events; update-plan form shown only if updatable orders + active packages both exist).
- **Actions:** Grant/revoke admin, Suspend/reactivate (hidden entirely when `isSelf` — self-lockout prevention in the UI, presumably also enforced server-side), Grant credit (event + amount + reason), Update plan (order + new package) — each its own `<form>` + `useActionState`.
- **Forms / fields:** `grantCreditSchema` (`event_id` uuid, required select; `amount` number, min 0, step 0.01, positive; `reason` text, required, max 300); `updatePlanSchema` (`order_id` uuid required select; `package_id` uuid required select); admin/suspend forms carry only a hidden `user_id` — `adminUserIdSchema`.
- **Tables / lists:** 3 `divide-y` `<ul>`/`<li>` lists (orgs, orders, credits) — not `<table>`s.
- **Status states:** `isPlatformAdmin`/`suspended` badges (same neutral-only issue as the list page); order `status` shown as raw Badge text (values include at least pending/failed, per `UPDATABLE = new Set(['pending','failed'])` in user-actions.tsx — full enum lives in `@/lib/data/admin/users`, outside this area's file set, Needs verification).
- **Empty / loading / error states:** `notFound()` on missing user — no co-located `not-found.tsx` in this area, falls through to the nearest one up the tree (Needs verification which boundary actually renders). Org/order empty states use inline text ("אין ארגונים."/"אין חבילות."), not the shared `EmptyState`. The credits section is hidden entirely (no empty message at all) when zero, inconsistent with orgs/orders on the same page. Per-action `FormError`/`FormNotice`.
- **Existing shared components used:** shared `PageHeading, Badge, formatCurrency, formatDateTime` (`../../_components`); shared `FieldError, FormError, FormNotice` (`@/components/forms`) — but not `SubmitButton`.
- **Components that should be reused:** (1) `SubmitButton` — `RowSubmit` in user-actions.tsx hand-duplicates the exact same `useFormStatus`-driven pending/disabled pattern, plus a hand-rolled `danger` variant instead of `Button`'s existing `destructive` variant. (2) `@/components/ui/select` for the 4 raw `<select>`s (credit-event, plan-order, plan-package). (3) `@/components/ui/card` for the `sectionClass` wrapper repeated 5× across page.tsx + user-actions.tsx combined. (4) `@/components/ui/input` — the credit-amount and credit-reason fields hand-roll a native `<input>` with a local `inputClass` instead of the existing `Input` primitive.
- **Components that should be extracted:** the 3 near-identical "divide-y list of label + trailing Badge/value" blocks (orgs/orders/credits) → one shared `<DetailList>`; the inline label+input blocks in the credit/plan forms duplicate the `Field` pattern seen elsewhere in this area.
- **Mobile considerations:** `dl.grid gap-3 sm:grid-cols-2` (profile) stacks correctly; credit/plan form grids (`sm:grid-cols-3`/`sm:grid-cols-2`) stack correctly; list rows use `flex flex-wrap items-center justify-between gap-2` so long content wraps reasonably. No fixed pixel widths found.
- **Desktop considerations:** everything constrained to the shared `max-w-5xl` shell; no distinct wide-screen layout (e.g. no side-by-side profile+actions panes).
- **RTL considerations:** email/phone forced `dir="ltr"` in the `dl` (consistent with the area). Currency amounts not `dir`-forced, but formatted via `formatCurrency`/`Intl.NumberFormat('he-IL', ...)`, so likely fine — Needs verification visually.
- **Design risks:** (1) `RowSubmit`'s hand-rolled `danger` style (`bg-red-50 text-red-700`) bypasses both the shared `Button` `destructive` variant and the `destructive` design token — a second, inconsistent "danger button" now exists alongside the real one. (2) Suspend/reactivate and grant/revoke-admin are high-impact account actions triggerable with a single click and no confirmation step — no shared Dialog/Modal primitive exists yet to build one from. (3) Credits section disappears entirely rather than empty-stating, inconsistent with the two sibling sections on the same page.
- **Recommended redesign scope:** Medium — the most content-dense, most action-heavy page in the area; benefits most from Card/Select/Button reuse plus a confirm-before-destructive-action pattern.

## 3. UI Elements Per Page

### /admin/agreement
- buttons: `SubmitButton` (shared, "שמירה" / "אישור והסרת טיוטה" / "עדכון אישור") ×2 default; `SubmitButton` with destructive-tint override className ("שחזור לתבנית") ×1; `HelpTip` trigger buttons (local, unstyled icon buttons) ×10 (3 in agreement-client.tsx — version, body_html, approve-version — + 7 in agreement-config-form.tsx, one per config field; verified by grep count, not the ×8 an earlier pass estimated)
- inputs / selects / search / filters: raw `<input type="text">` ×2 (version fields), raw `<textarea>` ×1 (body_html), raw `<input type="text">` ×7 (config values) — all inline/local; the 9 `<input>`s don't use the existing `@/components/ui/input` primitive, only the `<textarea>` genuinely has none to reuse
- cards / tables / lists: 3 hand-rolled `sectionClass` card `<section>`s; TOKENS list rendered as inline `<code>` chips (inline/local)
- badges / status chips: shared `Badge` ×3 (status/version/template — always neutral variant)
- dropdown menus / dialogs / sheets: Base UI `Popover` ×10 (via local `HelpTip`, `@base-ui/react/popover`)
- empty / loading / error UI: shared `FormError`/`FormNotice`/`FieldError` per form; no page-level empty state
- destructive actions: "שחזור לתבנית" (revert to default template) — styled via ad-hoc `bg-destructive/10 text-destructive` className on `SubmitButton`, no confirmation step

### /admin/company
- buttons: `SubmitButton` (shared) ×1
- inputs / selects / search / filters: raw `<input>` ×7 (text/tel/email/url types), raw `<textarea>` ×1 — all inline/local via a page-local `Field` helper
- cards / tables / lists: 1 hand-rolled `sectionClass` card
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: shared `FormError`/`FormNotice`/`FieldError`
- destructive actions: none

### /admin/settings
- buttons: `SubmitButton` (shared) ×1; local "ערוך"/"הצג" toggle `<button type="button">`s ×14 (verified by grep: 10 `EditableField` instances, each with an "ערוך" edit toggle = 10, plus 4 of those 10 pass `maskable` — `sumit_api_public_key`, `sumit_api_key`, `extra_sms_token`, `smtp_password` — each adding a "הצג" reveal toggle = 4; 10+4=14)
- inputs / selects / search / filters: raw `<input>` ×10 (text/password-toggle/numeric, verified by `EditableField` call count), raw `<input type="checkbox">` ×4 (payments/sms/email/smtp_secure toggles, hand-rolled instead of shared `ui/switch`) — all inline/local via local `EditableField`
- cards / tables / lists: 2 hand-rolled `sectionClass` cards; infra status `<ul>` list (not a table)
- badges / status chips: infra "מוגדר"/"חסר" rows — hand-rolled icon+text, NOT the shared `Badge`, hardcoded green-700/red-700
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: shared `FormError`/`FormNotice`/`FieldError`
- destructive actions: none (this page enables/disables integrations but has no delete/revoke action)

### /admin/sumit-test
- buttons: raw `<button type="submit">` ×2 (hand-styled to mimic `Button` default variant) — not shared `SubmitButton`/`Button`
- inputs / selects / search / filters: raw `<select>` ×1 (auto_capture), raw `<input>` ×~15 across both forms, raw `<input type="checkbox">` ×2 — all inline/local
- cards / tables / lists: 2 hand-rolled `border border-border` form wrappers (not even the local `sectionClass` pattern used elsewhere)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none (uses `next/script` for 3rd-party script loading, not a UI primitive)
- empty / loading / error UI: hand-rolled amber "live/dangerous" banner; hand-rolled red `loadError`/`.og-errors` alert; "טוען…"/"שולח…" button-label states
- destructive actions: both submits trigger a real live SUMIT charge — no confirmation step beyond the static warning banner

### /admin/users
- buttons: hand-rolled `<button type="submit">` ×1 (search) — not shared `SubmitButton`
- inputs / selects / search / filters: raw `<input type="search">` ×1 — inline/local
- cards / tables / lists: `<ul>`/`<li>` user list (inline/local); shared `Pagination`
- badges / status chips: shared `Badge` ×up to 3 per row (admin / suspended / org-count) — always neutral variant
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: shared `EmptyState`
- destructive actions: none on this page (navigates to detail for mutations)

### /admin/users/[id]
- buttons: local `RowSubmit` (hand-rolled `useFormStatus` button, `default`/`danger` style) ×4; back-link `<Link>` styled as text
- inputs / selects / search / filters: raw `<select>` ×3 (credit-event, plan-order, plan-package), raw `<input>` ×2 (credit-amount, credit-reason), hidden `<input type="hidden">` ×2 (user_id) — all inline/local
- cards / tables / lists: 5 hand-rolled `sectionClass` cards (2 in page.tsx's info sections + 3 in UserActions); 3 `divide-y` `<ul>`/`<li>` lists (orgs/orders/credits)
- badges / status chips: shared `Badge` — profile (admin/suspended), org role, order status — always neutral variant
- dropdown menus / dialogs / sheets: none (no confirm dialog on destructive actions — primitive doesn't exist yet)
- empty / loading / error UI: inline "אין X." text for orgs/orders (not shared `EmptyState`); credits section omitted entirely when empty; `FormError`/`FormNotice` per action
- destructive actions: revoke-admin, suspend-user — both single-click via `RowSubmit variant="danger"`, no confirmation dialog

## 4. Responsive & RTL Findings

### /admin/agreement: mobile-fit = yes; wide areas: none (config grid correctly `sm:grid-cols-2`); RTL risks: none found — version/HTML/numeric fields intentionally `dir="ltr"`, one popover uses hardcoded `text-right` instead of `text-start` (harmless since that element also hardcodes `dir="rtl"`, but inconsistent with logical-property convention).

### /admin/company: mobile-fit = yes; wide areas: none; RTL risks: tel/email/url fields have no `dir` override — Needs verification whether that reads awkwardly (unlike version/numeric fields elsewhere in the area, which do force `dir="ltr"`).

### /admin/settings: mobile-fit = yes (all fields single-column, no grid); wide areas: single-column form runs the full shell width with no `max-w` cap, longer line-length than other pages in the area on large screens (readability, not overflow); RTL risks: no field forces `dir` despite host/port/from being inherently LTR-shaped, inconsistent with the rest of the area.

### /admin/sumit-test: mobile-fit = **no** — Form A's parameter grid (`grid-cols-2 gap-4`, unconditional) and Form B's exp/citizen-id row (`grid-cols-3 gap-4`, unconditional) do not collapse to 1 column under `sm:`, unlike every other multi-column grid in this area; concrete squeeze risk at ~360px. wide areas: both forms capped `max-w-xl`, no overflow-x wrapper present (none needed — no wide tables). RTL risks: none — card/date/citizenid fields correctly forced `dir="ltr"`.

### /admin/users: mobile-fit = yes; wide areas: none; RTL risks: none — email correctly forced `dir="ltr"` in row and search input.

### /admin/users/[id]: mobile-fit = yes (`dl` and form grids correctly gated behind `sm:`); wide areas: none; RTL risks: none found — email/phone correctly `dir="ltr"`; currency values unverified visually but backed by `Intl.NumberFormat('he-IL', ...)`.

## 5. Duplications & Extract Candidates
- Hand-rolled card wrapper `'space-y-3/4 rounded-lg border border-border bg-card p-5'` → seen in agreement/page.tsx, agreement/agreement-client.tsx (×3 sections), company/page.tsx, settings/page.tsx (×2), users/[id]/page.tsx (×2), users/[id]/user-actions.tsx (×3) → suggest replacing with the existing (but unused-in-this-area) `@/components/ui/card` `Card`/`CardHeader`/`CardContent`.
- Hand-rolled native `<input>`/`<textarea>` with a locally duplicated `inputClass` string → seen in **all 6 routes** in this area (agreement ×9, company ×7, settings ×10, sumit-test ×~15, users ×1, users/[id] ×2) → `@/components/ui/input` already exists as a shared primitive (confirmed by reading `src/components/ui/input.tsx`) and is used **nowhere** in this area — this is the single largest reuse gap found, larger than the card-wrapper one above. (`Textarea`/`Label` are the two pieces genuinely absent from `@/components/ui/*`, per the known-components list.)
- Local `Field`/`EditableField` (label + input + hint + `FieldError`) helper → re-implemented separately in company-form.tsx, agreement-config-form.tsx, settings-form.tsx, and inline (not even factored into a helper) in user-actions.tsx → suggest one shared `<FormField>`/`<TextInput>` component wrapping the existing `Input` primitive (see the `Input`-reuse finding above — the primitive exists, only the labeled-field wrapper around it doesn't).
- Raw `<select>` for choosing an entity (event/order/package/auto_capture) → seen in user-actions.tsx (×3) and sumit-test-form.tsx (×1) → suggest `@/components/ui/select`, which already exists as a shared primitive but is unused across this entire area.
- `useFormStatus`-driven submit button with pending/disabled state → shared `SubmitButton` already exists and is used on 4 of 6 pages, but user-actions.tsx re-implements it locally as `RowSubmit` (plus a non-token `danger` style) and sumit-test-form.tsx re-implements it again as two raw `<button>`s → suggest consolidating all three onto `SubmitButton`, extending it with a `variant` prop if the inline/row use case needs non-full-width or destructive styling.
- Hand-rolled warning/error banners (`bg-amber-50 text-amber-800`, `bg-red-50 text-red-700`) → seen in sumit-test/page.tsx (×1), sumit-test-form.tsx (×2), settings/page.tsx (infra status rows, ad-hoc not banner-shaped) → suggest a shared `Alert`/`Banner` primitive (confirmed absent from `@/components/ui/*`), which would also let `FormError`/`FormNotice` be reused as its content.
- "divide-y list of label + trailing Badge/value" rows → seen in users/[id]/page.tsx (×3: orgs, orders, credits) and users/page.tsx (list rows, similar shape) → suggest a shared `<DetailList>`/`<ListRow>` (lower priority than the above).

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: none of `card`, `select`, `switch`, `button`, **or `input`** are imported anywhere in this area's 13 files, despite all five existing as shared primitives (`button` is used only transitively, inside the shared `SubmitButton`).
- from `@/components`: `forms.tsx` → `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (used on 4 of 6 pages: agreement, company, settings, users/[id] — NOT sumit-test).
- from `@base-ui/react/popover`: used once, wrapped locally as `HelpTip` (agreement route only).
- inline/local components defined in this area:
  - `src/app/(admin)/admin/agreement/help-tip.tsx` → `HelpTip`, a reusable "?" popover, local to the agreement route.
  - `src/app/(admin)/admin/agreement/agreement-client.tsx` → local unnamed `inputClass`/`sectionClass` constants, no exported sub-component.
  - `src/app/(admin)/admin/agreement/agreement-config-form.tsx` → local `Field` helper.
  - `src/app/(admin)/admin/company/company-form.tsx` → local `Field` helper (independent re-implementation of the one above).
  - `src/app/(admin)/admin/settings/settings-form.tsx` → local `EditableField` (mask/reveal + edit-lock variant of the same pattern).
  - `src/app/(admin)/admin/sumit-test/sumit-test-form.tsx` → no extracted helpers; every field fully inline.
  - `src/app/(admin)/admin/users/[id]/user-actions.tsx` → local `RowSubmit` (re-implementation of `SubmitButton`'s pending/disabled logic, plus a `danger` variant).
  - `src/app/(admin)/admin/_components.tsx` (shared across all `/admin/*`, not owned by this area but consumed by all 6 pages) → `PageHeading`, `EmptyState`, `Badge` (with `neutral`/`success`/`warning`/`info`/`destructive` variants — only `neutral` is ever used in this area), `Pagination`, `parsePageParam`, `firstParam`, `formatCurrency`, `formatDateTime`.
