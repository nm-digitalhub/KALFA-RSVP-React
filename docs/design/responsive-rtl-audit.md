# KALFA — Responsive & RTL Audit

> Mobile / tablet / desktop behaviour, sidebar↔drawer, table↔cards, account menu, and RTL hygiene.
> Basis: code review of all 45 pages (the findings below are derived from the source, per the audit brief),
> cross-checked against live desktop screenshots on `beta.kalfa.me`. Produced 2026-07-08.

**Scope note:** colors are out of scope. This doc is about layout, breakpoints, overflow, and direction.

**Live-capture caveat:** the browser bridge on this machine (macOS, scaled display) could not shrink the
viewport below ~1440px — `resize_window` returned desktop-width screenshots regardless of target size. So
**mobile findings are code-derived** (fixed widths, missing breakpoints, missing `flex-wrap`, table fallbacks),
which is exactly the brief's stated basis ("בעיות רספונסיביות ... שנראות מהקוד"). Desktop rendering was verified live.

---

## 1. Global structural patterns (working well)

### Desktop sidebar ↔ mobile drawer
Both shells (`AppShell`, `AdminShell`) use the same `ui/sidebar` primitive with `side="right"` (RTL inline-start)
and `collapsible="offcanvas"`:
- **≥ md:** a fixed right-hand sidebar is always visible.
- **< md:** the sidebar collapses; a hamburger (`MobileMenuTrigger`, `md:hidden`, 44px target) opens it as an
  offcanvas **Sheet** drawer. This is the one canonical nav pattern and it is applied consistently.
- Both shells wrap the tree in `<DirectionProvider direction="rtl">` so the portaled Base UI drawer/menus open
  from the correct edge — the project's established fix for Base UI defaulting to LTR.

### Account / user menu
Top-bar `DropdownMenu` (`align="end"`), triggered by an avatar-initial circle. The email label is `hidden sm:inline`
(icon-only on mobile), and the menu content (`w-56`) holds email + (customer) settings + logout. Mobile and desktop
share the same menu — no separate mobile account UI needed. (Minor: the avatar-initial circle is duplicated inline in
both shells — see `reusable-components-plan.md` §3 `Avatar`.)

### Content container
Both shells cap content at `mx-auto max-w-5xl px-4 py-8 sm:px-6`, so no page is responsible for its own max-width
inside the app — **except** a few pages that add their own cap or forget to (see §4).

---

## 2. Desktop table ↔ mobile cards

| Surface | Pattern | Verdict |
|---|---|---|
| **Guest list** (`/app/.../guests`) | **Canonical**: `GuestCard` stack `< lg` → 8-col `<table>` `≥ lg`, table guarded by `overflow-x-auto` + `min-w-[44rem]`. | ✅ The reference implementation for every record list. |
| **WhatsApp import preview** (`/app/.../guests/import/whatsapp`) | 4-col `<table>` in `overflow-x-auto`, **no mobile-card fallback**. | ⚠️ Inconsistent with the guest-list precedent — horizontal scroll on ~360px. |
| **Admin operational lists** (callbacks/contacts/orders/webhooks) | `<ul>/<li>` card rows (not `<table>`). | ✅ No wide-table risk; but see per-row crowding in §4. |
| **Team members / orders / packages** | `<ul>` / card rows. | ✅ list-shaped; no table/card split needed. |

**Recommendation:** promote the guest-list card↔table approach into the planned shared `Table` + responsive-list
pattern, and apply it to the WhatsApp import preview.

---

## 3. RTL hygiene — strong overall

The codebase is **remarkably clean on RTL**: nearly every file uses logical properties (`ps/pe`, `ms/me`,
`start/end`, `text-start/end`, `border-s-*`) rather than physical `left/right`. `dir="ltr"` is correctly and
narrowly scoped to inherently-LTR content (phone, email, URLs, OTP, card fields, technical ids). Portaled Base UI
components are wrapped in `DirectionProvider`.

**Real RTL defects found (small, isolated):**
| File | Issue | Fix |
|---|---|---|
| `guests/[guestId]/page.tsx` | `text-left` on the `provider_id` paragraph | → `text-start` |
| `guests/import/whatsapp/page.tsx` | `text-right` on a table header `<tr>` | → `text-start` |
| `admin/agreement/*` | one popover hardcodes `text-right` (harmless — same node also hardcodes `dir="rtl"`) | → `text-start` for consistency |
| `(public)/_legal.tsx` | back-link uses a literal `←` glyph instead of a logical icon (affects `/privacy`, `/terms`) | → use the same lucide arrow the landing page uses |

**Deliberate exceptions (do NOT "fix"):** the phone-column `dir="ltr"` + symmetric padding in the WhatsApp import
table is commented as intentional; date/time controls (`DateSelectIL`/`TimeSelect24`) force internal LTR by design.

---

## 4. Concrete mobile risks (code-derived, ranked)

| # | Page | Risk | Severity |
|---|---|---|---|
| 1 | `/admin/sumit-test` | `grid-cols-2` / `grid-cols-3` are **unconditional** (no `sm:` collapse) → real squeeze at ~360px. The only page flagged **mobile-fit = NO**. | High |
| 2 | `/app/.../guests/import/whatsapp` | 4-col preview table, no card fallback → horizontal scroll on mobile. | Med |
| 3 | `/admin/orders`, `/admin/packages` | list rows are `flex justify-between` with no `flex-wrap`/`flex-col` fallback → crowding with name + 2–3 badges + buttons + price on one line (contrast the safe `/admin/callbacks` which stacks `flex-col → sm:flex-row`). | Med |
| 4 | `/app/orders` | `OrderCard` two-column `flex justify-between` with no `min-w-0`/wrap on the amount vs. status+button columns. | Med |
| 5 | `/app/events` (list) | event-summary row lacks the `min-w-0 truncate` its dashboard twin has → long names wrap to multiple lines (drift bug). | Med |
| 6 | `/admin/activity` | 6-field filter jumps `1 col → lg:grid-cols-6` with no intermediate breakpoint → one long scroll on mobile (webhooks' `1 → sm:2 → lg:5` is the better pattern). | Low-Med |
| 7 | `/r/[token]` (public RSVP) | headcount `Stepper` +/− buttons are `h-9 w-9` (36px) — below the 44px touch-target guideline, on the **most mobile-heavy page in the product**. | Med (UX) |
| 8 | `/` (landing) | in-page nav (`#features`/`#how`/`#trust`) is `hidden md:flex` with **no hamburger** → those links are unreachable on mobile. | Low-Med |
| 9 | `/admin/templates` | `<code>{message_key}</code>` has no `truncate`/`overflow-x-auto` → long keys can overflow. | Low |
| 10 | `/admin/settings`, `/app/orders/[id]/pay` | no self `max-w` cap → over-long line length on desktop (readability, not mobile). | Low |

**Needs verification in-browser (couldn't shrink viewport live):** the SUMIT card fields' `dir` rendering
(`payment`/`hold`/`pay` pages), and rows #3–#4 at exactly 360px.

---

## 5. Live desktop observations (verified on beta.kalfa.me)

Captured at ~1440–1512px, logged in as an admin account (reaches both `/app` and `/admin`):
- **Both shells render identically** in structure — right-hand sidebar, sticky top bar, account menu — visually
  confirming the ~90% `AppShell`/`AdminShell` duplication noted in the component audit.
- **Guest list** renders the full 8-col table + filter bar + 4 stat tiles cleanly at desktop; the page carries many
  status chips in several **structurally** different chip treatments (event vs campaign vs RSVP vs messaging) —
  the driver for a single shared `Badge` (colors out of scope; the point is the *structural* inconsistency).
- **Event detail** is a genuinely Heavy page: stacked status/close section + RSVP-campaign card + full edit form.
- **Landing** renders a hero with a mock RSVP-dashboard card + marketing nav + CTA buttons (the CTAs hand-roll
  button styling rather than using `ui/button`).
- Desktop layouts are comfortable within `max-w-5xl`; no desktop overflow observed on the captured pages.

---

## 6. Per-area findings (from the code audit)


## Public + Root

### `/`: mobile-fit = partial; wide areas: none overflow-risk (all grids collapse to 1 col via `sm:`/`lg:` breakpoints, `max-w-6xl` container with `px-6` padding); RTL risks: none found (no physical-direction classes; `ArrowLeft` icon correctly used as the RTL "forward" chevron). Mobile gap: in-page nav (`#features`/`#how`/`#trust`) is `hidden md:flex` with **no hamburger/mobile-menu fallback** — those three nav links are simply inaccessible below `md`, not an overflow bug but a real navigation gap.

### `/privacy`: mobile-fit = yes; wide areas: none (single-column prose, `max-w-3xl`, no tables/fixed widths); RTL risks: minor — literal `←` glyph in the back-link text (in shared `_legal.tsx`) instead of a logical icon component; visually correct but inconsistent with the icon-based arrows used elsewhere (landing page).

### `/terms`: mobile-fit = yes; wide areas: none; RTL risks: same shared `←` glyph issue as `/privacy` (one shared source, `_legal.tsx`).

### `/join/[token]`: mobile-fit = yes; wide areas: none (`max-w-md`, single column, no tables); RTL risks: none found.

### `/r/[token]`: mobile-fit = yes overall (`max-w-md`, explicit mobile-first `min-h-svh` centering); wide areas: none — no fixed pixel widths, no tables, `next/image` invite hero scales via `w-full h-auto`; RTL risks: none found (no physical-direction classes, external links correctly use `rel="noreferrer"/"noopener noreferrer"`). Note: not an RTL issue but a touch-target concern — the `Stepper` +/− buttons are `h-9 w-9` (36px), under the 44px minimum commonly recommended for mobile tap targets, on the single most mobile-heavy page in the product.


## Auth

### /auth/login: mobile-fit = yes; wide areas: none (max-w-md, no fixed px widths); RTL risks: email `<input>` lacks `dir="ltr"` (signup's equivalent field sets it — inconsistency, not a bug); "forgot password" link correctly uses `text-end` (logical, not `text-right`).

### /auth/signup: mobile-fit = yes; wide areas: none; RTL risks: none found — email/phone correctly forced `dir="ltr"`, full_name left RTL-default; no physical-direction classes.

### /auth/signup/success: mobile-fit = yes; wide areas: none; RTL risks: none found; icon uses `aria-hidden` correctly, no directional classes.

### /auth/forgot-password: mobile-fit = yes; wide areas: none; RTL risks: email `<input>` lacks `dir="ltr"` (same as login).

### /auth/reset-password: mobile-fit = yes; wide areas: none; RTL risks: none found (both fields are opaque password values, `dir` is moot); server-conditional branches don't introduce layout width issues.

### /auth/confirm: mobile-fit = yes; wide areas: none; RTL risks: none found — minimal content, no directional classes.

**Area-wide:** No physical-direction Tailwind classes (`left/right`, `ml-/mr-/pl-/pr-`, `text-left/right`) found anywhere in the 6 pages or their co-located components — this area is clean on that axis. No fixed pixel widths beyond the intentional `max-w-md` cap (≈448px, well above a 360px viewport since the container also has `px-6` and is itself constrained by the viewport, not a hard min-width). No tables in this area. No horizontal-scroll risk anywhere.


## Customer · Core (Dashboard & Events)

### /app: mobile-fit = yes; wide areas: none found; RTL risks: none found — all logical spacing/alignment classes
### /app/events: mobile-fit = partial (list row has `min-w-0 flex-1` so it can't force horizontal overflow, but lacks the `truncate` present in the dashboard's identical pattern — long names wrap to multiple lines instead of clipping); wide areas: none found; RTL risks: none found
### /app/events/new: mobile-fit = yes (form capped `max-w-lg`; `DateSelectIL`/`TimeSelect24` stay `w-fit`, not verified live at 360px); wide areas: none found; RTL risks: none — the two ltr-forced date/time controls are an intentional, documented exception
### /app/events/[id]: mobile-fit = yes (flex-wrap header/actions; invite-image preview capped `max-w-[20rem]`); wide areas: none found; RTL risks: none — `gift_payment_url` intentionally `dir="ltr"`, date/time controls ltr-internal as above


## Customer · Guests

### /app/events/[id]/guests: mobile-fit = yes; wide areas: 8-col table guarded by `overflow-x-auto`+`min-w-[44rem]`, only reached `≥lg`; RTL risks: none found (phone cells correctly `dir="ltr"`)

### /app/events/[id]/guests/new: mobile-fit = yes; wide areas: none (`max-w-2xl` form); RTL risks: none found

### /app/events/[id]/guests/[guestId]: mobile-fit = yes; wide areas: none (`max-w-2xl` detail page); RTL risks: `text-left` physical class on `provider_id` paragraph — should be `text-start`

### /app/events/[id]/guests/import: mobile-fit = yes; wide areas: none; RTL risks: none found

### /app/events/[id]/guests/import/whatsapp: mobile-fit = partial (preview table has no mobile-card fallback, unlike the main list); wide areas: 4-col preview `<table>` wrapped in `overflow-x-auto`, risks scroll on ~360px with long names; RTL risks: `text-right` physical class on header `<tr>` (oversight) vs. the deliberately-commented `text-end`/symmetric-`px` exception on the `dir="ltr"` phone column (intentional, not a bug)


## Customer · Campaign & Orders

### /app/events/[id]/campaign/[campaignId]: mobile-fit = yes; wide areas: 4-col stat grid collapses to 1/2/4 cols responsively, no fixed widths; RTL risks: none found — `inlineSize` used correctly for the delivery bar fill, all spacing logical.

### /app/events/[id]/campaign/[campaignId]/approve: mobile-fit = yes; wide areas: `dl` terms grid `grid-cols-1 sm:grid-cols-2`, signature canvas `h-40 w-full` (no fixed px width) but cramped UX on small touch screens (UX note, not overflow); RTL risks: none found — OTP/phone fields correctly forced `dir="ltr"`, Sheet opens from the correct RTL reading-start edge (`side="right"`, DirectionProvider confirmed at AppShell level covering portaled content).

### /app/events/[id]/campaign/[campaignId]/payment: mobile-fit = yes; wide areas: month/year fields sit `flex gap-4` two-up, tight but not overflowing at ≤340px, no fixed px widths found; RTL risks: card fields have no explicit `dir` — `Needs verification` how SUMIT's injected library markup (`.og-errors`) and the numeric fields render in RTL.

### /app/orders: mobile-fit = partial; wide areas: `OrderCard`'s `flex items-start justify-between` two-column layout has no `min-w-0`/wrap fallback documented for the amount block vs. status+button column — `Needs verification` visually at ≤360px; RTL risks: none found, all classes logical.

### /app/orders/[id]/pay: mobile-fit = yes; wide areas: page does not self-constrain width (relies on AppShell's `max-w-5xl`, unlike its `max-w-2xl`-capped sibling `payment/page.tsx`) — a desktop layout-consistency issue more than a mobile one; RTL risks: same as the campaign hold form — card fields have no explicit `dir`, `Needs verification`.


## Customer · Account (Settings/Team/Access)

### /app/settings: mobile-fit = yes; wide areas: none found (grid collapses to 1 col below `lg`, all inputs `w-full`, section max-widths on submit buttons only e.g. `max-w-44`/`max-w-48`); RTL risks: none — LTR fields (`phone`, `new_email`) correctly opt out with `dir="ltr"` + `text-start`, no physical-direction utility classes present.

### /app/team: mobile-fit = yes; wide areas: none found (rows are `flex flex-wrap`, invite form grid collapses below `sm`); RTL risks: none — `email` field correctly `dir="ltr"`, no physical-direction utility classes present. Note: this page's lists are already list/card-shaped, not a `<table>`, so there's no "desktop table / mobile card" split to check.

### /app/admin-access: mobile-fit = yes; wide areas: none (`max-w-md` cap); RTL risks: none — plain Hebrew, no physical-direction classes.


## Admin · Operations & Monitoring

### /admin: mobile-fit = yes; wide areas: none; RTL risks: none found (no physical-direction classes in file)
### /admin/activity: mobile-fit = partial; wide areas: 6-field filter form collapses to one long column with no intermediate breakpoint (`lg:grid-cols-6` only); RTL risks: none found; `dir="ltr"` correctly scoped to technical fragments
### /admin/callbacks: mobile-fit = yes; wide areas: none; row already stacks `flex-col → sm:flex-row`; RTL risks: none found
### /admin/contacts: mobile-fit = yes; wide areas: none; RTL risks: none found
### /admin/orders: mobile-fit = partial (Needs verification in-browser); wide areas: row is `flex items-center justify-between` without a `flex-col` mobile fallback (unlike callbacks), risking crowding with 3 badges + up to 2 buttons + price on one line; RTL risks: none found
### /admin/webhooks: mobile-fit = yes; wide areas: none (filter grid steps `1 → sm:2 → lg:5`, better than activity's); `Sheet` drawer correctly full-width on mobile (`w-full sm:max-w-md`); RTL risks: none found; `border-s-*` logical classes used correctly for the status stripe; `Sheet side="right"` is physical but wrapped by `DirectionProvider direction="rtl"` per the established project pattern — not a risk


## Admin · Catalog (Packages/Templates/Channels)

### /admin/packages: mobile-fit = partial; wide areas: list-row `flex items-center justify-between gap-4` has no `flex-wrap`, risking overflow on a long name + 2 badges + price at ~360px; RTL risks: none found (logical spacing throughout).

### /admin/packages/new: mobile-fit = yes; wide areas: none found — `TouchpointRow`'s `sm:grid-cols-[6rem_10rem_1fr_auto]` and the base-field `sm:grid-cols-2` grids both collapse to one column below `sm`; RTL risks: none — `dir="ltr"` is deliberately scoped to numeric/id fields only, no physical left/right classes.

### /admin/packages/[id]: mobile-fit = yes (inherits `PackageForm`); wide areas: none beyond `/new`; RTL risks: none beyond `/new`.

### /admin/templates: mobile-fit = partial; wide areas: `<code>{template.message_key}</code>` has no `truncate`/`overflow-x-auto` wrapper — could overflow on a narrow screen with a long key; RTL risks: none found.

### /admin/channels: mobile-fit = yes; wide areas: none found — `SecretField`/`CopyRow` explicitly handle overflow (`truncate`, `min-w-0 flex-1`) and use logical positioning (`end-0`, `pe-10`); RTL risks: none found.


## Admin · Config & Users

### /admin/agreement: mobile-fit = yes; wide areas: none (config grid correctly `sm:grid-cols-2`); RTL risks: none found — version/HTML/numeric fields intentionally `dir="ltr"`, one popover uses hardcoded `text-right` instead of `text-start` (harmless since that element also hardcodes `dir="rtl"`, but inconsistent with logical-property convention).

### /admin/company: mobile-fit = yes; wide areas: none; RTL risks: tel/email/url fields have no `dir` override — Needs verification whether that reads awkwardly (unlike version/numeric fields elsewhere in the area, which do force `dir="ltr"`).

### /admin/settings: mobile-fit = yes (all fields single-column, no grid); wide areas: single-column form runs the full shell width with no `max-w` cap, longer line-length than other pages in the area on large screens (readability, not overflow); RTL risks: no field forces `dir` despite host/port/from being inherently LTR-shaped, inconsistent with the rest of the area.

### /admin/sumit-test: mobile-fit = **no** — Form A's parameter grid (`grid-cols-2 gap-4`, unconditional) and Form B's exp/citizen-id row (`grid-cols-3 gap-4`, unconditional) do not collapse to 1 column under `sm:`, unlike every other multi-column grid in this area; concrete squeeze risk at ~360px. wide areas: both forms capped `max-w-xl`, no overflow-x wrapper present (none needed — no wide tables). RTL risks: none — card/date/citizenid fields correctly forced `dir="ltr"`.

### /admin/users: mobile-fit = yes; wide areas: none; RTL risks: none — email correctly forced `dir="ltr"` in row and search input.

### /admin/users/[id]: mobile-fit = yes (`dl` and form grids correctly gated behind `sm:`); wide areas: none; RTL risks: none found — email/phone correctly `dir="ltr"`; currency values unverified visually but backed by `Intl.NumberFormat('he-IL', ...)`.
