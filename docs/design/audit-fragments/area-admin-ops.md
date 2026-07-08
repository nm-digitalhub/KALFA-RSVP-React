# Area: Admin — Operations & Monitoring

_Files read: 6 pages (+ 3 shell/support files: layout.tsx, loading.tsx, error.tsx), 8 co-located components (`_components.tsx`, `callback-status-form.tsx`, `callbacks/actions.ts`, `reconcile-button.tsx`, `webhook-detail.tsx`, `webhook-inspector-client.tsx`, `webhooks/actions.ts`, plus `admin-shell.tsx` and `src/lib/data/admin/labels.ts` read for status-value ground truth)._

## 1. Inventory Rows

| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/admin` (layout) | `src/app/(admin)/admin/layout.tsx` | Server | AdminShell | Auth/role gate (`requireAdmin()`) + shell wrapper for whole `/admin/*` subtree |
| `/admin` (loading) | `src/app/(admin)/admin/loading.tsx` | Server | — | Suspense fallback skeleton for the whole admin area |
| `/admin` (error) | `src/app/(admin)/admin/error.tsx` | Client | — | Error boundary for the whole admin area; generic message + retry, version-skew auto-reload |
| `/admin` | `src/app/(admin)/admin/page.tsx` | Server | AdminShell | Dashboard: 4 count tiles + recent activity feed |
| `/admin/activity` | `src/app/(admin)/admin/activity/page.tsx` | Server | AdminShell | Audit log: filterable, paginated activity feed |
| `/admin/callbacks` | `src/app/(admin)/admin/callbacks/page.tsx` | Server | AdminShell | Call-me-back requests list + inline status editor |
| `/admin/contacts` | `src/app/(admin)/admin/contacts/page.tsx` | Server | AdminShell | Contact-form submissions, read-only list |
| `/admin/orders` | `src/app/(admin)/admin/orders/page.tsx` | Server | AdminShell | All orders (read-only) + reconciliation actions |
| `/admin/webhooks` | `src/app/(admin)/admin/webhooks/page.tsx` | Server | AdminShell | WhatsApp webhook inbox inspector: health stats, filters, detail drawer, reprocess |

## 2. Design Briefs

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

## 3. UI Elements Per Page

### /admin
- buttons: none (tiles are `Link`s, not buttons)
- inputs / selects / search / filters: none
- cards / tables / lists: 4 stat tiles (`inline/local`, `Link`-wrapped divs); recent-activity `<ul>`/`<li>` cards (`inline/local`)
- badges / status chips: `actionLabel` pill — hand-rolled span, NOT the shared `Badge` component (`rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground`, inline)
- dropdown menus / dialogs / sheets: none (page-level; `AdminShell` itself has a `DropdownMenu` for account/logout, out of this page's scope)
- empty / loading / error UI: `EmptyState` (`inline/local`) for no-activity; `admin/loading.tsx` + `admin/error.tsx` for the area
- destructive actions: none

### /admin/activity
- buttons: "סינון" (submit, inline styled — not `ui/button`), "ניקוי" (Link styled as button), "הצג הכל" (text Link) — all `inline/local`
- inputs / selects / search / filters: `q` search input (inline/local), `entity`/`action`/`actor` native `<select>`s (inline/local), `from`/`to` `DateSelectIL` (`shared`)
- cards / tables / lists: activity `<ul>`/`<li>` card list (`inline/local`)
- badges / status chips: `actionLabel` pill (hand-rolled, same as `/admin` — not `Badge`); active-instance filter chip (hand-rolled)
- dropdown menus / dialogs / sheets: `<details>`/`<summary>` for raw JSON (native, no component)
- empty / loading / error UI: `EmptyState` (`inline/local`); area-wide loading/error
- destructive actions: none

### /admin/callbacks
- buttons: "עדכון" submit (inline styled), disabled while `pending` (`inline/local`, inside `CallbackStatusForm`)
- inputs / selects / search / filters: `status` native `<select>` (`inline/local`, inside `CallbackStatusForm`) — no list-level filter/search on this page
- cards / tables / lists: `<ul>` row list (`inline/local`)
- badges / status chips: `Badge` (`inline/local`, from `_components.tsx`) — properly reused here
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `EmptyState`; per-row `FieldError`/`FormError`/`FormNotice` (`shared`, `@/components/forms`); area-wide loading/error
- destructive actions: none (status changes are reversible/non-destructive)

### /admin/contacts
- buttons: none
- inputs / selects / search / filters: none
- cards / tables / lists: `<ul>` row list (`inline/local`)
- badges / status chips: none (no status field on this entity)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `EmptyState`; area-wide loading/error
- destructive actions: none

### /admin/orders
- buttons: `ReconcileButton` ×2 variants ("בירור אוטומטי" / "אפס לנכשל") — `inline/local`, plain `<button>` + `fetch`, not `ui/button`
- inputs / selects / search / filters: none (no list-level filter on this page)
- cards / tables / lists: `<ul>` row list (`inline/local`)
- badges / status chips: `Badge` (`inline/local`) ×up to 3 per row (order status, "תקוע", "תוספת AI")
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `EmptyState`; `ReconcileButton`'s own inline `FormError` + notice text; area-wide loading/error
- destructive actions: "אפס לנכשל" (reset-to-failed) is a state-mutating recovery action but has no confirm dialog — mild risk (contrast with `/admin/webhooks`'s reprocess button, which does confirm)

### /admin/webhooks
- buttons: "סינון"/"ניקוי" (inline styled, filter form); `CopyButton` ×N (inline/local, per technical field); `PhoneReveal` toggle (inline/local); `PayloadViewer` reveal toggle (inline/local); `ReprocessButton`/`ReprocessSubmit` (inline/local, with native `confirm()` guard)
- inputs / selects / search / filters: `q` search input, `kind`/`state` native `<select>`s (all inline/local), `from`/`to` `DateSelectIL` (`shared`)
- cards / tables / lists: event `<ul>`/`<li>` card list (`inline/local`, each row a full-card `Link`)
- badges / status chips: `Badge` (`inline/local`) — kind, process-state, delivery-status, up to 3 per row
- dropdown menus / dialogs / sheets: `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle` (`ui`, `@/components/ui/sheet`) — the detail drawer, URL-driven open state
- empty / loading / error UI: `EmptyState` (two filter-aware variants); area-wide loading/error
- destructive actions: "עיבוד מחדש" (reprocess) — has a `window.confirm()` guard before submit; PII reveal actions (`PhoneReveal`, `PayloadViewer`) are not destructive but are gated behind an explicit click, consistent with the project's privacy rules

## 4. Responsive & RTL Findings

### /admin: mobile-fit = yes; wide areas: none; RTL risks: none found (no physical-direction classes in file)
### /admin/activity: mobile-fit = partial; wide areas: 6-field filter form collapses to one long column with no intermediate breakpoint (`lg:grid-cols-6` only); RTL risks: none found; `dir="ltr"` correctly scoped to technical fragments
### /admin/callbacks: mobile-fit = yes; wide areas: none; row already stacks `flex-col → sm:flex-row`; RTL risks: none found
### /admin/contacts: mobile-fit = yes; wide areas: none; RTL risks: none found
### /admin/orders: mobile-fit = partial (Needs verification in-browser); wide areas: row is `flex items-center justify-between` without a `flex-col` mobile fallback (unlike callbacks), risking crowding with 3 badges + up to 2 buttons + price on one line; RTL risks: none found
### /admin/webhooks: mobile-fit = yes; wide areas: none (filter grid steps `1 → sm:2 → lg:5`, better than activity's); `Sheet` drawer correctly full-width on mobile (`w-full sm:max-w-md`); RTL risks: none found; `border-s-*` logical classes used correctly for the status stripe; `Sheet side="right"` is physical but wrapped by `DirectionProvider direction="rtl"` per the established project pattern — not a risk

## 5. Duplications & Extract Candidates

- **Row-list wrapper** `<ul className="divide-y divide-border rounded-lg border border-border">` → seen identically in `/admin/callbacks`, `/admin/contacts`, `/admin/orders` → suggest extract as `AdminList` / `AdminListItem`.
- **Card-list wrapper** `<ul className="space-y-3">` + `<li className="rounded-lg border border-border bg-card p-4">` → seen in `/admin` (recent activity) and `/admin/activity` (same entity, near-duplicate row markup — chip + summary + actor/target chips + timestamp + optional details), and a variant (with a status-stripe border) in `/admin/webhooks` → suggest extract as `ActivityRow`/`ActivityFeed` (for the two activity call-sites) plus a more general `CardListItem` primitive the webhooks stripe-variant could compose.
- **Filter bar** (search input + 2–4 selects + 2 `DateSelectIL` + submit/clear pair, inside a `rounded-lg border border-border bg-card p-4` form) → seen in `/admin/activity` (`ActivityFilters`) and `/admin/webhooks` (`WebhookFilters`) → suggest extract as `AdminFilterBar` with a field-slot API; would also let the two pages converge on the same responsive step-down (webhooks' `sm:grid-cols-2 lg:grid-cols-5` is friendlier to mobile than activity's `lg:grid-cols-6`).
- **Stat tile** — `/admin`'s dashboard tiles (icon + label + big number, wrapped in a `Link`, `rounded-lg border border-border p-4 hover:bg-muted`) and `/admin/webhooks`'s `HealthStat` (label + value + optional warning/destructive tone, `rounded-lg border border-border bg-card px-4 py-2`) are the same concept (a small metric card) with two different implementations and two different visual treatments (different padding/background/hover) → suggest a single `StatTile` primitive with an optional `href` prop and an optional `tone` prop.
- **Copy-to-clipboard control** — `CopyButton` in `webhook-inspector-client.tsx` is explicitly commented as mirroring `channels-client`'s `CopyRow` (outside this task's scope, in `/admin/channels`) → confirmed self-acknowledged duplication in the source → suggest promoting to a single `@/components/copy-button.tsx`.
- **Row action with pending/error/notice** — `ReconcileButton` (`/admin/orders`, plain `useState` + `fetch` to a Route Handler) duplicates, with a different implementation strategy, the same "row action that shows pending/error/notice" shape that `CallbackStatusForm` (`/admin/callbacks`) gets for free via `useActionState` + a Server Action → not a literal code duplication, but a pattern inconsistency worth normalizing (Server Action would also drop the manual `router.refresh()` and hand-rolled `ReconcileResponse` typing).
- **Un-badged status pill** — `/admin`'s and `/admin/activity`'s `actionLabel` pill reimplements (byte-for-byte) the `neutral` variant of the area's own `Badge` component instead of using it → straightforward reuse fix, not really a new extraction.

## 6. Shared Components Referenced (from imports)

- from `@/components/ui`: `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle` (webhooks only, via `webhook-inspector-client.tsx`). No other `ui/*` primitives imported directly by any page in this area.
- from `@/components`: `date-select-il` → `DateSelectIL` (activity, webhooks filter forms); `forms` → `FieldError`, `FormError`, `FormNotice` (callbacks), `FormError` (orders' `ReconcileButton`); `admin-shell` → `AdminShell` (layout only, consumed not re-exported).
- inline/local components defined in this area:
  - `src/app/(admin)/admin/_components.tsx` → `formatCurrency`, `formatDateTime`, `PageHeading`, `EmptyState`, `Badge` (+ `BadgeVariant` type, also imported by `src/lib/data/admin/labels.ts` for its exhaustive status→variant maps), `Pagination`, `parsePageParam`, `firstParam` — the de facto shared UI kit for the entire admin area, not just operations pages.
  - `src/app/(admin)/admin/callbacks/callback-status-form.tsx` → `CallbackStatusForm` (client).
  - `src/app/(admin)/admin/callbacks/actions.ts` → `updateCallbackStatusAction` (Server Action).
  - `src/app/(admin)/admin/orders/reconcile-button.tsx` → `ReconcileButton` (client).
  - `src/app/(admin)/admin/webhooks/webhook-detail.tsx` → `WebhookDetail`, local `Field`/`Section` helpers (server).
  - `src/app/(admin)/admin/webhooks/webhook-inspector-client.tsx` → `InspectorDrawer`, `CopyButton`, `PhoneReveal`, `PayloadViewer`, `ReprocessButton`/`ReprocessSubmit` (all client).
  - `src/app/(admin)/admin/webhooks/actions.ts` → `reprocessWebhookEventAction` (Server Action).
