# KALFA — Page Design Briefs

> One uniform brief per page, ready to hand to a designer for a mockup / redesign request.
> 20 fields per page (route, purpose, goals, sections, actions, forms, tables, states, shared/reuse/extract components, mobile/desktop/RTL notes, risks, recommended scope).
> Produced by the design-audit team (2026-07-08). Companion: `page-inventory.md`, `ui-component-inventory.md`, `reusable-components-plan.md`, `responsive-rtl-audit.md`.

**Scope note:** colors are intentionally out of scope for this audit — briefs describe structure, components, states, and layout, not palette.


---

## Public + Root

### `/`
- **Route:** `/` (`src/app/(public)/page.tsx`)
- **Page name:** דף הבית / Marketing landing page
- **Component type:** Server (async, calls `getUser()` server-side; no `'use client'`)
- **Shell/Layout:** Root-only — owns its full header/footer, no AppShell/AdminShell
- **Current purpose:** Public marketing/sales page for KALFA; converts visitors to signup, or routes signed-in users to `/app`
- **Primary user goal:** Understand the product and start (sign up) or continue (go to dashboard)
- **Main content sections:** sticky header w/ nav+CTA · Hero w/ live dashboard-preview mock · Problem/Solution split · Features grid (7 cards + 1 CTA card) · "How it works" 6-step grid · Trust section (dark) · Audiences grid · Closing CTA banner · Footer (4-col + legal line)
- **Actions:** primary CTA `startHref` (`/app` if signed in else `/auth/signup`), `/auth/login`, in-page anchor nav (`#features`, `#how`, `#trust`), secondary "צפו בהדגמה קצרה" anchor to `#how`
- **Forms / fields:** — (no forms; all links)
- **Tables / lists:** none (feature/step/trust/audience arrays rendered as card grids, not `<table>`)
- **Status states:** n/a (marketing copy only — the "248 אישרו / 63 ממתינים / 82%" stat blocks and guest-status chips in the hero mock are **hardcoded fake preview data**, not live)
- **Empty / loading / error states:** none — no `loading.tsx`/`error.tsx` in `(public)/`; page has no async failure surface beyond `getUser()`
- **Existing shared components used:** none from `@/components/ui/*` or `@/components/*` — every element (header, buttons, cards) is hand-rolled inline in this file; only `lucide-react` icons and `next/link`
- **Components that should be reused:** all CTA `<Link>` buttons here duplicate `ui/button` styling (`rounded-md bg-primary px-… text-primary-foreground hover:opacity-90`) by hand instead of importing `Button` with `variant="default"`/`"outline"`; the header "כניסה" link duplicates the `ghost`/`link` variant
- **Components that should be extracted:** `Eyebrow` (local helper, fine as-is); the 4 card grids (Features/Steps/Trust/Audiences) share one visual pattern (icon-badge + title + description in a bordered rounded card) that could become a shared `IconFeatureCard`; the guest-status "pill" (`rounded-full px-2.5 py-1 text-xs font-semibold` + color class) in the hero mock is the same shape as the real Badge/status-chip gap noted for the app shell — an extract candidate once a real `Badge` primitive exists
- **Mobile considerations:** grids collapse via `sm:grid-cols-2 lg:grid-cols-3` etc. (mobile = 1 col by default); hero is `grid lg:grid-cols-2` so mobile stacks hero copy above the dashboard-preview card; nav (`#features`/`#how`/`#trust`) is `hidden md:flex` — **no mobile menu/hamburger fallback**, so those anchor links are simply unreachable on mobile (only the CTA button remains); header user email is `hidden … sm:inline`
- **Desktop considerations:** `max-w-6xl` container throughout; hover states (`hover:-translate-y-1 hover:shadow-md`) assume pointer input
- **RTL considerations:** uses logical `gap`/`grid` almost throughout; `ArrowLeft` icon used as the "forward" chevron for CTAs which is correct for RTL (points toward reading-start); ← arrow literal in nothing here (unlike `_legal.tsx`); no `ml-`/`mr-`/`left-`/`right-` physical classes found in this file — clean
- **Design risks:** (1) nav items unreachable on mobile (no menu button) — real UX gap, not just an audit nitpick; (2) all buttons/cards are inline-styled duplicates of `ui/button`/would-be `ui/card`, so any future brand/token change must be hand-edited in this one 470-line file; (3) hardcoded fake stats in the hero preview (248/63/82%) are static and never change — fine for marketing but worth flagging as intentional
- **Recommended redesign scope:** Light — content/IA is solid; mainly extract buttons to `Button`, add a mobile nav affordance, and consider `IconFeatureCard`

### `/privacy`
- **Route:** `/privacy` (`src/app/(public)/privacy/page.tsx`)
- **Page name:** מדיניות פרטיות / Privacy Policy
- **Component type:** Server (`export const dynamic = 'force-dynamic'`, async, reads `getCompanyLegal()`)
- **Shell/Layout:** Root-only, wrapped by shared `LegalShell` from `../_legal.tsx`
- **Current purpose:** Statutory privacy policy, DRAFT pending lawyer review (per in-code comment)
- **Primary user goal:** Read privacy terms
- **Main content sections:** `LegalShell` header (back-to-home link, title, "updated" date, draft-warning banner, company footer) + 11 `LegalSection` blocks (general, data collected, purposes, legal basis, sub-processors, security, retention, rights, §30א direct-marketing, cookies, changes)
- **Actions:** "← לדף הבית" back link (top of `LegalShell`)
- **Forms / fields:** —
- **Tables / lists:** one `<ul className="list-disc …">` (data-collected bullet list); rest is prose `<p>`
- **Status states:** n/a
- **Empty / loading / error states:** none present; no `loading.tsx`/`error.tsx`; `getCompanyLegal()` failure is unhandled at this layer (Needs verification whether it can throw)
- **Existing shared components used:** `LegalShell`, `LegalSection` (local/shared to this route group, not `@/components/*`)
- **Components that should be reused:** none obviously missing — this is prose content
- **Components that should be extracted:** the amber "draft — pending lawyer review" banner (`role="note"`, `bg-amber-50 text-amber-800`) is duplicated verbatim in `/terms` via the shared `LegalShell` (good — already extracted, no action needed) — noted here as an example of correct reuse
- **Mobile considerations:** `max-w-3xl` single column, no grids/tables — should read fine at 360px; long lines are just prose, no fixed widths found
- **Desktop considerations:** capped at `max-w-3xl` (narrower than the `max-w-6xl` landing page — appropriate for a reading page)
- **RTL considerations:** the back link uses a literal `←` character (`← לדף הבית`) instead of a `lucide-react` arrow icon with a logical direction — this is a **physical/directional glyph baked into the text string**; visually it still points "start" in RTL by luck of the glyph, but it's not using the `ArrowLeft`-icon pattern used elsewhere (e.g. landing page CTAs) — inconsistent, not necessarily broken
- **Design risks:** page explicitly marked DRAFT/pending legal sign-off in both the code comment and the on-page banner — content-completeness risk, not a UI risk
- **Recommended redesign scope:** None — plain content page, structurally sound

### `/terms`
- **Route:** `/terms` (`src/app/(public)/terms/page.tsx`)
- **Page name:** תקנון ותנאי שירות / Terms of Service
- **Component type:** Server (`export const dynamic = 'force-dynamic'`, async, reads `getCompanyLegal()`)
- **Shell/Layout:** Root-only, wrapped by shared `LegalShell`
- **Current purpose:** Statutory terms of service (pricing model, cancellation rights, liability), DRAFT pending lawyer review
- **Primary user goal:** Read terms, understand billing/cancellation rules
- **Main content sections:** `LegalShell` header + 11 `LegalSection` blocks (definitions, service description, outcome-based pricing, campaign approval/agreement, 14-day cancellation right, warranty [dynamic from `company.warrantyText`], liability limits, client responsibility for guest data legality, IP, governing law, changes)
- **Actions:** "← לדף הבית" back link
- **Forms / fields:** —
- **Tables / lists:** none — all prose `<p>`
- **Status states:** n/a
- **Empty / loading / error states:** none present; same as `/privacy`
- **Existing shared components used:** `LegalShell`, `LegalSection`
- **Components that should be reused:** none
- **Components that should be extracted:** n/a (see `/privacy`)
- **Mobile considerations:** same `max-w-3xl` single-column prose layout as `/privacy` — fits mobile fine
- **Desktop considerations:** same as `/privacy`
- **RTL considerations:** same literal `←` back-link glyph as `/privacy` (comes from the shared `LegalShell`, so it's one occurrence in code affecting both pages)
- **Design risks:** DRAFT/pending legal sign-off (explicit in code + banner); section 6 (warranty) interpolates `company.warrantyText` from admin config with a hardcoded Hebrew fallback if empty — content-integrity risk if that field is left blank in prod, not a UI risk
- **Recommended redesign scope:** None

### `/join/[token]`
- **Route:** `/join/[token]` (`src/app/(public)/join/[token]/page.tsx`)
- **Page name:** הצטרפות לצוות / Org invitation acceptance
- **Component type:** Server (async; `redirect()` if unauthenticated)
- **Shell/Layout:** Root-only — bare `<main>` with no header/footer at all (not even the landing page's header)
- **Current purpose:** Let a logged-in user accept a pending org-membership invitation via an opaque token
- **Primary user goal:** Confirm joining the organization named in the invite
- **Main content sections:** single centered card: `<h1>` + either an invalid-token error message, or an org-name confirmation line + one confirm button
- **Actions:** single "הצטרפות" submit button (Server Action `acceptInvitationAction`); "חזרה לאזור האישי" link on the invalid-token branch
- **Forms / fields:** one hidden field (`token`) + submit; no visible/editable inputs — "Forms / fields: — (token passthrough only, no user-entered fields)"
- **Tables / lists:** none
- **Status states:** implicit two states — valid preview (`preview` truthy) vs invalid/expired/used (`preview` null); an `?error=1` query param renders a second inline error banner ("ההצטרפות נכשלה")
- **Empty / loading / error states:** no `loading.tsx`/`error.tsx` file; error states are inline conditional JSX (`role="alert"`, red banners) for (a) invalid/expired/used token and (b) accept-action failure; both messages are deliberately generic (privacy-safe, per code comment — never reveals *why* a token failed)
- **Existing shared components used:** none — `<button>`/`<form>` are hand-rolled, not `SubmitButton`/`Button`; no pending/disabled-while-submitting state on this button (unlike `SubmitButton`, which wires `useFormStatus`)
- **Components that should be reused:** the submit button should be `SubmitButton` from `@/components/forms` (gets `useFormStatus` pending state + shared `Button` styling for free) instead of a bare `<button className="w-full rounded-md bg-primary …">`; the error banners duplicate the `role="alert" bg-red-50 text-red-700` pattern seen identically in `/r/[token]/page.tsx` (`Shell`'s "invalid token" message) — same exact class string in two files
- **Components that should be extracted:** a generic `<ErrorBanner role="alert">` / `<Alert variant="destructive">` primitive — this exact `rounded-md bg-red-50 px-3 py-2 text-sm text-red-700` pattern recurs in `/join/[token]/page.tsx` (×2) and `/r/[token]/page.tsx` (×1, plus an amber variant for rate-limit)
- **Mobile considerations:** `max-w-md` single column, centered vertically (`min-h-svh flex flex-col justify-center`) — mobile-first by construction, good fit for a link-opened page
- **Desktop considerations:** same `max-w-md` card centers on a wide viewport with empty space either side — acceptable for a single-action utility page
- **RTL considerations:** no physical-direction classes found; gap/space-y logical utilities throughout
- **Design risks:** submit button has no pending-state feedback (double-submit risk on slow networks) since it bypasses `SubmitButton`; otherwise low risk — this is a narrow, low-traffic utility page
- **Recommended redesign scope:** Light — swap in `SubmitButton`, extract the alert-banner pattern

### `/r/[token]`
- **Route:** `/r/[token]` (`src/app/(public)/r/[token]/page.tsx` + `rsvp-form.tsx` Client Component + `actions.ts` Server Action)
- **Page name:** אישור הגעה / Public guest RSVP
- **Component type:** Server (`page.tsx`) rendering a Client Component (`rsvp-form.tsx`, `'use client'`, uses `useActionState`/`useState`)
- **Shell/Layout:** Root-only — bare `<main>` (`Shell` helper) with no header/footer/nav; fully self-contained, mobile-first, single-column
- **Current purpose:** The guest-facing surface: validate an opaque RSVP token server-side, show event details, collect an attending/maybe/declined response + headcount + optional meal pref/custom questions/note, submit atomically via a DB RPC (`submit_rsvp`)
- **Primary user goal:** Tell the host whether they're coming, how many, and any special requests, in under a minute on a phone
- **Main content sections:** optional invite-image hero (signed URL, private bucket) → header (guest greeting, event heading w/ type icon, subtitle, Hebrew+Gregorian date line, venue name/address, Waze nav link) → RSVP form (attending/maybe/declined 3-button toggle, conditional headcount steppers + meal-pref field when attending, dynamic custom questions, free-text note, success/error banner) → optional gift-link CTA (bit/PayBox branded button)
- **Actions:** rate-limited page read (`RSVP_READ_RATE` = 30/min per token+IP) and submit (`RSVP_SUBMIT_RATE` = 5/min per token+IP); status toggle buttons (attending/maybe/declined); adult/kid +/− steppers; submit form (`submitRsvpAction`, a `'use server'` action bound to the URL token — **the browser never supplies a guest identifier**, per code comment); external Waze deep-link; external gift-payment deep-link (`/g/[token]` redirect route)
- **Forms / fields:** `status` (hidden, radio-like via 3 buttons; required, values `attending|maybe|declined`), `adults`/`kids` (hidden numeric, stepper-controlled, combined capped at `guest.expected_count ?? 50`), `meal_pref` (text, maxLength 120, shown only if `event.show_meal_pref !== false`), dynamic `answer_<q_key>` fields per event-defined question (select or text, `required` per question, options from event config), `note` (textarea, maxLength 500). Server-side re-validated via `rsvpSubmitSchema` (Zod) then the `submit_rsvp` RPC (which the code comments say performs "all authorization, gating, atomicity")
- **Tables / lists:** none — no `<table>`; dynamic questions render as a stacked list of label+input pairs
- **Status states:** `RSVP_STATUSES = ['attending', 'declined', 'maybe']` (from `src/lib/constants.ts:56`) — Hebrew labels "מגיע/ה" / "אולי" / "לא מגיע/ה"; plus page-level gate states: rate-limited, invalid/unknown/expired/revoked token (one generic message, intentionally not distinguished — privacy-by-design per code comment), `canRespond === false` (deadline passed — amber notice, form hidden entirely), submit success (green "PartyPopper" notice, re-editable), submit failure (red `FormError`, reason-coded but user-safe messages e.g. "המועד האחרון לאישור הגעה חלף")
- **Empty / loading / error states:** no `loading.tsx`/`error.tsx` files for this route; all states are inline conditional JSX branches in `page.tsx` (rate-limited / invalid-token) and in `rsvp-form.tsx` (deadline-passed / success / field errors); `export const dynamic = 'force-dynamic'` — the response is guest-specific and explicitly never cached (comment cites no-store headers set in `next.config`)
- **Existing shared components used:** `FieldError`, `FormError`, `SubmitButton` from `@/components/forms` (shared, correctly reused); `next/image` for the invite hero and gift-brand icons; `lucide-react` icons (`Gift`, `Navigation`, `PartyPopper`)
- **Components that should be reused:** the attending/maybe/declined selector buttons and the +/− `Stepper` buttons are fully hand-rolled (not `ui/button`) — reasonable given their unusual toggle/stepper semantics, but the color/border logic (`border-primary bg-primary text-primary-foreground` selected vs `border-input bg-background hover:bg-muted` unselected) duplicates a segmented-control pattern that doesn't exist as a primitive; the invalid-token/rate-limit banners in `page.tsx` (`role="alert"`/`role="status"`, `bg-red-50`/`bg-amber-50`) duplicate the same pattern flagged in `/join/[token]`
- **Components that should be extracted:** (1) a shared `Alert`/`Banner` primitive (destructive/warning/success variants) — this file alone has 4 distinct inline banner instances (rate-limit amber, invalid-token red, deadline-passed amber, success green) each with hand-written Tailwind; (2) `Stepper` (already a well-factored local component in this file, ~50 lines, `role="group"` + `aria-live` — good accessibility groundwork) is a strong candidate to promote to `@/components/ui` if headcount-style steppers appear elsewhere; (3) a `SegmentedToggle`/`ButtonGroup` for the 3-way status selector
- **Mobile considerations:** `max-w-md` single column, `min-h-svh flex flex-col justify-center` — explicitly mobile-first (this is the guest-facing link opened mostly on phones); steppers use `h-9 w-9` touch targets (36px — below the commonly-cited 44px minimum, worth flagging); invite image uses `next/image` with explicit `width={448} height={560}` and `className="h-auto w-full …"` so it scales down correctly
- **Desktop considerations:** same `max-w-md` card, centers with empty space on wide viewports — appropriate, this page is never meant to be a desktop dashboard
- **RTL considerations:** no physical-direction utility classes found (uses `gap`, gap gap, `justify-center`, `ps-`/logical patterns elsewhere in the codebase); the Waze external link and gift-brand link both use `target="_blank" rel="noreferrer|noopener noreferrer"` correctly; icons (`Navigation`, `Gift`, `PartyPopper`) are decorative/`aria-hidden` and don't encode directionality issues; date formatting is explicitly pinned to `ISRAEL_TIME_ZONE`/`ISRAEL_LOCALE` regardless of guest device locale (correct per the in-file comment — a guest opening the link abroad must still see Israel-local date)
- **Design risks:** (1) stepper touch targets at 36px are under the 44px a11y guideline for a page whose whole audience is mobile; (2) four different hand-rolled alert-banner variants with no shared component — highest duplication risk in the whole public area; (3) the page is otherwise carefully engineered for privacy (generic error messages, rate limiting, signed URLs, server-only token binding) — no security concerns found in this read, consistent with CLAUDE.md's Public RSVP Security section
- **Recommended redesign scope:** Medium — this is the most-trafficked, most guest-visible page in the product; worth a dedicated `Alert` primitive + segmented-toggle/stepper token pass, done carefully since it's security- and conversion-sensitive


---

## Auth

### /auth/login
- **Route:** `/auth/login`
- **Page name:** התחברות / Login
- **Component type:** Server (page.tsx has no `'use client'`; renders client `<LoginForm>`)
- **Shell/Layout:** Root-only — `<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">`
- **Current purpose:** Authenticate an existing user by email + password.
- **Primary user goal:** Get into `/app` as fast as possible.
- **Main content sections:** Centered title+subtitle block → form → "no account? sign up" link.
- **Actions:** Submit (login), link to `/auth/forgot-password`, link to `/auth/signup`.
- **Forms / fields:** `email` (type=email, required, `autoComplete="email"`; server: `emailField` = trim + `z.email()`); `password` (via `PasswordInput`, required, `autoComplete="current-password"`; server: `z.string().min(1)` — no strength/length rule on login, correctly, since it's just credential entry).
- **Tables / lists:** None.
- **Status states:** None (no account-state UI on this page).
- **Empty / loading / error states:** No file-based loading/error. `FormError` shows a single generic string `'אימייל או סיסמה שגויים'` (deliberately not field-specific — no enumeration). `SubmitButton` shows `רגע…` and disables while pending (via `useFormStatus`).
- **Existing shared components used:** shared `FieldError`, `FormError`, `SubmitButton` (`@/components/forms`), shared `PasswordInput` (`@/components/password-input`); `ui` Button indirectly (inside `SubmitButton`).
- **Components that should be reused:** Raw `<input>` for email is hand-rolled inline (`w-full rounded-md border border-border bg-transparent px-3 py-2`) — no shared `Input`/`Label` primitive exists in the codebase per the known-primitives list, so this is the established pattern, not a local deviation. Flag at the audit level (§5), not as a login-specific defect.
- **Components that should be extracted:** The whole auth-card shell (`<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">` + centered title/subtitle block) is byte-for-byte repeated across all 6 rendering pages (login, signup, forgot-password, reset-password, confirm all use the identical `max-w-md` centered-column wrapper; signup/success uses a variant with `text-center` added). See §5.
- **Mobile considerations:** `max-w-md` + `px-6` fits a 360px viewport with no overflow risk; `min-h-dvh` centers vertically avoiding iOS viewport-unit issues.
- **Desktop considerations:** Card stays narrow/centered on wide screens — no `max-w` cap issue, intentional (auth forms shouldn't stretch).
- **RTL considerations:** No physical-direction classes found (`text-end`/`ms-`/`me-` used correctly, e.g. `mt-1 text-end` on the "forgot password" link). Email `<input>` has no explicit `dir` — Hebrew UI convention leaves email LTR-neutral by browser default; compare signup below which explicitly sets `dir="ltr"` on email — **inconsistency**, see §5.
- **Design risks:** None major. Minor: email input lacks `dir="ltr"` that signup's equivalent field has (cosmetic RTL caret/alignment inconsistency for a Latin-script value).
- **Recommended redesign scope:** Light (mainly: extract shared `AuthCard` wrapper; align `dir="ltr"` on email input with signup).

### /auth/signup
- **Route:** `/auth/signup`
- **Page name:** הרשמה / Sign up
- **Component type:** Server (page.tsx; renders client `<SignupForm>`)
- **Shell/Layout:** Root-only — identical `max-w-md` centered wrapper as login.
- **Current purpose:** Create a new account (email/password + profile fields).
- **Primary user goal:** Register and reach the "check your email" step.
- **Main content sections:** Title/subtitle → form → "already have an account? log in" link.
- **Actions:** Submit (signup), link to `/auth/login`.
- **Forms / fields:** `full_name` (text, required, `autoComplete="name"`; server: trim, min 1, max `PROFILE_NAME_MAX`); `email` (type=email, required, `dir="ltr"`; server: `emailField`); `phone` (type=tel, optional, `dir="ltr"`; server: optional, validated against `ISRAELI_PHONE_RE` when non-empty); `password` (via `PasswordField` → `PasswordInput`, required, `autoComplete="new-password"`, live strength meter; server: `newPasswordField` = min 8 / max 72).
- **Tables / lists:** None.
- **Status states:** None.
- **Empty / loading / error states:** `FormError` for generic failure (`'ההרשמה נכשלה...'` or `'כתובת המייל כבר רשומה...'` — enumeration-safe wording that still discloses existing accounts on this specific path, per `isExistingUserSignup` check in `../actions.ts`); `FormNotice` slot exists in the JSX but the `signup` action never returns a `notice` (it always redirects on success) — dead prop / always null in practice. `SubmitButton` pending state as above.
- **Existing shared components used:** shared `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`); local `PasswordField` (co-located, wraps shared `PasswordInput` + `@/lib/password-strength`).
- **Components that should be reused:** Same raw `<input>` pattern as login (established, not a defect). `PasswordField`'s strength meter is signup-only — `reset-password-form.tsx` sets a new password too but has no strength meter (inconsistent UX, not a missing shared component since the meter logic itself IS already factored into `PasswordField`/`password-strength.ts` and could be reused as-is).
- **Components that should be extracted:** Same `AuthCard` wrapper duplication as login. Also see §5 for the strength-meter reuse gap.
- **Mobile considerations:** Same `max-w-md`/`px-6` container — fits 360px. Four stacked fields + meter fit without horizontal scroll.
- **Desktop considerations:** Same narrow centered card, no desktop-specific layout.
- **RTL considerations:** Email/phone correctly forced `dir="ltr"` (Latin/digit content) while full_name stays RTL-default (Hebrew names) — this is the more complete pattern; login's email field should match it (see login brief). No physical-direction classes found.
- **Design risks:** `FormNotice` is imported/rendered but unreachable given current `signup` action logic — dead code path, low risk but worth a follow-up cleanup note. Password-strength UX asymmetry between signup and reset-password.
- **Recommended redesign scope:** Light (extract `AuthCard`; consider reusing `PasswordField`'s meter in reset-password for consistency).

### /auth/signup/success
- **Route:** `/auth/signup/success`
- **Page name:** ההרשמה הצליחה! / Signup successful
- **Component type:** Server
- **Shell/Layout:** Root-only — `max-w-md` centered wrapper, `text-center` variant (same base pattern as the auth-card, with an added icon badge).
- **Current purpose:** Post-signup interstitial instructing the user to confirm via email.
- **Primary user goal:** Understand next step (check email) without being stuck on a blank success page.
- **Main content sections:** Icon badge (`MailCheck` in a circular `bg-primary/10` chip) → title → 3-paragraph explanatory text block → two CTA links.
- **Actions:** "מעבר להתחברות" (go to login) — styled as a hand-rolled primary button; "הרשמה מחדש" (sign up again) — plain text link.
- **Forms / fields:** — (no form; interstitial only)
- **Tables / lists:** None.
- **Status states:** None (this page itself IS a success/status state for the signup flow).
- **Empty / loading / error states:** N/A — static content, no data fetch.
- **Existing shared components used:** None from `@/components/ui` or `@/components/*` — the "go to login" CTA is a hand-rolled `<Link>` styled as a button (`rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90`) rather than the shared `Button` (`asChild`) or `SubmitButton` pattern used everywhere else in this area.
- **Components that should be reused:** The primary-CTA `<Link>` should use `@/components/ui/button`'s `Button` with `asChild` (shadcn/Base UI pattern) instead of duplicating Button's visual styling inline — this is the one page in the area that doesn't route its primary action through the shared `Button`.
- **Components that should be extracted:** Icon-badge success pattern (`grid size-14 place-items-center rounded-full bg-primary/10 text-primary` wrapping a lucide icon) — check whether other "success" interstitials elsewhere in the app repeat this; Needs verification (out of this area's file set).
- **Mobile considerations:** `max-w-md`/`px-6`, text-center — fits 360px fine; three paragraphs of body copy wrap normally.
- **Desktop considerations:** No desktop-specific layout; narrow card as with other auth pages.
- **RTL considerations:** No physical-direction classes; icon has `aria-hidden`, fine for RTL. No issues found.
- **Design risks:** Style drift — this is the only auth page whose CTA doesn't use the shared `Button` component, so any future Button style/behavior change (focus ring, disabled state, size scale) will silently miss this page.
- **Recommended redesign scope:** Light (swap hand-rolled CTA `<Link>` for `Button asChild`; otherwise fine).

### /auth/forgot-password
- **Route:** `/auth/forgot-password`
- **Page name:** איפוס סיסמה / Forgot password
- **Component type:** Server (renders client `<ForgotPasswordForm>`)
- **Shell/Layout:** Root-only — identical `max-w-md` centered wrapper.
- **Current purpose:** Request a password-reset email for a given address.
- **Primary user goal:** Trigger a reset email without needing to know if the account exists.
- **Main content sections:** Title/subtitle (explains the flow) → form → "remembered your password? back to login" link.
- **Actions:** Submit (request reset), link to `/auth/login`.
- **Forms / fields:** `email` (type=email, required, `autoComplete="email"`, no explicit `dir`; server: `forgotPasswordSchema` = `{ email: emailField }`).
- **Tables / lists:** None.
- **Status states:** None.
- **Empty / loading / error states:** `FormError` for `'שליחת קישור האיפוס נכשלה...'`; `FormNotice` for the enumeration-safe success message (`'אם קיים חשבון עם כתובת זו...'`) — this is the one form in the area where `FormNotice` is actually reachable (matches the `requestPasswordReset` action in `../actions.ts`, which always returns a notice on the non-error path rather than redirecting).
- **Existing shared components used:** shared `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`).
- **Components that should be reused:** Same raw `<input>` pattern (established, not local-only).
- **Components that should be extracted:** Same `AuthCard` wrapper duplication.
- **Mobile considerations:** Fits 360px; single field, no risk.
- **Desktop considerations:** No issues.
- **RTL considerations:** Email input has no `dir="ltr"` (same inconsistency as login, see §5).
- **Design risks:** None beyond the shared `AuthCard`/`dir` notes.
- **Recommended redesign scope:** Light (extract `AuthCard`; align `dir="ltr"` on email).

### /auth/reset-password
- **Route:** `/auth/reset-password`
- **Page name:** קביעת סיסמה חדשה / Set new password
- **Component type:** Server — **async Server Component** (`export default async function ResetPasswordPage()`), calls `createClient()` + `supabase.auth.getUser()` directly in the page body to gate which content renders.
- **Shell/Layout:** Root-only — identical `max-w-md` centered wrapper.
- **Current purpose:** Let a user who followed a valid recovery link (already exchanged for a session at `/auth/confirm`) set a new password.
- **Primary user goal:** Set new password and get back into the app.
- **Main content sections:** Title + conditional subtitle (valid session → "choose a new password" / no session → "link invalid or expired") → conditionally either `<ResetPasswordForm>` or a "request a new reset link" link back to `/auth/forgot-password`.
- **Actions:** Submit (update password) when session valid; link to `/auth/forgot-password` when not.
- **Forms / fields:** `password` (via `PasswordInput`, required, `autoComplete="new-password"`; server: `newPasswordField` = min 8/max 72); `confirm` (via `PasswordInput`, required, `autoComplete="new-password"`; server: `.refine` password===confirm). No strength meter (unlike signup's `PasswordField`).
- **Tables / lists:** None.
- **Status states:** Binary gate state — "valid session" vs "no session" — computed server-side via `getUser()`, not a client-visible status enum.
- **Empty / loading / error states:** No file-based loading/error. The "invalid/expired link" branch IS the error state, rendered inline server-side (not a redirect) — this differs from `/auth/confirm`'s pattern of redirecting to `/auth/login` on invalid token. `FormError` inside the form also handles the case where `getUser()` succeeded originally but `updatePassword` later finds no session (race/expiry between page render and submit): `'קישור האיפוס אינו תקף...'`.
- **Existing shared components used:** shared `FieldError`, `FormError`, `SubmitButton` (`@/components/forms`); shared `PasswordInput` (×2, password+confirm).
- **Components that should be reused:** `PasswordField` (the strength-meter wrapper already built for signup) could be reused here for the `password` field instead of raw `PasswordInput`, for UX parity — currently this page uses plain `PasswordInput` with no meter.
- **Components that should be extracted:** Same `AuthCard` wrapper duplication; the "conditional content based on session validity" pattern is specific to this page (not obviously repeated elsewhere in this file set).
- **Mobile considerations:** Fits 360px; two stacked password fields, no risk.
- **Desktop considerations:** No issues.
- **RTL considerations:** No physical-direction classes; labels/fields correctly RTL by default (Hebrew labels, password values are opaque so `dir` is moot).
- **Design risks:** Two different "invalid link" UX patterns across the auth area — `/auth/confirm` silently redirects to `/auth/login` on failure, `/auth/reset-password` shows an inline message with a recovery link. Both are defensible (see confirm's documented rationale) but worth flagging as a deliberate inconsistency, not an oversight — Needs verification whether product intends these to feel more unified.
- **Recommended redesign scope:** Light (extract `AuthCard`; optionally reuse `PasswordField` for meter parity).

### /auth/confirm
- **Route:** `/auth/confirm`
- **Page name:** אישור הבקשה / Confirm request
- **Component type:** Server — **async Server Component** (`export default async function ConfirmPage({ searchParams })`), reads `token_hash`/`type`/`next` from `searchParams`, validates/sanitizes them server-side, and either `redirect()`s immediately (missing/invalid params) or renders a form.
- **Shell/Layout:** Root-only — same `max-w-md` centered wrapper, `text-center` variant (like signup/success).
- **Current purpose:** Generic landing page for every Supabase auth email-link type (signup confirm, invite, magic-link, recovery, email, email_change). Deliberately defers OTP verification from GET (page render) to POST (form submit) to avoid email-scanner prefetch consuming single-use tokens — documented at length in both `page.tsx:8-18` and `actions.ts:9-16`.
- **Primary user goal:** Click one button to complete whatever auth action the email link represents.
- **Main content sections:** Title/subtitle ("almost done — click to continue") → single-button form carrying 3 hidden fields.
- **Actions:** Submit (verify OTP + redirect to `next`). No secondary links/actions on this page.
- **Forms / fields:** No visible fields — only hidden inputs (`token_hash`, `type`, `next`) plus a submit button. Not `useActionState`-driven; `<form action={confirmOtp}>` calls the Server Action directly (return type `Promise<void>`, always ends in `redirect()`), so there is no client-visible error/field-error state possible on this page by construction.
- **Tables / lists:** None.
- **Status states:** Implicit type union `signup | invite | magiclink | recovery | email | email_change` (`otp-types.ts:6-13`) governs which Supabase flow is being confirmed, but this is not surfaced to the user as a visible status — the page copy is generic regardless of `type`.
- **Empty / loading / error states:** No file-based loading/error. Two hard redirects instead of inline error UI: missing/invalid `token_hash`/`type` → `redirect('/auth/login')` (in the page itself, before rendering the form); `verifyOtp` failure in the action → also `redirect('/auth/login')`. Both are silent/generic by design (privacy-safe, no "your link expired" message shown) — matches the CLAUDE.md instruction to return generic errors for invalid/expired links, but means the user gets no explanation at all, just lands back on login.
- **Existing shared components used:** shared `SubmitButton` (`@/components/forms`) only — no `FormError`/`FieldError`/`FormNotice` (consistent with there being no reachable error state on this page).
- **Components that should be reused:** N/A — minimal by design.
- **Components that should be extracted:** Same `AuthCard` wrapper (text-center variant, shared with signup/success).
- **Mobile considerations:** Fits 360px; single button, no risk.
- **Desktop considerations:** No issues.
- **RTL considerations:** No physical-direction classes; nothing RTL-sensitive beyond the shared wrapper.
- **Design risks:** Redirect-only error handling means a real user whose link genuinely expired sees no explanation — they land on `/auth/login` with zero context. This is an intentional privacy/security tradeoff per the inline comments, not a bug, but it is a UX cliff worth flagging for product review (Needs verification whether a toast/query-param-driven notice on `/auth/login` is planned to soften this).
- **Recommended redesign scope:** None (structure is intentionally minimal and security-motivated) — only the shared `AuthCard` extraction applies.


---

## Customer · Core (Dashboard & Events)

### /app
- **Route:** `/app`
- **Page name:** לוח בקרה / Dashboard
- **Component type:** Server
- **Shell/Layout:** AppShell
- **Current purpose:** Landing page after login — event counts + quick actions + recent-events preview
- **Primary user goal:** Get an overview and jump to create or open an event
- **Main content sections:** header (title+subtitle); 3-card grid (total events, active events, "אירוע חדש" CTA card); "אירועים אחרונים" section (list of 5 most recent, or empty state)
- **Actions:** "אירוע חדש" (create) via the CTA card and via the empty-state button; "לכל האירועים" (view all) link; each list row links to its event detail
- **Forms / fields:** — (no forms; pure display + links)
- **Tables / lists:** recent-events `<ul>` (`listEvents({limit:5})`, counts come from separate head queries so the "3" total isn't limited by the preview page size); divide-y bordered list; each row = name + `[type · date · venue]` summary (`.filter(Boolean).join(' · ')`) + status pill
- **Status states:** `EVENT_STATUS_LABELS` (draft="טיוטה", active="פעיל", closed="סגור"), rendered as a plain `rounded-full border` pill (not the shared `Badge`)
- **Empty / loading / error states:** empty state inline when `totalEvents===0` (icon + message + CTA button); loading via area `loading.tsx` (generic bars, not page-shaped skeleton); error via area `error.tsx`
- **Existing shared components used:** none from `ui`/`shared` — only `lucide-react` icons (`CalendarDays`, `Plus`) and a plain `<Link>`; dates via `formatIsraelDate` (lib), labels via `event-labels.ts` (lib, not UI)
- **Components that should be reused:** `Button`/`buttonVariants` (ui) for both "אירוע חדש" CTAs, currently hand-rolled `<Link className="rounded-md bg-primary ...">`
- **Components that should be extracted:** the "stat card" (`rounded-lg border border-border bg-card p-5`), used 2× here; the "event summary row" (name + type/date/venue + status pill), duplicated verbatim in `/app/events` (see §5)
- **Mobile considerations:** grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` reflows cleanly; list rows use `min-w-0`+`truncate` on the name/summary text, so long content truncates instead of overflowing
- **Desktop considerations:** 3-column grid at `lg`; content capped by AppShell's `max-w-5xl` container
- **RTL considerations:** no physical-direction classes found; `gap-*`/`justify-between`/`truncate` are direction-agnostic; icons are `aria-hidden` inside `flex items-center gap-2`
- **Design risks:** status pill + "event summary row" duplicated (not extracted) between dashboard and events-list; CTAs hand-rolled instead of the shared `Button`
- **Recommended redesign scope:** Light

### /app/events
- **Route:** `/app/events`
- **Page name:** האירועים שלי / My events
- **Component type:** Server
- **Shell/Layout:** AppShell
- **Current purpose:** Full list of the owner's events — `listEvents()` called with no limit/filter/pagination
- **Primary user goal:** Browse all events, open one, or create a new one
- **Main content sections:** header (title + "אירוע חדש" button); events list or empty state
- **Actions:** "אירוע חדש" (top button); per-row "עריכה" link; row click → event detail
- **Forms / fields:** —
- **Tables / lists:** `<ul>` divide-y bordered list, `hover:bg-muted` per row; row = name + type/date/venue summary + status pill + "עריכה" link — structurally identical to the dashboard's recent-events row but implemented as separate, drifted markup (see Mobile considerations)
- **Status states:** same `EVENT_STATUS_LABELS` pill as dashboard
- **Empty / loading / error states:** empty state inline (`עדיין אין אירועים…`) — **no CTA button**, unlike the dashboard's empty state which has one (inconsistency); loading/error inherited from area files
- **Existing shared components used:** none from `ui`/`shared`; plain `<Link>` styled inline
- **Components that should be reused:** `Button`/`buttonVariants` for "אירוע חדש" and "עריכה"
- **Components that should be extracted:** "event summary row" — near-duplicate of the dashboard's, should be one shared `EventListItem`
- **Mobile considerations:** row is `flex items-center justify-between gap-4`; the name/summary `<Link>` does carry `min-w-0 flex-1` (so it won't force the row wider than its container), but — unlike the dashboard's version of the same pattern — the inner `<p>` name/summary text has **no `truncate`**, so a long event name wraps to multiple lines instead of clipping with an ellipsis. Flag: the two "same" list rows have silently drifted (dashboard truncates, this one wraps).
- **Desktop considerations:** single-column full-width list inside `max-w-5xl`; no pagination — will not scale gracefully as an owner accumulates events
- **RTL considerations:** no physical-direction classes; logical `gap-*`/`justify-between`
- **Design risks:** duplicated + drifted list-row markup vs. dashboard; no pagination; the row's own `<Link>` and the "עריכה" link both point at the identical `/app/events/${id}` href (redundant, not broken)
- **Recommended redesign scope:** Light

### /app/events/new
- **Route:** `/app/events/new`
- **Page name:** אירוע חדש / New event
- **Component type:** Server (`page.tsx`) wrapping a Client form (`new-event-form.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Create a new event
- **Primary user goal:** Fill minimal event info and create the event
- **Main content sections:** header (title + "חזרה לרשימה" back-link); `NewEventForm`
- **Actions:** submit ("יצירת אירוע"); back-link to `/app/events`
- **Forms / fields:** `name` (text, required); `event_type` (select, required, `EVENT_TYPES` enum, drives the celebrant field group); celebrant fields, dynamic per type via `CELEBRANT_FIELD_LABELS`/`HOST_COMPOSITION_LABELS` (e.g. wedding→groom/bride, bar_mitzvah→name, brit→parents+child+host_composition select) — all optional at creation; `event_date` (`DateSelectIL`, `required` client-side only — `createEventSchema` allows an empty draft date by design); `event_time` (`TimeSelect24`, optional); `venue_name` (text, optional). Server validation: `createEventSchema` (Zod, `src/lib/validation/schemas.ts`); errors surfaced via `FieldError`
- **Tables / lists:** —
- **Status states:** — (new events always start `draft`, not user-selectable)
- **Empty / loading / error states:** `FormError` banner on submit failure; no dedicated loading/error UI at this route (inherits area files)
- **Existing shared components used:** `FieldError`, `FormError`, `SubmitButton` (shared `forms.tsx`); `TimeSelect24`, `DateSelectIL` (shared). Everything else — labels, the `*` required-mark, every `<input>`/`<select>` — is inline/hand-rolled against a local `inputClass` string
- **Components that should be reused:** `Button`/`buttonVariants` for the back-link (currently a plain styled `<Link>`)
- **Components that should be extracted:** `CelebrantFields` is duplicated near-verbatim in `edit-event-form.tsx` (only the `required`/`defaults` plumbing differs) — strong candidate for one shared component; the local `inputClass` constant is redefined independently in both files
- **Mobile considerations:** form wrapped in `mx-auto max-w-lg` — comfortable single column; `DateSelectIL`/`TimeSelect24` render as `dir="ltr" flex w-fit` triplets of native selects, so they stay inline rather than stretching — not verified against an actual ~360px viewport (`Needs verification`)
- **Desktop considerations:** capped at `max-w-lg`, centered — intentionally narrower than the shell's `max-w-5xl`
- **RTL considerations:** `DateSelectIL`/`TimeSelect24` deliberately force `dir="ltr"` internally (in-code comment: keeps day/month/year and hour/minute in conventional reading order) inside the otherwise-RTL form — intentional, not a bug; the required-mark asterisk uses logical `ms-0.5`
- **Design risks:** duplicated `CelebrantFields`/`inputClass` vs. the edit form (drift risk — edit's copy already diverged, adding `disabled`/`required` variants)
- **Recommended redesign scope:** Medium (de-duplication, not a visual overhaul)

### /app/events/[id]
- **Route:** `/app/events/[id]`
- **Page name:** (event name, dynamic) / Event detail
- **Component type:** Server (`page.tsx`) composing Client children (`EditEventForm`, `EventStatusActions`, `CampaignSetupForm`) and a Server child (`CampaignSection`)
- **Shell/Layout:** AppShell
- **Current purpose:** Single event's control center — lifecycle status, RSVP campaign, full edit form
- **Primary user goal:** See the event's current state and advance its lifecycle (publish/close), start/continue the RSVP campaign, or edit details
- **Main content sections:** (1) back-link; (2) header — name, `[type · date · venue]` summary, celebrants line, "האירוע חלף" (past) pill + status pill; (3) "ניהול מוזמנים" (manage guests) button row; (4) `EventStatusActions`; (5) `CampaignSection`; (6) "עריכת פרטי האירוע" card wrapping `EditEventForm`
- **Actions:** publish (draft→active, disabled until `event_date` is a future IL date, with a hint); close (active→closed, destructive, `window.confirm`, disabled while an operational campaign exists, with a hint); "ניהול מוזמנים" link; campaign CTA (context-dependent via `nextStep()`: start → sign → capture payment → activate → manage); edit-form save
- **Forms / fields:** Edit form — `name` (text, required); `event_type` (select, **disabled while an operational campaign exists**, value then carried via a hidden input since a disabled select doesn't POST); celebrant fields (dynamic per type; become `required` while an operational campaign exists, per `CELEBRANT_REQUIRED_FIELD_KEYS_BY_KIND`); `event_date`/`event_time`/`rsvp_deadline` (`DateSelectIL`/`TimeSelect24`, **editable only while `status==='draft'`**, disabled + "נעול לאחר פרסום" hint after publish); `venue_name` (text, `required` while an operational campaign exists); `venue_address` (text, optional); `gift_payment_url` (url, `dir="ltr"`, optional, https per DB CHECK); `show_meal_pref` (checkbox); `invite_image` (file, jpeg/png/webp, client-checked against `INVITE_IMAGE_MAX_BYTES` before submit, shows a signed-URL preview of the current image). Server validation: `updateEventSchema` (Zod). Publish/close actions take no fields, just confirm-gated buttons
- **Tables / lists:** — (no tables)
- **Status states:** event status pill = draft/active/closed (`EVENT_STATUS_LABELS`); separate "האירוע חלף" (past-event) warning pill when `isPastEventDay`; campaign status pill (via the admin `Badge`) = one of draft/pending_approval/approved/scheduled/active/paused/closed/awaiting_invoice/billed/paid/cancelled (`STATUS_LABELS`/`STATUS_VARIANTS`, local to `campaign-section.tsx`)
- **Empty / loading / error states:** campaign section's "no campaign yet" state = inline `CampaignSetupForm` CTA, or a `PastEventNotice` warning if the event date has passed; `FormError`/`FormNotice` surface every action's server result; no route-level loading/error files (inherits area files)
- **Existing shared components used:** `buttonVariants` (ui, for "ניהול מוזמנים" and campaign links); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (shared `forms.tsx`); `TimeSelect24`, `DateSelectIL` (shared); `Badge`/`BadgeVariant` — **imported from `@/app/(admin)/admin/_components`**, an admin route-group file, not from `@/components` (cross-area import — see Design risks)
- **Components that should be reused:** `Button`/`buttonVariants` for publish/close (hand-rolled className strings in `event-status-actions.tsx`); a genuinely shared `Badge` for the event-status pill, which currently doesn't use any Badge component at all (plain `<span>`) while the campaign pill just below it does — inconsistent chip styling on the same page; `@/components/ui/card` (listed as an existing primitive) is not imported anywhere on this page — every section is a hand-rolled `rounded-lg border border-border bg-card p-6` div (`Needs verification` on why the primitive isn't used)
- **Components that should be extracted:** `CelebrantFields` (again duplicated vs. `new-event-form.tsx`, here with added `disabled`/`required` lock logic); the "section card" wrapper repeats 2× on this page and matches the dashboard's "stat card" pattern too; the destructive-confirm `ActionButton` in `event-status-actions.tsx` duplicates a documented twin in `campaign/[campaignId]/manage-client.tsx` (per its own code comment) — candidate for one shared `ConfirmButton`
- **Mobile considerations:** header `flex flex-wrap items-center justify-between gap-4` stacks on narrow widths; action row `flex flex-wrap gap-2`; invite-image preview capped `max-w-[20rem]` (~320px, fits a 360px viewport) with `h-auto w-full`; `gift_payment_url` input uses `w-full` but is a one-off style (`bg-background` instead of the local `inputClass`'s `bg-transparent`) — cosmetic drift, not a layout risk
- **Desktop considerations:** content stays inside `max-w-5xl`; every section stacks in a single column at all breakpoints — no side-by-side desktop layout for status/campaign/edit
- **RTL considerations:** no physical-direction classes found across page/edit-form/status-actions/campaign-section; `gift_payment_url` intentionally forced `dir="ltr"` (URL display); `DateSelectIL`/`TimeSelect24` ltr-internal as documented above
- **Design risks:** **cross-boundary import** — a customer-facing page pulls `Badge`/`BadgeVariant` from an `(admin)` route-group file, coupling the customer area to admin's internal module and bypassing `@/components` entirely; `@/components/ui/card` exists but is unused here; the event-status pill (plain span) and campaign-status pill (`Badge`) look inconsistent on the same page; `CelebrantFields` duplicated a 2nd time (new vs. edit, edit materially more complex); the destructive close-action is gated both client-side (`disabled`+confirm) and, per code comments, server/DB-side — good defense in depth, no risk there
- **Recommended redesign scope:** Medium (structural consolidation — Badge/Card reuse, CelebrantFields extraction — not a visual overhaul)


---

## Customer · Guests

### /app/events/[id]/guests
- **Route:** `/app/events/[id]/guests`
- **Page name:** מוזמנים / Guests (list)
- **Component type:** Server (children `GuestListControls`, `ContactStatusCell`, `GuestRowActions` are Client)
- **Shell/Layout:** AppShell
- **Current purpose:** List, search, filter, sort all guests for one event; show aggregate stats; quick-edit contact status inline; entry points to add/import guests and manage groups.
- **Primary user goal:** Find a guest, gauge overall RSVP/outreach progress, act quickly (edit/delete/contact-status/add/import).
- **Main content sections:** header (title + event name + "ייבוא מקובץ"/"מוזמן חדש" CTAs) → `GuestListControls` filter bar → `GroupsManager` (collapsible) → 4 stat tiles (`<dl>` grid) → result count → guest list (cards `<lg` / table `≥lg`) → `Pagination`.
- **Actions:** ייבוא מקובץ (link → `/import`), מוזמן חדש (link → `/new`); per guest: עריכה (link), מחיקה (destructive, client `window.confirm` + action), inline contact-status change (select, client action); group create/rename/delete via `GroupsManager`.
- **Forms / fields:** filter form — search (text), status (select), contact (select), group (select), over-invited (select "1"/all), sort (select); pure client-side navigation, no validation needed. `GroupsManager` create/rename forms are server-validated via `groupSchema` (Zod, in `guests-actions.ts`), errors surfaced through `FieldError`.
- **Tables / lists:** mobile/tablet (`<lg`): `<ul>` of `GuestCard` rows. Desktop (`≥lg`): `<table>` 8 columns — שם / טלפון / קבוצה / סטטוס / יצירת קשר / מצב הודעות / אישרו / פעולות — wrapped in `overflow-x-auto`, `min-w-[44rem]`.
- **Status states:** `guest_status` (pending/attending/declined/maybe); `contact_status` (7 values: not_contacted/contacted/responded/wrong_number/unclear/unavailable/callback) via inline select; `contact_op_status` (14 values; `pending_contact`/`not_eligible` deliberately hidden as pre-outreach noise, rest shown as badges); `delivery_status` (re-exported from `@/lib/data/admin/labels`); `removal_requested` boolean flag badge; `over_invited` boolean flag badge ("מעל הכמות שהוזמנה").
- **Empty / loading / error states:** file-based `loading.tsx` (generic 3-block `animate-pulse` skeleton) and `not-found.tsx` (generic "לא נמצא" + link back to `/app/events`); in-page empty state when `items.length === 0` (dashed border box, message varies by `hasActiveFilters`).
- **Existing shared components used:** `ui`: `Button`/`buttonVariants` (`@/components/ui/button`). Cross-area: `Badge`, `Pagination` from `@/app/(admin)/admin/_components` — **not** from `@/components/*`, i.e. a customer page depends on an admin route-group internal file.
- **Components that should be reused:** none obviously skipped here; `Button` is used correctly for the two header CTAs.
- **Components that should be extracted:** `Badge`/`Pagination` (currently admin-scoped) → promote to a neutral shared location (`@/components/ui` or `@/components`) so customer code doesn't import through `(admin)`; the 4 stat-tile `<div>`s (`rounded-lg border border-border bg-card px-4 py-3` + `dt`/`dd`/`p`) are hand-rolled 4× inline → `StatTile` candidate.
- **Mobile considerations:** dedicated `<lg` card list (not a squeezed table) — an explicit, documented design decision (see code comment on `GuestCard`); `ContactStatusCell` renders twice (card + table, one hidden by CSS) with a `scope` prop specifically to avoid duplicate DOM ids between the two.
- **Desktop considerations:** 8-column table guarded by `overflow-x-auto` + `min-w-[44rem]` for the narrow-`lg` edge case; relies on `SidebarInset` `overflow-x-clip` fix at the shell level (see `[[sidebar-inset-rtl-overflow]]`) to avoid leaking page-level horizontal scroll.
- **RTL considerations:** phone number cells correctly use `dir="ltr"` (numeral content only); no physical `left/right`/`ml-/mr-` classes found in this file.
- **Design risks:** cross-area import of `Badge`/`Pagination` from `(admin)` is an architectural smell; stat tiles duplicated 4× instead of a component; the filter bar has no UI control for `dir` (asc/desc) even though `Current.dir` exists in the type/URL-building logic — effectively dead/unreachable state.
- **Recommended redesign scope:** Light — structure and responsive pattern are solid and well-documented; mainly extract `Badge`/`Pagination` to a neutral shared location and de-duplicate the stat-tile markup.

### /app/events/[id]/guests/new
- **Route:** `/app/events/[id]/guests/new`
- **Page name:** מוזמן חדש / New guest
- **Component type:** Server
- **Shell/Layout:** AppShell
- **Current purpose:** Create a single guest via `GuestForm`.
- **Primary user goal:** Add one guest/household quickly.
- **Main content sections:** header (title + חזרה link) → `GuestForm`.
- **Actions:** submit ("הוספת מוזמן"), חזרה link back to the list.
- **Forms / fields:** `full_name` (text, required), `phone` (tel, `dir="ltr"`, `inputMode="tel"`), `status` (select, default `pending`), `contact_status` (select, default `not_contacted`), `group_id` (select incl. "ללא קבוצה"), `expected_count` (number, `min={0}`, `dir="ltr"`), `note` (textarea, rows=3). Validated server-side by `createGuestSchema` (Zod, in `guests-actions.ts`); per-field errors via `FieldError`.
- **Tables / lists:** none.
- **Status states:** the two selects list all `guest_status`/`contact_status` values as choices (not a display of current external state, since this is a create form).
- **Empty / loading / error states:** no dedicated `loading.tsx`/`not-found.tsx`/`error.tsx` in this segment — inherits the parent `guests/loading.tsx` skeleton per Next.js App Router segment nesting (confirmed no override file present via directory listing). `FormError` banner on submit failure.
- **Existing shared components used:** shared: `FieldError`, `FormError`, `SubmitButton` (`@/components/forms`); local: `GuestForm`.
- **Components that should be reused:** raw `<input>`/`<select>`/`<textarea>` styled with a local `inputClass` string instead of `@/components/ui/input`/`select` (both exist as shared primitives and are unused here).
- **Components that should be extracted:** the per-field block (`label` + control + `FieldError`) repeats 7× with only the control changing — a small `Field` wrapper would cut boilerplate; `GuestForm` itself is already correctly shared between create and edit (good reuse, not a gap).
- **Mobile considerations:** single column by default, `sm:grid-cols-2` for paired fields (status/contact, group/expected_count); `max-w-2xl` wrapper comfortably fits a 360px viewport.
- **Desktop considerations:** `max-w-2xl` keeps the form narrow and legible; no wide-table concerns.
- **RTL considerations:** `phone`/`expected_count` correctly use `dir="ltr"` + appropriate `inputMode` (numeral content); no physical-direction classes found.
- **Design risks:** unstyled native `<select>`/`<textarea>` (browser-default chrome, inconsistent focus ring vs. `ui/input`); no shared `Textarea` primitive exists yet (known gap per spec).
- **Recommended redesign scope:** Light — functionally complete; mainly a primitive-adoption pass (native inputs → `ui/input`/`select`, and `Textarea` once it exists).

### /app/events/[id]/guests/[guestId]
- **Route:** `/app/events/[id]/guests/[guestId]`
- **Page name:** עריכת מוזמן / Edit guest
- **Component type:** Server (child `RsvpLink` is Client)
- **Shell/Layout:** AppShell
- **Current purpose:** Edit a guest's details; manage/reveal their personal RSVP link (copy/revoke/regenerate); view their submitted RSVP response summary; view WhatsApp outreach status and full interaction timeline.
- **Primary user goal:** Update a guest's info and check/share their RSVP link or message history.
- **Main content sections:** header → `RsvpLink` (client, conditional on a token existing) → "אישור הגעה שהתקבל" summary (conditional on `hasResponse`) → "היסטוריית WhatsApp" section (op-status badge + ordered interaction list or empty message) → `GuestForm` (edit mode, `initial={guest}`).
- **Actions:** copy RSVP link (clipboard), ביטול הקישור (revoke), יצירת קישור חדש (regenerate, invalidates the old one), form submit ("שמירת שינויים"), חזרה link.
- **Forms / fields:** same fields as `/new`, pre-filled via `initial`; validated server-side by `updateGuestSchema`.
- **Tables / lists:** WhatsApp interaction timeline as an `<ol>` of bordered cards (not a table) — one item per message with direction/delivery badge, timestamp, `provider_id`, optional error code.
- **Status states:** `contact_op_status` badge (14 values); `removal_requested` flag badge; per-interaction: inbound → "נכנסת" badge, outbound-with-status → `delivery_status` badge, outbound-pending → "ממתין" neutral badge; RSVP-link revoked/active state rendered as a **custom** red pill (`bg-red-50 text-red-700`), not the shared `Badge` component used everywhere else on this same page.
- **Empty / loading / error states:** `notFound()` when the guest doesn't exist → falls through to `guests/not-found.tsx`; "אין עדיין היסטוריית WhatsApp עבור מוזמן זה" empty message when `interactions.length === 0`; no dedicated `loading.tsx` for this segment (inherits `guests/loading.tsx`, a generic 3-block skeleton not tailored to this page's 4 sections — `Needs verification` whether that mismatch is noticeable in practice).
- **Existing shared components used:** shared: `Badge`, `formatDateTime` (`@/app/(admin)/admin/_components`, same cross-area import as the list page); `FormError`, `FormNotice` (`@/components/forms`); local: `GuestForm`, `RsvpLink`.
- **Components that should be reused:** `RsvpLink` hand-rolls copy/revoke/regenerate as raw `<button>` + Tailwind instead of `@/components/ui/button`; its "מבוטל" pill uses raw `bg-red-50 text-red-700` instead of the `Badge` component already imported and used one section above it on the *same page*.
- **Components that should be extracted:** the interaction-timeline `<li>` card is bespoke to this file only (not duplicated elsewhere in this area) — fine to leave inline; `Needs verification` whether the admin webhook inspector has an equivalent pattern (out of this area's scope).
- **Mobile considerations:** `max-w-2xl` single column; interaction items wrap via `flex-wrap`; `provider_id` row uses `truncate` to avoid overflow.
- **Desktop considerations:** same narrow column throughout — deliberately simple detail page, no distinct desktop layout.
- **RTL considerations:** `text-left` physical class on the `provider_id` `<p>` (should be `text-start`) inside an otherwise-RTL page; the element also carries `dir="ltr"` for the id string itself, so combining a directional wrapper with a physical utility is redundant and risky if an LTR locale is ever added; `phone`/link inputs elsewhere correctly use `dir="ltr"`.
- **Design risks:** `RsvpLink`'s pill/buttons visually diverge from the `Badge`/`Button` system used one section above on the same page; the `text-left` physical class; no confirmation before "ביטול הקישור" (revoke) even though it's a meaningfully destructive, easy-to-miss action — inconsistent with delete-guest and delete-group, both of which use `window.confirm`.
- **Recommended redesign scope:** Medium — visual inconsistency within a single page (RsvpLink should adopt `Badge`/`Button`) plus a missing confirm on revoke.

### /app/events/[id]/guests/import
- **Route:** `/app/events/[id]/guests/import`
- **Page name:** ייבוא מוזמנים מקובץ / Import guests from file
- **Component type:** Server
- **Shell/Layout:** AppShell
- **Current purpose:** Explain the CSV contract (columns, encoding fixes, row limit) with a template download, then run `ImportForm`.
- **Primary user goal:** Upload a CSV of guests without hitting a confusing rejection.
- **Main content sections:** header → instructions card (supported-columns list, "gotchas" list, template download link, row-limit note) → `ImportForm`.
- **Actions:** הורדת תבנית מוכנה (download link → `/import/template`), file upload + submit ("ייבוא").
- **Forms / fields:** single file input (`accept=".csv,text/csv"`, required) with a **client-side** pre-check against `CSV_MAX_BYTES` (shows `FieldError` inline, clears the input) in addition to server-side validation in `importGuestsAction`.
- **Tables / lists:** none; two plain `<ul>` bullet lists of guidance text.
- **Status states:** none pre-submission; post-submission result rendered by `ImportForm` — imported count (success) / per-row failure list (`{row, message}`).
- **Empty / loading / error states:** no own `loading.tsx`/`not-found.tsx` (inherits `guests/loading.tsx` per segment nesting — confirmed no override file present); `ImportForm` shows inline success (green banner) and per-row failure list (amber banner) after submit, driven entirely by server-action state — no file-based error UI.
- **Existing shared components used:** shared: `FieldError`, `FormError` (`@/components/forms`); local: `ImportForm`.
- **Components that should be reused:** submit button (`UploadButton` in `import-form.tsx`) is a raw `<button>` instead of `@/components/ui/button` or the shared `SubmitButton` from `@/components/forms` — both exist and `SubmitButton` is used elsewhere in this very area (`GuestForm`).
- **Components that should be extracted:** the "success banner + per-row failure list" result pattern overlaps conceptually with the WhatsApp-import staging result screen (both are "import outcome" UIs) — candidate shared `ImportResultSummary`; the instructions card (bordered box + bullet lists) is bespoke to this page.
- **Mobile considerations:** `max-w-2xl` single column; instructions lists wrap naturally; template-download link + intro paragraph wrap via `flex-wrap`.
- **Desktop considerations:** same narrow column; no wide-table risk.
- **RTL considerations:** no physical-direction classes found; the "↓" glyph in "הורדת תבנית מוכנה ↓" is orientation-neutral (a down-arrow), so it reads correctly in RTL.
- **Design risks:** this page's result banners and the WhatsApp-staging screen's banners implement overlapping-but-not-identical styling for a conceptually identical "outcome" state — drift risk over time; raw color utilities instead of a shared Alert primitive (missing-primitive fact noted per spec; colors themselves out of scope).
- **Recommended redesign scope:** Light — content-heavy but simple; mainly adopt `SubmitButton`/`Button` and, once available, a shared Alert primitive.

### /app/events/[id]/guests/import/whatsapp
- **Route:** `/app/events/[id]/guests/import/whatsapp`
- **Page name:** ייבוא מוואטסאפ / Import from WhatsApp
- **Component type:** Server (child `StagingActions` is Client)
- **Shell/Layout:** AppShell
- **Current purpose:** Review one or more pending staged imports (CSV documents or shared contact cards received via the business WhatsApp number) before committing them; surfaces per-row duplicate/merge matches against existing guests.
- **Primary user goal:** Confirm or discard each staged batch, resolving name/phone collisions field-by-field before anything is written to the guest list.
- **Main content sections:** header → per staging-row `<section>` (source label + row/error counts, preview table capped at 50 rows, `StagingActions`) → empty-state paragraph when no pending imports.
- **Actions:** per batch — אישור ייבוא (confirm, primary) / מחיקה (discard, destructive), both server actions bound with `eventId`+`stagingId`; per matched guest — a merge checkbox (name-match: opt-out, default-checked; phone-match: opt-in per field) plus per-field checkboxes (`FieldChoice`) choosing which incoming values overwrite/fill the existing guest.
- **Forms / fields:** dynamically generated checkbox set from `ImportMatch[]`/`MergeFieldDiff[]` (`merge_${id}`, `field_${id}_${diff.field}`) — not a fixed schema; no `FieldError` use on this screen (no per-field validation, only `FormError`/`FormNotice` at the action-result level).
- **Tables / lists:** preview `<table>` (שם/טלפון/כמות/קבוצה, 4 columns) per staged batch, capped at 50 rows with a "מוצגות 50 מתוך N" note; wrapped in `overflow-x-auto` but has **no mobile-card fallback**, unlike the main guest list in the same folder.
- **Status states:** none from a domain enum — pre-import review only; per-row `error_rows` is read but only its **count** is shown (`{errorCount} שגיאות`), not the individual error messages (`Needs verification` — confirm product intent, since the messages exist server-side but aren't surfaced here).
- **Empty / loading / error states:** in-page empty message ("אין רשימות ממתינות…") when `pendingList.length === 0`; no dedicated `loading.tsx`/`not-found.tsx` for this nested segment (inherits `guests/loading.tsx`); `FormError`/`FormNotice` per staging card after confirm/discard.
- **Existing shared components used:** shared: `FormError`, `FormNotice` (`@/components/forms`); local: `StagingActions`.
- **Components that should be reused:** the preview table has no responsive fallback despite the main list (same folder) establishing a card/table pattern; `staging-client.tsx` defines its **own local** `SubmitButton` function — same name as, but a different implementation from, `@/components/forms`'s `SubmitButton` used elsewhere in this area — a real collision/shadowing risk for future edits in this folder.
- **Components that should be extracted:** `MatchCard`/`FieldChoice` (the per-field merge-checkbox UI) is a genuinely new, reusable pattern not seen elsewhere in this area — fine to keep local for now, but worth promoting if another import surface needs the same merge UX later.
- **Mobile considerations:** preview table has no card fallback; at 4 columns + `whitespace-nowrap` + a `dir="ltr"` phone column it's narrower than the main 8-col table but still risks horizontal scroll on a ~360px viewport with long Hebrew names; the `overflow-x-auto` wrapper prevents page-level breakage but there's no card view like the main list has.
- **Desktop considerations:** table comfortable at 4 columns; multiple staged batches stack vertically as separate `<section>`s.
- **RTL considerations:** `text-right` used physically on the header `<tr>` (should be `text-start`) — the one clear oversight. By contrast, the phone `<td>`'s `text-end` + symmetric `px-3` (instead of `ps-`/`pe-`) is a **deliberate, code-commented exception**: the cell's own `dir="ltr"` flips its inline-end, so a logical `pe-`/`ps-` would visually fuse the phone digits against the neighboring column — the comment explicitly documents this LTR-in-RTL mixing workaround.
- **Design risks:** local `SubmitButton` re-implementation duplicates/shadows `@/components/forms`'s `SubmitButton` under the identical name within the same feature area; missing mobile-card fallback breaks this area's own established responsive precedent; staged per-row error messages are computed but not surfaced, only counted.
- **Recommended redesign scope:** Medium — functionally solid merge-review UX, but the duplicate `SubmitButton` name and missing mobile-card fallback are concrete inconsistencies against this area's own precedent.


---

## Customer · Campaign & Orders

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


---

## Customer · Account (Settings/Team/Access)

### /app/settings
- **Route:** `/app/settings`
- **Page name:** הגדרות / Settings
- **Component type:** Server (`page.tsx`) → Client (`settings-client.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Central account-settings hub: profile, notification preferences, billing/orders snapshot, security (password reset), account (email change + metadata).
- **Primary user goal:** Update profile info and notification prefs; glance at recent orders; request a password reset or email change.
- **Main content sections:** Sticky anchor-nav sidebar (5 items) + 5 stacked `<section>` cards (`#profile`, `#notifications`, `#billing`, `#security`, `#account`).
- **Actions:** Save profile; save notification prefs; send password-reset email; request email change.
- **Forms / fields:**
  - Profile: `full_name` (text), `phone` (tel, `dir="ltr"`) — `updateProfileSchema`, server-returned `fieldErrors`.
  - Notifications: `event_updates`, `reminder_updates`, `billing_updates` (checkboxes) — `updateSettingsSchema`.
  - Security: no fields, submit-only (`sendPasswordResetAction` uses the session's own email).
  - Account/email-change: `new_email` (email, `dir="ltr"`) — `emailChangeSchema`; blocks same-as-current email, checked server-side.
- **Tables / lists:** `BillingSection` renders a `<ul>` of up to 3 recent orders (amount, date, status pill) — not a full table, no link to full order history.
- **Status states:** Order status via `ORDER_STATUS_LABELS[order.status]` (imported from `@/lib/constants`; enum values themselves not opened — **Needs verification** for the full status set).
- **Empty / loading / error states:** `loadError` boolean (page.tsx catches `requireUser`/`getProfile`/etc.) renders a hardcoded alert banner (`bg-red-50 text-red-700`, NOT the shared `FormError`) at the top of the client tree. Billing empty state = dashed-border box + `Receipt` icon + Hebrew text. No file-based `loading.tsx`/`error.tsx`.
- **Existing shared components used:** shared: `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`). No direct `@/components/ui/*` imports in this file (only indirectly via `SubmitButton` → `Button`).
- **Components that should be reused:** The `loadError` banner reimplements `FormError`'s alert styling with raw literal colors instead of importing `FormError`. `ToggleField` hand-rolls a checkbox toggle row; `ui/switch` is a shared primitive and is not used here.
- **Components that should be extracted:** `SectionTitle` (icon + title + description header, local to this file) is a clean reusable "settings section header" pattern used 5×. `ToggleField` (label+description+checkbox) is an extract candidate, ideally rebuilt on `ui/switch`.
- **Mobile considerations:** `grid gap-6 lg:grid-cols-[220px_1fr]` collapses to a single column below `lg` — anchor nav stacks above content, no fixed pixel widths found, all inputs `w-full`.
- **Desktop considerations:** Sidebar is `lg:sticky lg:top-24 lg:self-start`, fixed 220px column.
- **RTL considerations:** Phone/email inputs correctly force `dir="ltr"` + `text-start` for LTR-content fields embedded in the RTL form. No physical `left/right`/`ml-/mr-`/`pl-/pr-` classes found in the file.
- **Design risks:** `loadError` banner and order-status pill are ad hoc instead of using the shared `FormError`/a real Badge; `ToggleField` reinvents `ui/switch`; no "view all orders" affordance (hard-capped at 3, no pagination/link).
- **Recommended redesign scope:** Light

### /app/team
- **Route:** `/app/team`
- **Page name:** ניהול משתמשים / Team management
- **Component type:** Server (`page.tsx`) → Client (`team-client.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Org multi-tenancy member management: invite members, list current members with roles, manage pending invitations.
- **Primary user goal:** Invite a teammate; review/manage current members' roles; manage pending invites.
- **Main content sections:** `InviteForm` (rendered only if `canManage`), member list section, pending-invitations section (rendered only if `canManage`).
- **Actions:** Invite member; change member role; remove member; resend invitation; revoke invitation.
- **Forms / fields:**
  - Invite: `email` (email, required, `dir="ltr"`), `role_id` (select, required, excludes the owner role) — `inviteMemberSchema`.
  - Per-member inline role form: `role_id` select (`defaultValue`=current role) — `changeMemberRoleSchema`.
  - Per-member remove form: hidden `member_id` — `memberIdSchema`.
  - Per-invitation resend/revoke: hidden `invitation_id` — `invitationIdSchema`.
- **Tables / lists:** Two `<ul className="divide-y">` lists (members, invitations) — **not** an HTML `<table>`; each row is a `flex flex-wrap` block, so it already behaves like a card/list on narrow widths (no separate mobile fallback needed since there's no table to fall back from).
- **Status states:** Member row shows a hardcoded "פעיל" (Active) badge — no real status field backs it (**Needs verification**: is there ever an inactive/suspended member state?). Invitation row shows a hardcoded "ממתינה" (Pending) badge — no expired/accepted/declined states surfaced in this component. Role is real/data-driven: `member.roleLabel` / `invitation.roleLabel` (from `org_roles.label`, confirmed via `src/lib/data/orgs.ts`).
- **Empty / loading / error states:** "אין חברים עדיין" / "אין הזמנות ממתינות" plain-text empty states (no icon, no shared EmptyState). Per-row `FormError`/`FormNotice` shown inline below each row's inline forms. No file-based `loading.tsx`/`error.tsx`.
- **Existing shared components used:** shared: `FieldError`, `FormError`, `FormNotice` (`@/components/forms`). Notably **`SubmitButton` is NOT used** — a local `RowSubmit` is hand-rolled instead. No direct `@/components/ui/*` imports.
- **Components that should be reused:** `RowSubmit` duplicates `SubmitButton`'s pending-state pattern (`useFormStatus`) instead of extending it, and hardcodes button styling — primary variant re-implements `Button`'s default look, and the "danger" variant (`bg-red-50 text-red-700 hover:bg-red-100`) re-implements what `<Button variant="destructive">` (`@/components/ui/button`) already provides. The local `Badge` component duplicates the inline pill pattern also seen in settings' `BillingSection`.
- **Components that should be extracted:** Badge/status-chip — used 4× inline in this one file alone (member role, member "active", invitation role, invitation "pending") and again independently in settings — matches the spec's confirmed-missing "Badge" primitive exactly. `RowSubmit` should ideally fold into `SubmitButton` via a `variant` prop rather than living as a parallel implementation.
- **Mobile considerations:** Rows use `flex flex-wrap items-center justify-between gap-3` so they reflow at narrow widths; invite form grid `sm:grid-cols-[1fr_auto_auto]` collapses to one column below `sm`; no fixed pixel widths found.
- **Desktop considerations:** Invite form's email/role/submit align on one row at `sm:`+ via the grid-cols template.
- **RTL considerations:** Email fields correctly `dir="ltr"`; no physical `left/right`/`ml-/mr-` classes found.
- **Design risks:** **Destructive actions have no confirmation step** — `removeMemberAction` and `revokeInvitationAction` fire directly from a `RowSubmit variant="danger"` click, with no confirm dialog (and no Dialog primitive exists in the shared kit per spec, only `sheet`). The invite/resend success notice exposes the raw join link as plain text inside `FormNotice` with no copy-to-clipboard affordance. Hardcoded "פעיל"/"ממתינה" badges aren't sourced from a real status field, so the UI can't reflect richer invitation/member states if the data model grows.
- **Recommended redesign scope:** Medium (badge extraction, submit-button consolidation, confirm-before-destroy pattern for remove/revoke)

### /app/admin-access
- **Route:** `/app/admin-access`
- **Page name:** גישת ניהול / Admin access (claim)
- **Component type:** Server (`page.tsx`) → Client (`claim-admin-form.tsx`)
- **Shell/Layout:** AppShell
- **Current purpose:** Bootstrap page to claim the first-admin role via the `claim_first_admin()` RPC; shows a link into `/admin` if the user is already an admin.
- **Primary user goal:** Claim first-admin access, or navigate into `/admin` if already an admin.
- **Main content sections:** Single narrow column (`max-w-md`) — header + conditional block (already-admin link OR claim form).
- **Actions:** Claim first admin (redirects to `/admin` on success); navigate to `/admin` (plain `Link`).
- **Forms / fields:** None — the claim "form" is submit-only, no input fields (the RPC takes no args).
- **Tables / lists:** None.
- **Status states:** Implicit boolean (already-admin vs not) from `isAdmin()` — no explicit status enum.
- **Empty / loading / error states:** `FormError` only, from `claimFirstAdminAction` (generic "already exists" or "action failed" message — deliberately does not leak who/how many admins exist). No file-based `loading.tsx`/`error.tsx`.
- **Existing shared components used:** shared: `FormError`, `SubmitButton` (`@/components/forms`). No direct `@/components/ui/*` imports.
- **Components that should be reused:** n/a.
- **Components that should be extracted:** n/a — smallest, cleanest page in this area.
- **Mobile considerations:** `max-w-md` centered column, no fixed pixel widths beyond that cap; fits narrow viewports without issue.
- **Desktop considerations:** Intentionally stays capped at `max-w-md` even on wide screens (bootstrap/utility flow, not a dashboard page).
- **RTL considerations:** No physical `left/right` classes; plain Hebrew text, inherits `dir="rtl"` from root layout.
- **Design risks:** Minor only — the "מעבר לאזור הניהול" link and the claim `SubmitButton` are visually near-identical CTAs, but the link is a raw `<Link>` with inline utility classes (`rounded-md bg-primary px-4 py-2 ...`) instead of `<Button asChild>` wrapping the `Link`, so the two "primary CTA" surfaces on this page are styled from two different sources of truth.
- **Recommended redesign scope:** None


---

## Admin · Operations & Monitoring

### /admin
- **Route:** `/admin`
- **Page name:** סקירה / Admin Dashboard
- **Component type:** Server
- **Shell/Layout:** AdminShell
- **Current purpose:** Landing page for admins — headline counts per section, plus most recent audit-log activity.
- **Primary user goal:** Get a quick pulse of the system and jump into the busiest area.
- **Main content sections:** 4-tile count grid (contacts/callbacks/orders/packages, each a `Link`); "פעילות אחרונה" (recent activity) list of last 5 entries.
- **Actions:** Navigate to a section via tile click (no mutations on this page).
- **Forms / fields:** —
- **Tables / lists:** Recent-activity `<ul>` of `<li>` cards (action badge, summary, actor chip, target chip, timestamp). Not paginated (fixed last-5, via `recentActivity(5)`).
- **Status states:** N/A (counts and activity entries only; activity entries carry an `actionLabel` chip, not a status enum).
- **Empty / loading / error states:** Empty via local `EmptyState` ("אין פעילות להצגה עדיין."). Loading via area-wide `admin/loading.tsx` (skeleton). Error via area-wide `admin/error.tsx`.
- **Existing shared components used:** `ui`: none directly. `shared`: `PageHeading`, `EmptyState`, `formatDateTime` (all from local `_components.tsx`, classified `inline/local` to this area per the source-classification rules — not under `@/components/ui` or `@/components`).
- **Components that should be reused:** None outstanding — this page is already thin and uses the area's own helpers consistently.
- **Components that should be extracted:** The 4-tile "stat card that's also a Link" pattern (icon + label + big number, `rounded-lg border border-border p-4 hover:bg-muted`) is a good candidate for a shared `StatTile`/`StatLink` primitive — see §5 (echoes `HealthStat` in `/admin/webhooks`, which is presentational-only, non-link).
- **Mobile considerations:** Tile grid is `grid-cols-2` on mobile → `lg:grid-cols-4`; no fixed widths found. Activity cards wrap via `flex-wrap`.
- **Desktop considerations:** Content is capped at `max-w-5xl` by AdminShell; comfortable at desktop widths.
- **RTL considerations:** No physical-direction classes found (verified via grep across the whole file). Uses `gap`/`flex-wrap` only.
- **Design risks:** Recent activity list here duplicates markup almost 1:1 with `/admin/activity`'s row rendering (see §5) — a shared `ActivityRow`/`ActivityFeed` component would remove the duplication and reduce drift risk (e.g. only `/admin/activity` shows the `entry.metaPreview` `<details>` JSON block; the dashboard silently omits it).
- **Recommended redesign scope:** Light — extract `ActivityRow` + `StatTile`, no structural change needed.

### /admin/activity
- **Route:** `/admin/activity`
- **Page name:** יומן פעילות / Activity Log
- **Component type:** Server
- **Shell/Layout:** AdminShell
- **Current purpose:** Full audit trail of system actions (event/guest/group/package/campaign/etc.), filterable and deep-linkable from other admin pages via `eventId`/`guestId`/`groupId`/`packageId`.
- **Primary user goal:** Investigate "who did what, when" — either browsing broadly or drilling into one entity's history.
- **Main content sections:** Filter form (`ActivityFilters`, `inline/local`, GET-based, no JS required); active-instance-filter chip (when deep-linked); activity list; pagination.
- **Actions:** Submit filter (`סינון`), clear filters (`ניקוי` → plain `Link` to base path), "הצג הכל" to drop only the instance filter while preserving other filters, expand raw JSON details per row (`<details>`/`<summary>` — no JS).
- **Forms / fields:** GET form — `q` (free-text search, `type="search"`), `entity` (select, `ACTIVITY_ENTITY_OPTIONS`), `action` (select, `ACTIVITY_ACTION_OPTIONS`), `actor` (select, `listActivityActorOptions(50)` + graceful fallback for an out-of-list selected actor), `from`/`to` (`DateSelectIL`). No client-side validation visible (server does the actual filtering; malformed input degrades to "no match" rather than an error).
- **Tables / lists:** `<ul className="space-y-3">` of card `<li>`s: action-type chip, summary text, actor chip, target chip (+ short event-id suffix), optional details chip, timestamp, optional collapsible raw-JSON (`entry.metaPreview`).
- **Status states:** No status enum — rows carry `entry.actionLabel` (free-form action taxonomy from `ACTIVITY_ACTION_OPTIONS`/`describeActivity`), not a badge/status-chip in the semantic sense (rendered as a neutral pill, not through the `Badge` component — see §3).
- **Empty / loading / error states:** Empty via `EmptyState` ("אין רשומות ביומן התואמות לסינון שבחרת."). Loading/error inherited from `admin/loading.tsx` / `admin/error.tsx` (no page-local override).
- **Existing shared components used:** `ui`: none directly in this file (`DateSelectIL` is `shared`, not `ui`). `shared`: `DateSelectIL` (`@/components/date-select-il`). `inline/local`: `PageHeading`, `EmptyState`, `Pagination`, `firstParam`, `formatDateTime`, `parsePageParam` (from `../_components`); `ActivityFilters` (defined in this file).
- **Components that should be reused:** The action/entity/state pill (`rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground`) is visually a badge but is hand-rolled inline instead of using the area's own `Badge` component from `_components.tsx` — inconsistent with `/admin/callbacks`, `/admin/orders`, `/admin/webhooks`, which all do use `Badge`. Should be reused/normalized.
- **Components that should be extracted:** `ActivityFilters` (this file) and `WebhookFilters` (`/admin/webhooks`) are near-duplicate filter-bar layouts (search input + N selects + two `DateSelectIL` + submit/clear buttons in a bordered card) — strong candidate for a shared `AdminFilterBar` composed from field slots. See §5.
- **Mobile considerations:** Filter grid is `grid gap-4 lg:grid-cols-6` — on mobile it's a single column (6 stacked fields including 2 date pickers), which is a long form to scroll through before reaching results; no `sm:`/`md:` intermediate step (jumps straight from 1-col to 6-col at `lg`). No fixed pixel widths found.
- **Desktop considerations:** At `lg:grid-cols-6` all filter fields sit on one row; reasonably compact.
- **RTL considerations:** No physical-direction classes found. `dir="ltr"` correctly applied to short instance-id fragments (`activeInstance.value!.slice(0, 8)`) and to the raw JSON `<pre>` block — appropriate use of `dir="ltr"` for non-Hebrew technical content per project convention.
- **Design risks:** Row card markup is duplicated with `/admin`'s recent-activity feed (drift risk, see above); the un-badged pill for `actionLabel` is a visual inconsistency vs. the rest of the admin-ops area.
- **Recommended redesign scope:** Light — mostly extraction/consistency work, no structural rework.

### /admin/callbacks
- **Route:** `/admin/callbacks`
- **Page name:** בקשות חזרה / Callback Requests
- **Component type:** Server (page) + Client (`CallbackStatusForm`)
- **Shell/Layout:** AdminShell
- **Current purpose:** List call-me-back requests submitted by site visitors; let an admin change each request's status.
- **Primary user goal:** Triage and close out callback requests.
- **Main content sections:** List of requests (name, phone, topic, note, created-at, status badge); per-row inline status-change form.
- **Actions:** Change status per row (select + "עדכון" submit button, `useActionState`-backed Server Action `updateCallbackStatusAction`).
- **Forms / fields:** `status` (select, `CALLBACK_STATUSES` enum plus a synthesized extra `<option>` for legacy/unknown stored values so the select never silently drops the current value), `id` (hidden). Validated server-side via `updateCallbackStatusSchema` (Zod); field errors surfaced via `FieldError`.
- **Tables / lists:** `<ul className="divide-y divide-border rounded-lg border border-border">` — one row per callback request; not a `<table>`.
- **Status states:** `new` (חדש), `in_progress` (בטיפול), `done` (טופל), `cancelled` (בוטל) — from `CALLBACK_STATUS_LABELS`/`CALLBACK_STATUSES`; unknown/legacy free-text values are shown as-is via `callbackStatusLabel()` fallback.
- **Empty / loading / error states:** Empty via `EmptyState` ("אין בקשות חזרה עדיין."). Loading/error inherited from area-wide files. Per-form errors: `FieldError`, `FormError`, `FormNotice` (all `@/components/forms`, `shared`) inside `CallbackStatusForm`.
- **Existing shared components used:** `ui`: none directly. `shared`: `FieldError`, `FormError`, `FormNotice` (`@/components/forms`). `inline/local`: `PageHeading`, `EmptyState`, `Pagination`, `Badge`, `formatDateTime`, `parsePageParam` (`../_components`); `CallbackStatusForm` (co-located).
- **Components that should be reused:** None — the status `<select>` + submit is a reasonable hand-rolled control since there's no shared `Select`/native-select wrapper mismatch here (project's `ui/select` is the Base UI popover select, not a plain native `<select>` — using native here for a tiny inline row control is a defensible, lighter-weight choice, not a bug).
- **Components that should be extracted:** The `<ul className="divide-y divide-border rounded-lg border border-border">` row-list wrapper is identical (byte-for-byte class list) across `/admin/callbacks`, `/admin/contacts`, `/admin/orders` — a shared `AdminList`/`AdminListItem` primitive would remove this triplication. See §5.
- **Mobile considerations:** Row layout is `flex-col` on mobile, `sm:flex-row` ≥ `sm` — status form moves below the request details on narrow screens, no overflow risk. No fixed widths found.
- **Desktop considerations:** Row becomes `sm:items-start sm:justify-between` — details left, status form right (logically: details start-side, form end-side).
- **RTL considerations:** No physical-direction classes found. `dir="ltr"` correctly applied to the phone number.
- **Design risks:** None significant beyond the general list-wrapper duplication.
- **Recommended redesign scope:** Light.

### /admin/contacts
- **Route:** `/admin/contacts`
- **Page name:** פניות / Contact Messages
- **Component type:** Server
- **Shell/Layout:** AdminShell
- **Current purpose:** Read-only view of contact-form submissions (name, email, phone, free-text message).
- **Primary user goal:** Review and respond to inbound inquiries (response itself happens outside the app, e.g. by phone/email).
- **Main content sections:** Paginated list of messages.
- **Actions:** Pagination only — no mutations, no per-row actions at all.
- **Forms / fields:** — (no form on this page; it is pure read + paginate)
- **Tables / lists:** `<ul className="divide-y divide-border rounded-lg border border-border">` of `<li>` rows: name, timestamp, `email · phone` (joined, `dir="ltr"`, falls back to `'—'` if both empty), free-text message (`whitespace-pre-wrap`).
- **Status states:** None — this entity has no status/lifecycle field surfaced in the UI.
- **Empty / loading / error states:** Empty via `EmptyState` ("אין פניות עדיין."). Loading/error inherited from area-wide files.
- **Existing shared components used:** `ui`: none. `shared`: none beyond area-local. `inline/local`: `PageHeading`, `EmptyState`, `Pagination`, `formatDateTime`, `parsePageParam` (`../_components`).
- **Components that should be reused:** N/A — page is minimal and already uses the shared area helpers.
- **Components that should be extracted:** Same `AdminList` row-wrapper duplication as callbacks/orders (§5). No page-specific extract candidates otherwise — this is the simplest page in the area.
- **Mobile considerations:** Single-column stacked layout throughout; no fixed widths, no overflow risk.
- **Desktop considerations:** Same content, more breathing room; nothing desktop-specific.
- **RTL considerations:** No physical-direction classes found. `dir="ltr"` correctly applied to the email/phone line.
- **Design risks:** This is the only one of the 4 "operational list" pages (callbacks/contacts/orders/webhooks) with zero actions and zero status — worth confirming with the product owner whether contact messages are meant to stay purely archival, or whether a "handled/unhandled" status (mirroring callbacks) is a planned gap. Flagging as `Needs verification` against product intent, not asserting it's a bug.
- **Recommended redesign scope:** None.

### /admin/orders
- **Route:** `/admin/orders`
- **Page name:** הזמנות / Orders
- **Component type:** Server (page) + Client (`ReconcileButton`)
- **Shell/Layout:** AdminShell
- **Current purpose:** Read-only view of every order across all events/customers, with a manual "reconcile" escape hatch for orders the automated payment flow couldn't resolve.
- **Primary user goal:** Spot stuck/failed payments and unstick them without touching SUMIT directly.
- **Main content sections:** Paginated order list: package name/tier, event name, status badge(s), created-at, price, conditional reconcile button(s).
- **Actions:** "בירור אוטומטי" (auto-reconcile, shown only when `status === 'payment_review'`) and "אפס לנכשל" (reset-to-failed, shown only when `order.isStuckProcessing`) — both POST JSON to `/api/admin/orders/[id]/reconcile` (a Route Handler, not inspected under this task's file list) and call `router.refresh()` on success.
- **Forms / fields:** — (no form; reconcile is a plain button + `fetch`, not a `<form>`)
- **Tables / lists:** `<ul className="divide-y divide-border rounded-lg border border-border">` of `<li>` rows.
- **Status states:** Order status (`order_status` enum, exhaustive `Record`): `pending` (ממתין, warning), `processing` (בעיבוד, info), `paid` (שולם, success), `failed` (נכשל, destructive), `demo` (הדגמה, info), `payment_review` (לבירור, warning) — from `ORDER_STATUS_LABELS`/`ORDER_STATUS_VARIANTS`. Plus two derived/synthetic badges: "תקוע" (stuck, warning, when `isStuckProcessing`) and "תוספת AI" (info, when `with_ai_addon`).
- **Empty / loading / error states:** Empty via `EmptyState` ("אין הזמנות עדיין."). Loading/error inherited from area-wide files. `ReconcileButton` surfaces its own inline error (`FormError`) and notice text for a legitimate no-op response — no toast system used (project has no shared Toast primitive, per spec).
- **Existing shared components used:** `ui`: none directly. `shared`: `FormError` (`@/components/forms`). `inline/local`: `PageHeading`, `EmptyState`, `Pagination`, `Badge`, `formatCurrency`, `formatDateTime`, `parsePageParam` (`../_components`); `ReconcileButton` (co-located).
- **Components that should be reused:** None outstanding.
- **Components that should be extracted:** Same `AdminList` row-wrapper duplication (§5). `ReconcileButton`'s pending/error/notice pattern (local `useState` × 3 + inline `fetch`) is structurally identical to what a Server Action + `useActionState` gives for free elsewhere in this same area (`CallbackStatusForm`) — inconsistent pattern for what is functionally the same "row action with pending/error/notice" shape; worth normalizing to one approach.
- **Mobile considerations:** Row is `flex items-center justify-between` (not `flex-col` on mobile, unlike callbacks) — with a long package name + tier + multiple badges + reconcile button(s) + price all in one row, this is a design risk on narrow viewports: nothing forces a wrap point other than `flex-wrap` on the inner badge row; the outer row itself does not have a `flex-col sm:flex-row` fallback the way callbacks does. `Needs verification` in-browser at ~360px, but the markup pattern differs from the (safer) callbacks pattern without an evident reason.
- **Desktop considerations:** Comfortable; price and reconcile button(s) align to the row's end.
- **RTL considerations:** No physical-direction classes found.
- **Design risks:** The mobile row-wrap risk above; also this is the only "list" page in the area that omits `sm:flex-row`/`flex-col` responsive stacking that its sibling pages (`/admin/callbacks`) use — inconsistent responsive pattern across otherwise-similar list pages.
- **Recommended redesign scope:** Light (mobile row-stacking fix + extraction), Medium if the reconcile-action pattern is also normalized to Server Actions for consistency.

### /admin/webhooks
- **Route:** `/admin/webhooks`
- **Page name:** בדיקת Webhooks / Webhook Inspector
- **Component type:** Server (page) + Client (`InspectorDrawer`, `CopyButton`, `PhoneReveal`, `PayloadViewer`, `ReprocessButton`/`ReprocessSubmit`)
- **Shell/Layout:** AdminShell
- **Current purpose:** Inspect the raw WhatsApp webhook inbox (`webhook_inbox` table) — health stats, filterable list, per-row detail drawer with PII reveal-on-demand, and manual reprocessing.
- **Primary user goal:** Diagnose delivery/processing failures for WhatsApp messages without direct DB access.
- **Main content sections:** 3 health-stat tiles (last received / unprocessed count / failed count); filter form; event list; pagination; URL-driven detail `Sheet` drawer (`?inspect=<id>`).
- **Actions:** Submit/clear filters; open a row → detail drawer; inside the drawer: reveal masked phone (`PhoneReveal`), reveal + copy raw JSON payload (`PayloadViewer` + `CopyButton`), copy individual technical IDs (`CopyButton`), reprocess the event (`ReprocessButton`, with a native `window.confirm()` guard before submit — this is the area's one destructive/re-triggering action).
- **Forms / fields:** GET filter form — `q` (free-text, `dir="ltr"` input, searches message id/context/phone_number_id), `kind` (select: `message`/`status`), `state` (select: `pending`/`processed`/`error`), `from`/`to` (`DateSelectIL`). Reprocess: `id` (hidden) POSTed to Server Action `reprocessWebhookEventAction`, validated with `z.object({ id: z.uuid() })`.
- **Tables / lists:** `<ul className="space-y-3">` of card `<li>`s (not a `<table>`) — each row is a full-card `Link` to the detail drawer, with a left-edge "stripe" color cue (`border-s-4 border-s-destructive` for errored, `border-s-warning` when the resolved delivery status is `failed`) — a status-cueing pattern not used elsewhere in this area.
- **Status states:** Two independent status dimensions surfaced per row: (1) processing state — `pending` (ממתין, warning), `processed` (עובד, success), `error` (שגיאה, destructive), derived client-independent via `webhookProcessState()`; (2) delivery status (Meta's free-text) — `sent`/`delivered`/`read`/`failed` (נשלח/נמסר/נקרא/נכשל), shown only when an association resolves one. Plus `kind`: `message` (הודעה, info) / `status` (סטטוס, neutral).
- **Empty / loading / error states:** Empty via `EmptyState`, with two variants depending on whether filters are active ("אין אירועי webhook התואמים לסינון." vs "...הם יופיעו כאן ברגע ש-Meta תשלח קריאה."). Loading/error inherited from area-wide files.
- **Existing shared components used:** `ui`: `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle` (`@/components/ui/sheet`). `shared`: `DateSelectIL` (`@/components/date-select-il`). `inline/local`: `Badge`, `EmptyState`, `PageHeading`, `Pagination`, `firstParam`, `formatDateTime`, `parsePageParam` (`../_components`); `WebhookDetail`, `InspectorDrawer`, `CopyButton`, `PhoneReveal`, `PayloadViewer`, `ReprocessButton` (co-located, split across `webhook-detail.tsx` + `webhook-inspector-client.tsx`).
- **Components that should be reused:** N/A — this is the most complete/idiomatic page in the area (correctly reaches for the real `ui/Sheet` rather than hand-rolling a drawer).
- **Components that should be extracted:** `HealthStat` (local, this file) — see §5 duplication with the dashboard's tile pattern. `WebhookFilters` — see §5 duplication with `ActivityFilters`. `CopyButton` — the code comment itself says "Mirrors channels-client's CopyRow", i.e. this is a *known*, self-acknowledged duplicate of a copy-to-clipboard control that already exists in `/admin/channels` (outside this task's scope) — strong candidate to promote to `@/components/copy-button.tsx`. `Field`/`Section` (in `webhook-detail.tsx`) — generic label/value row and bordered-section primitives, currently local to this one file; worth checking whether other admin detail views duplicate this shape before promoting.
- **Mobile considerations:** Health-stat row is `flex flex-wrap gap-3` — fine. Filter grid is `sm:grid-cols-2 lg:grid-cols-5`, better mobile step-down than `/admin/activity`'s single `lg:grid-cols-6` jump. `Sheet` drawer is `w-full` on mobile (`sm:max-w-md` above `sm`) — appropriate full-screen-on-mobile drawer behavior. No fixed pixel widths found.
- **Desktop considerations:** Drawer caps at `sm:max-w-md`; list rows are roomy.
- **RTL considerations:** No physical-direction classes found; `border-s-4`/`border-s-warning`/`border-s-destructive` correctly use logical `border-s-*` (start-edge) rather than `border-l-*`. `Sheet side="right"` is a physical value passed to the Base UI primitive, but the whole tree is wrapped in `AdminShell`'s `<DirectionProvider direction="rtl">` (`src/components/admin-shell.tsx:140`), which is exactly the fix the project's own established pattern requires for portaled Base UI components in RTL — not a risk here.
- **Design risks:** Two independent status vocabularies (processing state vs. delivery status) on one row could read as visually busy (up to 3 badges + a color stripe per row) — worth a design pass to see if stripe + badges are redundant signals for the same failure. PII handling (masked-by-default phone, reveal-gated payload) is a deliberate, good security pattern — noting it as a strength, not a risk.
- **Recommended redesign scope:** Light (extraction only — `HealthStat`, `CopyButton`, filter bar); the page's structure and security posture are otherwise sound.


---

## Admin · Catalog (Packages/Templates/Channels)

### /admin/packages
- **Route:** `/admin/packages`
- **Page name:** חבילות / Packages (catalog list)
- **Component type:** Server
- **Shell/Layout:** AdminShell
- **Current purpose:** List every package in the catalog (active + inactive), no pagination (catalog is small per code comment).
- **Primary user goal:** Scan the catalog at a glance, jump to create or edit a package.
- **Main content sections:** Header row (heading + "new package" link) → single list.
- **Actions:** "חבילה חדשה" (create, link to `/admin/packages/new`); each list row is a `<Link>` to `/admin/packages/[id]` (whole-row click target).
- **Forms / fields:** —
- **Tables / lists:** `<ul>` divided list (`divide-y`), not a `<table>`. Each `<li>` shows name, tier badge, conditional "לא פעילה" badge, category, price.
- **Status states:** `tier` (free-text string per `package-form.tsx`, not a fixed enum — **Needs verification** whether it's constrained elsewhere); `active`/inactive — only the inactive case renders a badge ("לא פעילה"); active packages show no badge (asymmetric).
- **Empty / loading / error states:** Inline `EmptyState` ("אין חבילות עדיין. צרו את החבילה הראשונה."). No route-local loading/error files (see §1 note).
- **Existing shared components used:** `PageHeading`, `EmptyState`, `Badge`, `formatCurrency` — all from `../_components` (ui: none directly).
- **Components that should be reused:** The "חבילה חדשה" link hand-rolls primary-button classes (`rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90`) instead of `<Button asChild>` from `@/components/ui/button`.
- **Components that should be extracted:** None unique to this page (see area-wide §5 for the cross-page Badge/pill duplication).
- **Mobile considerations:** Each `<li>` row is `flex items-center justify-between gap-4` with **no `flex-wrap`** — a long package name + tier badge + inactive badge + price on one line risks overflow/clipping under ~360px. Flag.
- **Desktop considerations:** Straightforward, no issues.
- **RTL considerations:** No physical left/right classes found; uses `gap`/logical spacing throughout.
- **Design risks:** Freeform `tier` badge (no enum → visual drift if admins type inconsistent values); hand-rolled "new" button drifts from `ui/button` styling over time; asymmetric active/inactive badge reads as a possible bug at a glance; unwrapped row risks mobile overflow.
- **Recommended redesign scope:** Light

### /admin/packages/new
- **Route:** `/admin/packages/new`
- **Page name:** חבילה חדשה / New Package
- **Component type:** Server (page) wrapping Client `PackageForm`
- **Shell/Layout:** AdminShell
- **Current purpose:** Create a new package, including optional campaign/outreach configuration.
- **Primary user goal:** Fill in base package fields and (optionally) enable + configure the campaign outreach schedule, then submit.
- **Main content sections:** Heading + back-to-list link → `PackageForm` (base fields → `<hr>` → "תצורת קמפיין (אופציונלי)" section with campaign fields + dynamic touchpoint rows).
- **Actions:** Submit (create); "+ הוספת שלב" (add outreach touchpoint row); "הסרה" (remove a touchpoint row, per-row); back-to-list link.
- **Forms / fields:** `name` (text, required), `tier` (text, required), `category` (text, required), `price_with_vat` (number, required, `dir="ltr"`), `description` (textarea), `includes` (textarea, one item per line), `sort_order` (number), `active` (checkbox, default true), `price_per_reached` (number, optional — empty ⇒ non-campaign package), `channels` (checkbox group: whatsapp/call), `outreach_schedule` (dynamic repeatable rows: `days_before` number, `channel` select, `message_key` text — synced into hidden `outreach_schedule_json`), `min_hold_floor` (number), `hold_buffer_pct` (number, displayed as percent). Server-validated via `packageBaseSchema`/`operationalFieldsSchema` (Zod) in `packages/actions.ts`; per-row field errors keyed `outreach_schedule.{i}.{field}`.
- **Tables / lists:** Dynamic touchpoint row list (`TouchpointRow`, repeated) — not a `<table>`.
- **Status states:** N/A (creation form). Inline amber warning per row when `channel === 'call'` ("לא מאומת — ערוץ ה-AI voice (Voximplant) טרם נבנה").
- **Empty / loading / error states:** No route-local loading/error. `FormError`/`FormNotice` render inline from `useActionState`.
- **Existing shared components used:** `PageHeading` (`../../_components`); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`).
- **Components that should be reused:** All text inputs/selects/textarea/checkboxes are raw HTML with a locally-defined `inputClass`/`labelClass` — expected since `Input`/`Textarea`/`Label`/`Checkbox` are not shared primitives per the spec's known-gaps list, but flagged as extract candidates below.
- **Components that should be extracted:** `TouchpointRow` (structured repeatable-row editor) is a reusable pattern in its own right. `inputClass`/`labelClass` literal Tailwind strings are independently redefined here AND in `templates-client.tsx` AND in `channels-client.tsx` (3 separate copies of essentially the same classes) — extract to shared `Input`/`Label` components.
- **Mobile considerations:** `TouchpointRow`'s grid (`sm:grid-cols-[6rem_10rem_1fr_auto]`) correctly collapses to one column below `sm`. The base-fields/campaign-fields grids (`sm:grid-cols-2`) are responsive. Overall single-column mobile-first layout — no fixed-pixel-width or overflow risk found.
- **Desktop considerations:** `mx-auto max-w-2xl` centers the form; fine.
- **RTL considerations:** `dir="ltr"` is deliberately applied to all numeric/id-like fields (`price_with_vat`, `sort_order`, `price_per_reached`, `min_hold_floor`, `hold_buffer_pct`, `days_before`, `message_key`) — consistent, intentional pattern, not a bug. No physical left/right classes found.
- **Design risks:** Very long single form (base + full campaign config) with only an `<hr>`+`<h2>` as a visual section break — could feel overwhelming on first use; a `call` touchpoint can be configured for a channel that isn't built yet (Voximplant), gated only by a small amber inline warning, not a hard block; the row-remove "הסרה" control is a plain text link, not a real destructive-styled button.
- **Recommended redesign scope:** Medium (extract form primitives + touchpoint editor; consider splitting base vs. campaign config into steps/tabs)

### /admin/packages/[id]
- **Route:** `/admin/packages/[id]`
- **Page name:** עריכת חבילה / Edit Package
- **Component type:** Server (async; `getPackage(id)` → `notFound()` on missing id)
- **Shell/Layout:** AdminShell
- **Current purpose:** Edit an existing package's base + campaign fields; delete the package.
- **Primary user goal:** Update and save fields; optionally delete the package.
- **Main content sections:** Heading + back-to-list link → `PackageForm` (pre-filled) → border-divided "danger zone" with `DeletePackageForm`.
- **Actions:** Submit (save changes, stays on page with a `FormNotice`); delete (confirm-gated via native `window.confirm`, redirects to list on success); back-to-list link.
- **Forms / fields:** Same field set as `/admin/packages/new`, pre-populated from `getPackage()` (including `hold_buffer_pct` converted fraction→percent via `holdBufferFractionToPercent`). `DeletePackageForm` has no fields, just a submit.
- **Tables / lists:** Same touchpoint row list as `/new`.
- **Status states:** Same as `/new` (reuses `PackageForm`).
- **Empty / loading / error states:** `getPackage()` 404s via `notFound()`; no route-local `not-found.tsx` (see §1). No route-local loading/error otherwise.
- **Existing shared components used:** `PageHeading`, `PackageForm`, `FormError` (in `DeletePackageForm`).
- **Components that should be reused:** The delete button hand-rolls destructive styling (`bg-destructive/10 ... text-destructive`) instead of `<Button variant="destructive">` from `@/components/ui/button`.
- **Components that should be extracted:** `DeletePackageForm`'s pattern (native `window.confirm` guard + destructive submit button + `FormError`) is a "danger zone" pattern worth a shared `ConfirmDeleteForm` if repeated elsewhere in admin (**Needs verification** — not confirmed outside this file's scope).
- **Mobile / Desktop considerations:** Same as `/new` (shared `PackageForm`).
- **RTL considerations:** Same as `/new`.
- **Design risks:** Same as `/new`, plus: the destructive delete flow relies on the browser-native `confirm()` dialog rather than an in-app modal — reasonable today since no `Dialog` primitive exists in the codebase at all (per spec's known-gaps list; `sheet` exists but isn't used here), but worth flagging if a `Dialog` primitive is ever added.
- **Recommended redesign scope:** Medium

### /admin/templates
- **Route:** `/admin/templates`
- **Page name:** תבניות פנייה / Message Templates
- **Component type:** Server (async page) wrapping Client `TemplatesClient`
- **Shell/Layout:** AdminShell
- **Current purpose:** Manage outreach message-template content (WhatsApp Meta-approved template name, or call script) and each template's active flag. Seeded fail-closed (inactive until content + activation).
- **Primary user goal:** Find a template by label/key, edit name/language/body, and toggle active.
- **Main content sections:** `PageHeading` → one card `<section>` (intro paragraph) → `TemplatesClient`: one independent form-card per template.
- **Actions:** Per-template save (each `TemplateForm` has its own `useActionState`, independent of siblings).
- **Forms / fields:** Per template: `name` (text), `language` (text, default `he`), `body` (textarea, 2 rows for WhatsApp / 4 rows for call), `active` (checkbox). Server-validated (Zod, `templates/actions.ts`); fail-closed rule: cannot activate a template with both `name` and `body` empty.
- **Tables / lists:** List of card-style forms (`space-y-4`), one per template — not a `<table>`.
- **Status states:** active pill ("פעיל" / "כבוי"); channel pill ("שיחה" / "WhatsApp") — both hand-rolled inline, see below.
- **Empty / loading / error states:** **No empty state** — if `templates` is `[]`, `TemplatesClient` renders nothing (no message). No route-local loading/error.
- **Existing shared components used:** `PageHeading` (`../_components`); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`); `HelpTip` (`@/app/(admin)/admin/agreement/help-tip` — cross-route-group import, not in the spec's known-shared list).
- **Components that should be reused:** The active/inactive pill (`template.active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/30 bg-amber-500/10 text-amber-600'`) duplicates the `Badge` component from `../_components.tsx`, which already has matching `success`/`warning` variants for exactly this case — should use `<Badge variant="success">`/`<Badge variant="warning">` instead. Also redefines `inputClass`/`labelClass` locally (3rd copy area-wide, see §5).
- **Components that should be extracted:** The per-template "card with header pill row + form + save button" shape repeats structurally in `ChannelsClient`'s WhatsApp panel — a shared `SettingsCard` wrapper could serve both.
- **Mobile considerations:** `grid gap-3 sm:grid-cols-2` (name/language) collapses to one column on mobile — fine. Header `flex flex-wrap items-center justify-between gap-2` wraps correctly. The `<code>{template.message_key}</code>` tag has **no truncation/overflow handling** — a long key could overflow on narrow screens (contrast with `channels-client.tsx`'s `CopyRow`, which does truncate). Flag.
- **Desktop considerations:** Cards always render single-column (`space-y-4`) regardless of viewport width — not a bug, just unused width at wide desktop sizes.
- **RTL considerations:** No physical left/right classes found.
- **Design risks:** Hand-rolled status/channel pills duplicate the existing `Badge` primitive (color-drift risk since the classes are literal here vs. centralized in `Badge`'s `cva`); missing empty state; un-truncated `<code>` key.
- **Recommended redesign scope:** Light

### /admin/channels
- **Route:** `/admin/channels`
- **Page name:** ערוצי תקשורת / Communication Channels
- **Component type:** Server (async page) wrapping Client `ChannelsClient`
- **Shell/Layout:** AdminShell
- **Current purpose:** Configure the WhatsApp Cloud API provider (credentials + webhook wiring info) and a master `outreach_enabled` switch. Voximplant tab reserved and disabled for the future AI-call channel (C2).
- **Primary user goal:** Enter/update WhatsApp credentials, flip the enabled switch, copy webhook config values into Meta, test the connection.
- **Main content sections:** `PageHeading` → card `<section>` (intro) → `ChannelsClient`: `Tabs` (WhatsApp / Voximplant-disabled) → within WhatsApp tab: enabled-toggle row with `StatusBadge` → `Accordion` ("פרטי התחברות" credentials panel, "חיווט Webhook" info panel with `CopyRow`s) → submit button; separate small form below for "בדיקת חיבור" (test connection).
- **Actions:** Save channel config (submit, includes the `outreach_enabled` checkbox in the same form); copy-to-clipboard (`CopyRow` for callback URL / verify token); toggle secret visibility (`Eye`/`EyeOff` on Access Token / App Secret via `SecretField`); test connection (separate independent form/submit).
- **Forms / fields:** `whatsapp_phone_number_id` (text), `whatsapp_waba_id` (text, with `HelpTip`), `whatsapp_access_token` (password-toggle, with `HelpTip`), `whatsapp_app_secret` (password-toggle, with `HelpTip`), `whatsapp_verify_token` (text, with `HelpTip`), `outreach_enabled` (checkbox). Server-validated (Zod, `channels/actions.ts`); fail-closed: cannot enable without `whatsapp_phone_number_id` + `whatsapp_access_token`.
- **Tables / lists:** None — `Accordion` sections instead.
- **Status states:** `StatusBadge` — 3 states: "פעיל" (enabled), "מוגדר · כבוי" (configured but disabled), "לא מוגדר" (not configured); the WhatsApp tab label itself also appends a redundant ✓/⚠ suffix computed from `whatsapp.configured`.
- **Empty / loading / error states:** No empty state needed (form always renders). No route-local loading/error.
- **Existing shared components used:** `PageHeading`; `Tabs`/`TabsList`/`TabsTab`/`TabsPanel` (`@/components/ui/tabs`); `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionPanel` (`@/components/ui/accordion`); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`); `HelpTip` (cross-route-group, same as templates).
- **Components that should be reused:** `StatusBadge` is a **third** independent hand-rolled status-pill implementation in this area (after packages' generic `Badge` usage and templates' inline pill) — should route through the shared `Badge` (`../_components`) using its `success`/`warning`/`neutral` variants instead of a bespoke `[text, cls]` tuple. `inputClass`/`labelClass` redefined a third time (see §5).
- **Components that should be extracted:** `SecretField` (show/hide password-style field) and `CopyRow` (label + monospace value + copy button) are strong, self-contained extract candidates — likely reusable anywhere else in admin that edits secrets (**Needs verification** — outside this audit's file scope).
- **Mobile considerations:** `SecretField`'s eye-toggle button uses `absolute inset-y-0 end-0` (logical, RTL-safe). `CopyRow`'s `<code>` uses `min-w-0 flex-1 truncate` — correctly handles overflow (contrast with templates' un-truncated `<code>`, a good pattern to propagate). `Tabs`/`Accordion` collapse fine on narrow widths; no fixed-pixel widths found.
- **Desktop considerations:** No issues found.
- **RTL considerations:** `SecretField`/`CopyRow` use logical `pe-10`/`end-0` correctly. No physical left/right classes found anywhere in `channels-client.tsx`.
- **Design risks:** Clearest duplication case in the whole area — 3 independent hand-rolled status-pill implementations across packages/templates/channels. Secrets (`whatsapp_access_token`, `whatsapp_app_secret`) are rendered into the client as `defaultValue` on a togglable `type="password"` input — **Needs verification** whether `getWhatsAppChannelConfig()` (data layer, outside this file's scope) returns the real secret value or a masked placeholder to the browser; worth flagging to a security-focused reviewer even though it's outside this structural audit.
- **Recommended redesign scope:** Light–Medium (badge/pill consolidation; extract `SecretField`/`CopyRow`)


---

## Admin · Config & Users

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
- **Components that should be reused:** `@/components/ui/card`; `@/components/ui/switch` exists as a shared primitive but all 4 boolean toggles (`payments_enabled`, `sms_enabled`, `email_enabled`, `smtp_secure`) are hand-rolled native checkboxes styled with `accent-primary` instead; `@/components/ui/input` — all 11 text/maskable fields hand-roll a native `<input>` with a local `inputClass` instead of the existing `Input` primitive.
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
