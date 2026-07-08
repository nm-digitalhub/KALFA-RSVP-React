# KALFA — Design Audit — Executive Summary

> The one-page read. Full detail in: `page-inventory.md`, `page-design-briefs.md`,
> `ui-component-inventory.md`, `reusable-components-plan.md`, `responsive-rtl-audit.md`.
> Method: a 10-agent code-audit team read every route in full (SPEC-driven), cross-checked live on
> `beta.kalfa.me`, and every headline claim below was re-verified against the source. Produced 2026-07-08.
> **Colors are out of scope** (per request) — this audit is about structure, components, layout, and RTL.

---

## By the numbers

| Metric | Value |
|---|---|
| Pages scanned (`page.tsx`) | **45** (Public 5 · Auth 6 · Customer 17 · Admin 17), + 3 shells/layouts, 3 loading, 3 error, 3 not-found. **Verified: 45 `page.tsx` files ↔ 45 briefs, 0 gaps.** |
| Areas | **4 route groups** (public / auth / customer / admin), audited as **9 sub-areas** |
| Shared **primitives** (`src/components/ui/*`) | **16** (accordion, button, card, chart, collapsible, dropdown-menu, input, scroll-area, select, separator, sheet, sidebar, skeleton, switch, tabs, tooltip) |
| Shared **composed** (`src/components/*`) | **8** (AdminShell, AppShell, OrgSwitcher, forms.tsx kit, DateSelectIL, TimeSelect24, PasswordInput, + version-skew hook) |
| Render model | **Every `page.tsx`/`layout.tsx` is a Server Component**; interactivity is in co-located `*-form.tsx`/`*-client.tsx` |
| RTL hygiene | **Strong** — near-zero physical-direction classes app-wide; 4 small isolated defects |

---

## The core problem: a good primitive set, under-used and mis-located

KALFA already has a solid component library. The issues are **not** "missing design system" — they are
**(a) shared components living in the wrong place, (b) primitives that exist but aren't used, and
(c) the same handful of patterns hand-rolled over and over.**

### Top duplications / inconsistencies (all verified against code)

1. **No shared `Badge` — yet Badge is everywhere.** The de-facto Badge lives in `(admin)/admin/_components.tsx`
   and is imported **across the route-group boundary** by 4 customer files (`campaign-section.tsx`,
   `guests/page.tsx`, `guests/[guestId]/page.tsx`, `guests/labels.ts`) — a real layering violation. A **second,
   independent `Badge`** is hand-rolled in `team-client.tsx:24`. Plus several inline status pills. → **Promote to
   `ui/badge.tsx` (P0).**
2. **`ui/card` exists but is imported in 0 files.** Every "card" in the app is a hand-rolled `<div className="rounded-lg border …">`. → Adopt `Card`.
3. **No shared `Alert`/`Banner`, `Textarea`, `Label`, `Table`, `Dialog`** (all verified absent from `ui/`). Result:
   6+ hand-rolled alert banners (RSVP/join + literal-color `bg-*-50` banners in billing), raw `<textarea>`/`<label>`/`<input>` with duplicated class strings, 2 hand-written `<table>`s, and modal needs met only by `Sheet`.
4. **`Input` exists but is bypassed area-wide** — Admin·Config alone hand-rolls the same `inputClass` string across all 6 routes; Admin·Catalog redefines it 3×; auth 6×.
5. **`AuthCard` duplicated 6/6 auth pages; `SumitCardForm` near-byte-identical across the 2 payment forms; the two shells are ~90% identical.**
6. **`SubmitButton` / `buttonVariants` bypassed** in many spots (landing CTAs, signup/success, team `RowSubmit`, join submit, staging-client's shadow `SubmitButton`).

### Top UX risks

| Risk | Where | Why it matters |
|---|---|---|
| **Destructive actions with no confirmation** | team remove-member & revoke-invitation (one-click), plus inconsistent `window.confirm` coverage (delete-guest/group confirm; revoke-RSVP-link, discard-import, reset-order don't) | Accidental irreversible data loss. No `Dialog`/`AlertDialog` primitive exists to standardize it. |
| **`/admin/sumit-test` breaks on mobile** | unconditional `grid-cols-2/3`, no `sm:` collapse | Only page flagged mobile-fit = NO. |
| **Row crowding on mobile** | `/admin/orders`, `/admin/packages`, `/app/orders`, `/app/events` list | `flex justify-between` with no wrap/truncate → overflow or ugly wrap on ~360px. |
| **Public RSVP touch targets** | `/r/[token]` stepper buttons 36px (<44px) | The most mobile-heavy, guest-facing page in the product. |
| **Landing has no mobile nav** | `#features/#how/#trust` are `hidden md:flex`, no hamburger | Nav links unreachable on phones. |
| **Empty/loading/error inconsistency** | dashed-box vs plain-text empties; some areas have no `loading.tsx`/`error.tsx` | Uneven perceived quality. |

---

## Recommended redesign scope, by area

| Area | Scope | Rationale |
|---|---|---|
| Customer · Guests | **Medium** | Highest complexity (filters, stat tiles, canonical card/table, imports) — mostly consolidation, not rework. |
| Customer · Campaign & Orders | **Medium** | Billing forms + banners; extract `SumitCardForm`, unify banners on tokens. |
| Admin (all) | **Light–Medium** | Structurally sound; extract `AdminList`/`AdminFilterBar`/`StatTile`, route pills through `Badge`, fix `sumit-test` + `orders` mobile. |
| Auth | **Light** | Extract `AuthCard`, reuse `PasswordField`, standardize card. |
| Public | **Light–Medium** | Extract `Alert`; add landing mobile nav; RSVP touch targets; button reuse. |
| Customer · Core | **Light** | Adopt `Card`, fix events-list truncation, extract `EventListItem`/`CelebrantFields`. |

---

## Priority order for the redesign program

1. **P0 — `ui/badge.tsx`**: promote from admin, migrate the 4 cross-boundary imports, delete the `team-client` twin. Fixes the layering violation and the biggest visual-consistency gap in one move.
2. **P1 — missing primitives**: `Alert`, `Textarea`, `Label`, `Checkbox`, `EmptyState`, `Pagination`, `PageHeader`, `Avatar`. Mechanical, high coverage.
3. **P1 — `AlertDialog` + a destructive-confirm sweep** (safety).
4. **P1 — mobile fixes**: `sumit-test`, `orders`/`packages` row wrap, events-list truncation, RSVP touch targets, landing mobile nav.
5. **P2 — composed extractions**: `AuthCard`, `SumitCardForm`, `AdminList`, `AdminFilterBar`, `StatTile`, `CopyButton`, `CelebrantFields`; adopt `Card` app-wide.
6. **P2 — `BaseShell`** to collapse the AppShell/AdminShell duplication.
7. **P3 — `Table` + responsive-list** convergence (guest-list pattern as the template).

---

## Verification (claims checked against the source, not assumed)

**Confirmed true:**
- 45 `page.tsx` routes; 16 `ui/*` primitives. ✔
- Cross-boundary import of `Badge`/`BadgeVariant`/`Pagination`/`formatDateTime` from `(admin)/admin/_components` by 4 `(customer)` files. ✔
- Second local `Badge` at `team-client.tsx:24`. ✔
- `ui/card` exists but imported in **0** files under `src/app`. ✔
- `ui/{alert,textarea,label,table,dialog,badge}` **absent**. ✔
- Every documented route maps to a real file (inventory built from the actual file tree). ✔
- Every area agent reported **all assigned files existed** (no fabricated paths). ✔

**Open — flagged `Needs verification` (not asserted as fact):**
- SUMIT card-field `dir` rendering under RTL (`payment`/`hold`/`pay`).
- Whether customer guest-list pagination reuses admin `Pagination` or hand-rolls its own.
- Whether WhatsApp channel secrets (`whatsapp_access_token`/`app_secret`) are ever sent to the client in plaintext (raised by the catalog agent — a **security** item for a dedicated review, out of design scope).
- Exact org-role enum for the team-page role chips.
- Mobile row-crowding at exactly 360px on `/admin/orders`, `/app/orders` (couldn't shrink the live viewport).

---

_Six deliverables in `docs/design/`: `page-inventory.md` · `page-design-briefs.md` · `ui-component-inventory.md` · `reusable-components-plan.md` · `responsive-rtl-audit.md` · `design-audit-summary.md`._
