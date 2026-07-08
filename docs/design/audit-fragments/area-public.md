# Area: Public + Root

_Files read: 7 pages/route-handlers (page.tsx ×6, route.ts ×1), 3 co-located components (`_legal.tsx`, `rsvp-form.tsx`, `actions.ts` ×2), root layout.tsx, not-found.tsx, global-error.tsx._

## 1. Inventory Rows

| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/` | `src/app/(public)/page.tsx` | Server | Root-only | Marketing landing page |
| `/privacy` | `src/app/(public)/privacy/page.tsx` | Server | Root-only | Privacy policy (draft, legal) |
| `/terms` | `src/app/(public)/terms/page.tsx` | Server | Root-only | Terms of service (draft, legal) |
| `/join/[token]` | `src/app/(public)/join/[token]/page.tsx` | Server | Root-only | Org invitation acceptance |
| `/r/[token]` | `src/app/(public)/r/[token]/page.tsx` | Server | Root-only | **Public guest RSVP** (token-gated) |
| `/g/[token]` | `src/app/(public)/g/[token]/route.ts` | Route Handler (no UI) | n/a | Gift-link redirect (302 to owner's bit/PayBox URL); not a page, no brief below |
| n/a | `src/app/layout.tsx` | Server | Root layout | `<html lang="he" dir="rtl">`, Heebo font, wraps every route in the app incl. public/auth |
| n/a (404) | `src/app/not-found.tsx` | Server | Root-only | Global 404 for unmatched routes |
| n/a (error boundary) | `src/app/global-error.tsx` | Client (`'use client'`) | Replaces root layout | Top-level error boundary, renders own `<html>/<body>` |

Co-located, non-route files: `src/app/(public)/_legal.tsx` (shared `LegalShell`/`LegalSection` for privacy+terms), `src/app/(public)/join/[token]/actions.ts` (Server Action), `src/app/(public)/r/[token]/rsvp-form.tsx` (Client Component, the RSVP form itself), `src/app/(public)/r/[token]/actions.ts` (Server Action).

## 2. Design Briefs

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

## 3. UI Elements Per Page

### `/`
- buttons: header "לאזור האישי"/"צרו אירוע"/"כניסה" links styled as buttons (inline/local, hand-rolled `bg-primary` classes, not `ui/button`); hero primary CTA + "צפו בהדגמה קצרה" outline-style anchor (inline/local); Features-section "אירוע חדש"/"התחילו עכשיו" CTA (inline/local); Closing-CTA two buttons (inline/local, one dark solid, one translucent-white outline)
- inputs / selects / search / filters: none
- cards / tables / lists: Hero dashboard-preview card (inline/local, static fake data); Problem list (4 items, inline/local); Solution list (4 items, inline/local, dark card); Feature cards ×7 + 1 CTA card (inline/local grid); Step cards ×6 (inline/local grid); Trust cards ×4 (inline/local, dark section); Audience cards ×6 (inline/local grid); Footer link columns ×3 (inline/local, non-interactive `<span>` placeholders, not real links)
- badges / status chips: hero-mock guest-status pills ("אישרו"/"ממתין"/"לא מגיע") — inline/local, hardcoded fake colors (`bg-emerald-50 text-emerald-700` etc.); hero-mock "248 אישרו" pill — inline/local
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: none present
- destructive actions: none

### `/privacy`
- buttons: none (only the `←` text back-link, styled as a plain text link)
- inputs / selects / search / filters: none
- cards / tables / lists: one `<ul>` bullet list (data types collected); company-footer block (shared, from `LegalShell`)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: none; draft-warning `role="note"` banner (shared, from `LegalShell`, amber)
- destructive actions: none

### `/terms`
- buttons: none (same `←` back-link as `/privacy`)
- inputs / selects / search / filters: none
- cards / tables / lists: none (all prose)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: none; same shared draft-warning banner
- destructive actions: none

### `/join/[token]`
- buttons: "הצטרפות" submit (inline/local `<button>`, not `SubmitButton`/`ui/button`)
- inputs / selects / search / filters: one hidden `<input type="hidden" name="token">`
- cards / tables / lists: none — single text block
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: two inline `role="alert"` red banners (invalid-token; accept-failed) — inline/local, no shared `Alert`
- destructive actions: none (joining an org is not framed/styled as destructive; arguably should be neutral, which it correctly is)

### `/r/[token]`
- buttons: 3-way status toggle buttons (inline/local); `Stepper` +/− buttons ×2 instances (adults, kids — local component in `rsvp-form.tsx`); `SubmitButton` (**shared**, `@/components/forms`, wraps `ui/button`)
- inputs / selects / search / filters: hidden `status`/`adults`/`kids` inputs; `meal_pref` text input (conditional); dynamic `answer_<q_key>` `<select>` or `<input type="text">` per event question; `note` `<textarea>` — all inline/local, no shared `Input`/`Textarea`/`Select` primitives used (matches spec note that `Textarea`/`Label` don't exist as shared primitives yet)
- cards / tables / lists: invite-image hero card (inline/local, `next/image`); gift-link CTA card (inline/local)
- badges / status chips: none (status is expressed via the 3-way toggle's selected state, not a chip)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: rate-limit amber banner, invalid-token red banner (both in `page.tsx`), deadline-passed amber notice, success green notice, per-field `FieldError`, form-level `FormError` (all in `rsvp-form.tsx`) — mix of shared (`FieldError`/`FormError`, from `@/components/forms`) and inline/local (the 4 banners)
- destructive actions: none (declining an RSVP is a normal choice, correctly not styled as destructive)

## 4. Responsive & RTL Findings

### `/`: mobile-fit = partial; wide areas: none overflow-risk (all grids collapse to 1 col via `sm:`/`lg:` breakpoints, `max-w-6xl` container with `px-6` padding); RTL risks: none found (no physical-direction classes; `ArrowLeft` icon correctly used as the RTL "forward" chevron). Mobile gap: in-page nav (`#features`/`#how`/`#trust`) is `hidden md:flex` with **no hamburger/mobile-menu fallback** — those three nav links are simply inaccessible below `md`, not an overflow bug but a real navigation gap.

### `/privacy`: mobile-fit = yes; wide areas: none (single-column prose, `max-w-3xl`, no tables/fixed widths); RTL risks: minor — literal `←` glyph in the back-link text (in shared `_legal.tsx`) instead of a logical icon component; visually correct but inconsistent with the icon-based arrows used elsewhere (landing page).

### `/terms`: mobile-fit = yes; wide areas: none; RTL risks: same shared `←` glyph issue as `/privacy` (one shared source, `_legal.tsx`).

### `/join/[token]`: mobile-fit = yes; wide areas: none (`max-w-md`, single column, no tables); RTL risks: none found.

### `/r/[token]`: mobile-fit = yes overall (`max-w-md`, explicit mobile-first `min-h-svh` centering); wide areas: none — no fixed pixel widths, no tables, `next/image` invite hero scales via `w-full h-auto`; RTL risks: none found (no physical-direction classes, external links correctly use `rel="noreferrer"/"noopener noreferrer"`). Note: not an RTL issue but a touch-target concern — the `Stepper` +/− buttons are `h-9 w-9` (36px), under the 44px minimum commonly recommended for mobile tap targets, on the single most mobile-heavy page in the product.

## 5. Duplications & Extract Candidates

- **Alert/Banner pattern** (`role="alert"`/`role="status"`, `rounded-md px-3 py-2 text-sm` + color variant: red/`destructive`, amber/warning, green/success) → seen in `/join/[token]/page.tsx` (×2, red), `/r/[token]/page.tsx` (×2: red invalid-token, amber rate-limit), `/r/[token]/rsvp-form.tsx` (×2: amber deadline-passed, green success) → suggest extract as `Alert` (variants: `destructive`/`warning`/`success`/`info`), confirming the spec's flagged gap that no shared Alert/Banner primitive exists yet. This is the single highest-value extraction found in this area — 6 near-identical hand-rolled instances across 3 files.
- **Landing-page CTA buttons** (`inline-flex items-center gap-2 rounded-md bg-primary px-… text-primary-foreground hover:opacity-90` and the outline variant `border border-border … hover:bg-[#f9fafb]`) → seen ×8 across `(public)/page.tsx` (header ×2, hero ×2, features ×1, closing-CTA ×2, plus the "outline" demo-video link) → suggest replacing with `Button` (`variant="default"`/`"outline"`) — colors are out of scope for this audit but the *pattern* duplication itself is worth flagging.
- **Icon-badge feature-card pattern** (rounded icon container + bold title + muted description, in a bordered card, `hover:-translate-y-1 hover:shadow-md`) → seen in Features grid, How-it-works Steps grid, and (variant, borderless) Trust grid, all in `(public)/page.tsx` → suggest extract as `IconFeatureCard` if this page is revisited.
- **`SubmitButton` non-adoption** → `/join/[token]/page.tsx` hand-rolls a plain `<button>` instead of importing the already-shared `SubmitButton` from `@/components/forms` (which `/r/[token]/rsvp-form.tsx` correctly uses) → not a new component to build, just a reuse fix.
- **Segmented/toggle-button group** (`RsvpForm`'s 3-way attending/maybe/declined selector: `aria-pressed`, selected vs unselected border/bg classes) → currently a single instance, but structurally identical to a `ButtonGroup`/`ToggleGroup` primitive if any other part of the app needs a similar picker (Needs verification — outside this area's scope to confirm).

## 6. Shared Components Referenced (from imports)

- from `@/components/ui`: none imported directly in this area (`SubmitButton` wraps `Button` internally, but no public-area file imports `ui/button` or any other `ui/*` primitive directly)
- from `@/components`: `FieldError`, `FormError`, `SubmitButton` (all from `@/components/forms`, used only in `r/[token]/rsvp-form.tsx`)
- inline/local components defined in this area:
  - `src/app/(public)/_legal.tsx` → `LegalShell` (page chrome: back-link, title, draft banner, company-footer) + `LegalSection` (title+prose wrapper); used by `/privacy` and `/terms`
  - `src/app/(public)/page.tsx` → `Eyebrow` (small icon+label kicker, local to this file only)
  - `src/app/(public)/r/[token]/page.tsx` → `Shell` (centered `<main>` wrapper, local to this file only, reused across its own 3 render branches)
  - `src/app/(public)/r/[token]/rsvp-form.tsx` → `Stepper` (accessible +/− counter control, local to this file, used twice for adults/kids), plus module-level helpers `asEventType`, `formatEventDateLine` (not components)
