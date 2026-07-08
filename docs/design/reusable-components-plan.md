# KALFA — Reusable Components Plan

> How to converge the UI onto a single component system: what already exists (never recreate),
> what to promote/create, which variants are missing, and which patterns must become global.
> Source: design-audit team fragments + `components.md` (2026-07-08). Companion: `ui-component-inventory.md`.

## Guiding principle

**Reuse-first.** KALFA already has a solid primitive layer — **16 `ui/*` primitives + 8 composed components**. Nearly every "new" need is already covered; the real problems are (a) a handful of genuinely missing primitives, (b) shared components that live in the wrong place (an admin route-group file acting as the app's Badge kit), and (c) a lot of hand-rolled duplication that should collapse onto existing components. **Do not create a new button / card / input / badge per page.**

---

## 1. Already exists — reuse, DO NOT recreate

### Primitives (`src/components/ui/*`)
| Component | Use it for | Audit note |
|---|---|---|
| `Button` + `buttonVariants` | Every action. 6 roles covered: `default`(primary)/`secondary`/`outline`/`ghost`/`destructive`/`link` × sizes incl. `icon*` | **Hand-rolled anyway** in: landing CTAs, `signup/success` CTA, `admin-access` link-button, team `RowSubmit`, `/join/[token]` submit. Replace with `Button`/`buttonVariants`. |
| `Card` (+ Header/Title/Description/Action/Content/Footer) | Every section container | **EXISTS BUT UNUSED** — every "card" in the app is a hand-rolled `<div className="rounded-lg border …">`. Adopt `Card`. |
| `Input` | Text/search fields | `inputClass` literal string re-declared identically ≥3× (package-form, templates-client, channels-client) + event forms. Route through `Input`. |
| `Select` | Styled dropdowns (portal; needs `DirectionProvider`) | Native `<select>` used for inline row controls (callbacks status, contact-status cell) — defensible when lightweight, but standardize. |
| `Sheet` | **The only modal/drawer primitive** (edge-anchored) | Used well by webhooks inspector + agreement. Use for all drawers; there is no centered modal. |
| `DropdownMenu` | Menus, account menus, per-row actions | Used by both shells + OrgSwitcher. |
| `Switch` / `Tabs` / `Tooltip` / `Accordion` / `Collapsible` / `Separator` / `ScrollArea` / `Skeleton` / `Chart` | As named | Solid; low duplication. |
| `Sidebar` (18 exports) | App-shell navigation scaffold | Consumed by both shells. |

### Composed (`src/components/*`)
| Component | Use it for |
|---|---|
| `SubmitButton`, `FieldError`, `FormError`, `FormNotice` (`forms.tsx`) | **The form kit.** Pending-aware submit + field/form errors + success notice. Re-implemented locally in `guests/import/whatsapp/staging-client.tsx` (shadowing `SubmitButton`) and skipped by `/join/[token]` — fix both. |
| `DateSelectIL` / `TimeSelect24` | IL dd/mm/yyyy + 24h inputs (locale-proof). Reuse for every date/time field. |
| `PasswordInput` / `PasswordField` (signup) | Password entry (+ strength meter). `reset-password` re-implements a plain password field — reuse instead. |
| `OrgSwitcher` | Active-org switch in the top bar. |
| `AdminShell` / `AppShell` | Area shells (see §5 — unify). |

---

## 2. Promote to `src/components/ui/` (already exists locally — move it)

The admin route group's `src/app/(admin)/admin/_components.tsx` is **the de-facto shared UI kit for the whole app**, and `(customer)` code already imports from it — a layering violation. Promote these:

| Promote | From | Why | Priority |
|---|---|---|---|
| **`Badge`** (+ `BadgeVariant`, tones `neutral/success/warning/info/destructive`) | `admin/_components.tsx` | Imported cross-boundary by `(customer)` guests/labels, guests/page, campaign-section; **plus a second, variant-less `Badge`** hand-rolled in `team-client.tsx`. Single most-used-yet-unshared component. | **P0** |
| **`EmptyState`** | `admin/_components.tsx` | Empty states are inconsistent app-wide (dashed-box vs plain text); one primitive fixes it. | P1 |
| **`Pagination`** | `admin/_components.tsx` | Pure `<Link>` `?page=` pager (works without JS); customer guest list likely hand-rolls its own (Needs verification). | P1 |
| **`PageHeader`** (from `PageHeading`) | `admin/_components.tsx` | Currently `<h1>`-only; extend with description + actions slots (most pages have title + subtitle + a primary action). | P1 |

> **Rule:** after promotion, nothing under `(customer)` or `(public)` may import from `(admin)`.

---

## 3. Create — genuinely missing primitives

| Create | Evidence | Notes |
|---|---|---|
| **`Alert` / `Banner`** (tones) | 6+ hand-rolled alert banners across `/join/[token]`, `/r/[token]` (red/amber/green), + literal-color banners (`bg-green-50` …) in campaign `payment`/`orders` pages. `forms.tsx` only covers inline error/notice `<p>`s. | Highest-value NEW primitive. Migrate all banners. |
| **`AlertDialog` / `ConfirmDialog`** | Destructive actions gated inconsistently: `window.confirm` on delete-guest/delete-group, but **none** on remove-member, revoke-invitation, revoke-RSVP-link, discard-staged-import, reset-order-to-failed. | Compose a centered confirm (or `Sheet`) and standardize every destructive action through it. |
| **`Table`** (Table/Header/Row/Cell) | 2 raw `<table>`s (guests desktop, whatsapp import) each hand-writing `<thead>/<tbody>` classes. | Pair with the responsive card/table pattern (§5). |
| **`Textarea`** | 6 files use raw `<textarea>` + ad-hoc classes. | Thin styled wrapper. |
| **`Label`** | Raw `<label>` throughout, each hand-styled or `sr-only`. | Thin styled wrapper. |
| **`Checkbox`** | 9 files use native `<input type="checkbox">`, no styled wrapper. | Thin styled wrapper. |
| **`Avatar`** | Identical initials-circle (`grid size-7 place-items-center rounded-full bg-primary …`) duplicated in `admin-shell` + `app-shell`. | 1-line `Avatar({ initial })`. |

---

## 4. Extract — app-specific composed components (repeated inline)

| Extract as | Duplicated across | Source finding |
|---|---|---|
| **`AuthCard`** | all 6 `auth/*` pages hand-roll the same `max-w-md` centered card wrapper | auth |
| **`SumitCardForm`** | `campaign/.../payment/hold-form.tsx` ≈ byte-identical to `orders/[id]/pay/payment-form.tsx` | campaign-orders |
| **`CelebrantFields`** | `new-event-form.tsx` ≈ `edit-event-form.tsx` (+ shared `inputClass`) | customer-core |
| **`AdminList` / `AdminListItem`** | `divide-y … rounded-lg border` row-list identical in callbacks / contacts / orders | admin-ops |
| **`ActivityRow` / `ActivityFeed`** | `/admin` recent-activity ≈ `/admin/activity` rows (already drifting) | admin-ops |
| **`AdminFilterBar`** | `activity` `ActivityFilters` ≈ `webhooks` `WebhookFilters` | admin-ops |
| **`StatTile`** | `/admin` tiles + `webhooks` `HealthStat` + `/app` + `/admin` dashboards (3 visual variants of one metric card) | admin-ops, customer-core |
| **`CopyButton`** | `webhooks` `CopyButton` — code comment says it mirrors `channels` `CopyRow` | admin-ops, admin-catalog |
| **`SecretField`** | `channels-client.tsx` (self-contained, strong candidate) | admin-catalog |
| **`HelpTip`** (relocate) | lives under `admin/agreement/help-tip.tsx` but cross-imported by templates + channels — move to `src/components/` | admin-catalog |
| **event summary row** | `/app` ≈ `/app/events` (drifted: dashboard has `min-w-0 truncate`, list doesn't → real mobile overflow) | customer-core |

---

## 5. Missing / needed variants

- **Button** — all 6 roles present; **no missing role.** Soft gap: no `loading` prop (spinner). `SubmitButton` shows a text-only `"רגע…"`. If a spinner is wanted, add `loading?: boolean` to `ui/button.tsx`, not another one-off.
- **Badge** — after promotion, add real tones for `team-client` role/active/pending chips (currently flattened to `neutral`) and add a **callback-status** tone map (none exists — `admin/callbacks` renders `neutral` always).
- **`campaign-section.tsx` `STATUS_VARIANTS`** is a loose non-exhaustive `Record<string, …>` — make it an exhaustive `Record<campaign_status, tone>` to get compile-time coverage like every other domain.

---

## 6. Patterns that must become global

1. **Shell unification** — `AppShell` and `AdminShell` are ~90 % identical (RTL `side="right"` sidebar, `DirectionProvider`, offcanvas mobile drawer, sticky top bar, account `DropdownMenu`, `max-w-5xl` container). Extract a shared `BaseShell` taking `nav` + header-extras; the two differ only in nav items and (App) search/OrgSwitcher.
2. **`Card` everywhere** — replace hand-rolled section `<div>`s with the existing `Card`.
3. **`Badge` everywhere** — one `ui/badge`, with the existing per-domain `Record<Enum,label>` + `Record<Enum,tone>` maps (keep the exhaustive-Record pattern — it gives compile-time safety).
4. **Destructive-confirm** — every destructive action routes through the shared confirm dialog (§3). No more single-click deletes and no ad-hoc `window.confirm`.
5. **Responsive record list** — the guests **cards `<lg` / table `≥lg`** pattern is the canonical one; apply it to every record list (whatsapp-import preview, admin lists, team members) instead of raw tables with no mobile fallback.
6. **Alert/banner** — one `ui/alert` for all inline status banners (replaces literal-color `bg-*-50` banners and the 6 hand-rolled RSVP/join banners).
7. **Layering boundary** — `(customer)` / `(public)` must never import from `(admin)`; enforce after the Badge/EmptyState/Pagination promotions.

---

## Sequenced rollout (suggested)

1. **P0 — `ui/badge.tsx`**: promote from admin, migrate the 3 cross-boundary imports + delete `team-client` local Badge. Unblocks the layering fix and the largest visual-consistency win.
2. **P1 — form/primitive gaps**: `Alert`, `Textarea`, `Label`, `Checkbox`, `EmptyState`, `Pagination`, `PageHeader`, `Avatar`. Mechanical, high-coverage.
3. **P1 — `AlertDialog` + destructive-confirm sweep**: safety-relevant (accidental member/RSVP deletion).
4. **P2 — composed extractions**: `AuthCard`, `SumitCardForm`, `AdminList`, `AdminFilterBar`, `StatTile`, `CopyButton`, `CelebrantFields`.
5. **P2 — `BaseShell` unification** + adopt `Card` app-wide.
6. **P3 — `Table` + responsive-list** convergence.

_This plan is design/structure only — no color values (per audit scope). Component APIs above specify semantic tones/states, not palette._
