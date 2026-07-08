# Area: Auth (login, signup, forgot/reset password, confirm)
_Files read: 6 pages, 6 co-located components (login-form, signup-form, password-field, forgot-password-form, reset-password-form, confirm/actions.ts+otp-types.ts), plus shared `../actions.ts` (auth-root Server Actions), `@/components/forms.tsx`, `@/components/password-input.tsx`, `src/app/layout.tsx`, `src/lib/validation/schemas.ts`._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/auth/login` | `src/app/auth/login/page.tsx` | Server | Root-only | Email+password sign-in |
| `/auth/signup` | `src/app/auth/signup/page.tsx` | Server | Root-only | Account creation |
| `/auth/signup/success` | `src/app/auth/signup/success/page.tsx` | Server | Root-only | Post-signup "check your email" interstitial |
| `/auth/forgot-password` | `src/app/auth/forgot-password/page.tsx` | Server | Root-only | Request password-reset email |
| `/auth/reset-password` | `src/app/auth/reset-password/page.tsx` | Server (async) | Root-only | Set new password after recovery link |
| `/auth/confirm` | `src/app/auth/confirm/page.tsx` | Server (async) | Root-only | Generic OTP-link interstitial (POST-verifies token_hash) |

No `loading.tsx` / `error.tsx` / `not-found.tsx` exist anywhere under `src/app/auth/` — confirmed via `find`. All loading/error/empty states are inline (see §3).

Not in my assignment but touched as shared code: `src/app/auth/actions.ts` (login/signup/requestPasswordReset/updatePassword Server Actions), `src/app/auth/confirm/actions.ts` + `otp-types.ts` (confirmOtp Server Action).

## 2. Design Briefs

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

## 3. UI Elements Per Page

### /auth/login
- buttons: `SubmitButton` (shared, wraps `ui` Button, `type=submit`, full-width) — "התחברות"
- inputs / selects / search / filters: raw `<input type=email>` (inline/local); `PasswordInput` (shared, `@/components/password-input`)
- cards / tables / lists: none (page itself is the "card" via `max-w-md` wrapper, not a `ui/card`)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError` (shared) for generic invalid-credential message; `SubmitButton` pending label "רגע…"
- destructive actions: none

### /auth/signup
- buttons: `SubmitButton` (shared) — "הרשמה"
- inputs / selects / search / filters: raw `<input>` ×3 (full_name, email, phone — inline/local); `PasswordInput` via local `PasswordField` wrapper (co-located `password-field.tsx`)
- cards / tables / lists: none
- badges / status chips: strength-meter bar (`h-1.5 w-full rounded bg-muted` + colored fill, inline/local in `password-field.tsx`) — not a badge but a custom meter widget, not shared
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError`, `FormNotice` (shared, notice currently unreachable — see brief)
- destructive actions: none

### /auth/signup/success
- buttons: hand-rolled `<Link>` styled as button (inline/local, NOT via shared `Button`) — "מעבר להתחברות"; plain text `<Link>` — "הרשמה מחדש"
- inputs / selects / search / filters: none
- cards / tables / lists: icon badge (inline/local, circular `bg-primary/10` wrapping lucide `MailCheck`)
- badges / status chips: none (the icon badge above is decorative, not a status chip)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: N/A — this page IS the success state
- destructive actions: none

### /auth/forgot-password
- buttons: `SubmitButton` (shared) — "שליחת קישור איפוס"
- inputs / selects / search / filters: raw `<input type=email>` (inline/local)
- cards / tables / lists: none
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError`, `FormNotice` (shared) — notice is the reachable success message here
- destructive actions: none

### /auth/reset-password
- buttons: `SubmitButton` (shared) — "עדכון סיסמה"
- inputs / selects / search / filters: `PasswordInput` ×2 (shared, password + confirm)
- cards / tables / lists: none
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError` (shared, in-form); inline server-rendered "link invalid/expired" branch (not a shared EmptyState component — conditional JSX in `page.tsx`)
- destructive actions: none (setting a new password is not itself destructive, though it does invalidate the recovery flow's usefulness — not flagged as a destructive-action button)

### /auth/confirm
- buttons: `SubmitButton` (shared) — "המשך"
- inputs / selects / search / filters: none visible (3 hidden inputs only)
- cards / tables / lists: none
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: none inline — errors are hard redirects to `/auth/login` (see brief)
- destructive actions: none

## 4. Responsive & RTL Findings

### /auth/login: mobile-fit = yes; wide areas: none (max-w-md, no fixed px widths); RTL risks: email `<input>` lacks `dir="ltr"` (signup's equivalent field sets it — inconsistency, not a bug); "forgot password" link correctly uses `text-end` (logical, not `text-right`).

### /auth/signup: mobile-fit = yes; wide areas: none; RTL risks: none found — email/phone correctly forced `dir="ltr"`, full_name left RTL-default; no physical-direction classes.

### /auth/signup/success: mobile-fit = yes; wide areas: none; RTL risks: none found; icon uses `aria-hidden` correctly, no directional classes.

### /auth/forgot-password: mobile-fit = yes; wide areas: none; RTL risks: email `<input>` lacks `dir="ltr"` (same as login).

### /auth/reset-password: mobile-fit = yes; wide areas: none; RTL risks: none found (both fields are opaque password values, `dir` is moot); server-conditional branches don't introduce layout width issues.

### /auth/confirm: mobile-fit = yes; wide areas: none; RTL risks: none found — minimal content, no directional classes.

**Area-wide:** No physical-direction Tailwind classes (`left/right`, `ml-/mr-/pl-/pr-`, `text-left/right`) found anywhere in the 6 pages or their co-located components — this area is clean on that axis. No fixed pixel widths beyond the intentional `max-w-md` cap (≈448px, well above a 360px viewport since the container also has `px-6` and is itself constrained by the viewport, not a hard min-width). No tables in this area. No horizontal-scroll risk anywhere.

## 5. Duplications & Extract Candidates

- **Auth-card page wrapper** (`<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">` + a `space-y-1 text-center` title/subtitle block) → seen identically in `login/page.tsx`, `signup/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`, `signup/success/page.tsx` (adds `text-center` to `main`), `confirm/page.tsx` (adds `text-center` to `main`) → **suggest extract as `AuthCard`** (a layout component taking `title`, `subtitle`/`description`, and `children`), used by all 6 pages. This is the single biggest duplication in the area — 6/6 pages hand-roll the identical wrapper markup and class list.
- **Bottom "switch flow" link row** (`<p className="text-center text-sm text-muted-foreground">...<Link className="font-medium text-primary hover:underline">`) → seen in `login/page.tsx` (→ signup), `signup/page.tsx` (→ login), `forgot-password/page.tsx` (→ login) → could be folded into the `AuthCard` extraction as an optional `footer` slot, or kept as a small `AuthSwitchLink` helper.
- **Raw `<input>` + `<label>` pattern** (`className="w-full rounded-md border border-border bg-transparent px-3 py-2"` + `mb-1 block text-sm font-medium` label) → repeated 6× across login (email), signup (full_name, email, phone), forgot-password (email) → this is a codebase-wide gap (no shared `Input`/`Label` primitive per the known-primitives list), not unique to auth, but this area alone has 6 duplicate instances of the exact same class string. Worth flagging up to the orchestrator as cross-area evidence for prioritizing an `Input`/`Label` primitive.
- **Password-strength meter reuse gap**: `PasswordField` (signup) already encapsulates a reusable strength-meter widget on top of the shared `PasswordInput`, but `reset-password-form.tsx` — which also sets a new password subject to the identical `newPasswordField` Zod rule — uses plain `PasswordInput` with no meter. Since `PasswordField` is already a real, working component (not hypothetical), the fix is straightforward reuse rather than new extraction: swap `reset-password-form.tsx`'s password `PasswordInput` for `PasswordField`.
- **`FormNotice` dead path in signup**: `signup-form.tsx` imports and renders `FormNotice`, but `signup()` in `../actions.ts` never returns a `notice` (it always redirects). Not a duplication issue but a leftover from likely earlier iteration — low-risk cleanup candidate, flagged for awareness rather than as a design-system extract.
- **Success/interstitial icon badge** (`grid size-14 place-items-center rounded-full bg-primary/10 text-primary` wrapping a lucide icon) in `signup/success/page.tsx` → only one instance in this area; Needs verification whether this pattern repeats in other areas (e.g. RSVP confirmation) — if so, extract as `IconBadge`.

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: `Button` (indirectly, via `SubmitButton` in `@/components/forms.tsx`) — no direct `@/components/ui/*` imports in any of the 6 auth pages/forms themselves.
- from `@/components`: `SubmitButton`, `FieldError`, `FormError`, `FormNotice` (all from `forms.tsx`, used across login/signup/forgot-password/reset-password/confirm); `PasswordInput` (`password-input.tsx`, used in login/signup(via PasswordField)/reset-password).
- inline/local components defined in this area:
  - `src/app/auth/login/login-form.tsx` → `LoginForm` (client form, email+password)
  - `src/app/auth/signup/signup-form.tsx` → `SignupForm` (client form, full_name+email+phone+password)
  - `src/app/auth/signup/password-field.tsx` → `PasswordField` (client, password input + lazy-loaded strength meter, wraps shared `PasswordInput`)
  - `src/app/auth/forgot-password/forgot-password-form.tsx` → `ForgotPasswordForm` (client form, email)
  - `src/app/auth/reset-password/reset-password-form.tsx` → `ResetPasswordForm` (client form, password+confirm)
  - `src/app/auth/confirm/actions.ts` → `confirmOtp` (Server Action, not a component but the sole handler for the confirm form)
  - `src/app/auth/confirm/otp-types.ts` → `CONFIRM_OTP_TYPES`/`isConfirmOtpType` (type guard, not a UI component)
