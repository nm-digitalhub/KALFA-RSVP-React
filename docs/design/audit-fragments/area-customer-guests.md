# Area: Customer — Guests

_Files read: 5 pages (`page.tsx` ×5) + 2 route-level files (`loading.tsx`, `not-found.tsx`), 8 co-located components (`contact-status-cell.tsx`, `groups-manager.tsx`, `guest-form.tsx`, `guest-list-controls.tsx`, `guest-row-actions.tsx`, `rsvp-link.tsx`, `import-form.tsx`, `staging-client.tsx`) + 1 supporting label module (`labels.ts`) read in full for enum/status accuracy. All 15 assigned files existed; none missing._

## 1. Inventory Rows

| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/app/events/[id]/guests` | `guests/page.tsx` | Server | AppShell | Guest list: filter/sort, stat tiles, groups, mobile cards / desktop table |
| `/app/events/[id]/guests` (loading) | `guests/loading.tsx` | Server | AppShell | Suspense skeleton for the list |
| `/app/events/[id]/guests` (not-found) | `guests/not-found.tsx` | Server | AppShell | Generic 404 for event/guest not owned or missing |
| `/app/events/[id]/guests/new` | `guests/new/page.tsx` | Server | AppShell | Create one guest |
| `/app/events/[id]/guests/[guestId]` | `guests/[guestId]/page.tsx` | Server | AppShell | Edit guest + RSVP link controls + WhatsApp history |
| `/app/events/[id]/guests/import` | `guests/import/page.tsx` | Server | AppShell | CSV import instructions + upload |
| `/app/events/[id]/guests/import/whatsapp` | `guests/import/whatsapp/page.tsx` | Server | AppShell | Review/confirm staged WhatsApp-sourced imports |

## 2. Design Briefs

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

## 3. UI Elements Per Page

### /app/events/[id]/guests
- buttons: "ייבוא מקובץ" (`buttonVariants({variant:'outline'})`, ui), "מוזמן חדש" (`buttonVariants()`, ui), per-row edit/delete via `GuestRowActions` (ui `Button`/`buttonVariants`, `ghost`/`destructive`, icon-only on mobile)
- inputs / selects / search / filters: full filter bar in `GuestListControls` (search text, status/contact/group/over/sort selects) — all raw `<input>`/`<select>`, inline/local; inline contact-status `<select>` in `ContactStatusCell` — inline/local
- cards / tables / lists: `GuestCard` list `<lg` (inline/local), 8-col `<table>` `≥lg` (inline/local), 4 stat tiles `<dl>` (inline/local)
- badges / status chips: `Badge` (from `(admin)/admin/_components`, cross-area) used for guest status, op_status, delivery_status, removal_requested, over_invited
- dropdown menus / dialogs / sheets: none on this page directly (delete uses `window.confirm`, not a Dialog/Sheet)
- empty / loading / error UI: `loading.tsx` skeleton, `not-found.tsx`, in-page empty-filter/no-guests state (inline)
- destructive actions: מחיקה per guest (client confirm + action), delete group inside `GroupsManager`

### /app/events/[id]/guests/new
- buttons: `SubmitButton` (shared, `@/components/forms`)
- inputs / selects / search / filters: raw `<input>`/`<select>`/`<textarea>` (inline/local, `inputClass` string) for all 7 fields
- cards / tables / lists: none
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: inherited `guests/loading.tsx`; `FormError` banner
- destructive actions: none

### /app/events/[id]/guests/[guestId]
- buttons: raw `<button>` ×3 in `RsvpLink` (copy/revoke/regenerate, inline/local, not `ui/Button`); `SubmitButton` (shared) in `GuestForm`
- inputs / selects / search / filters: readonly RSVP-link `<input>` (inline/local); form fields same as `/new`
- cards / tables / lists: "אישור הגעה שהתקבל" summary card (inline/local); WhatsApp interaction `<ol>` of cards (inline/local)
- badges / status chips: `Badge` (cross-area) for op_status/removal/delivery/inbound/pending; **custom non-Badge** red pill for RSVP-link revoked state (inline/local, inconsistent)
- dropdown menus / dialogs / sheets: none — no confirm dialog before link revoke (gap)
- empty / loading / error UI: `notFound()` → `guests/not-found.tsx`; inline "no WhatsApp history" message; inherited `loading.tsx`
- destructive actions: ביטול הקישור (revoke, no confirm — flagged), מחיקה in `GuestForm`'s parent list (not on this page itself)

### /app/events/[id]/guests/import
- buttons: raw `UploadButton` `<button>` (inline/local, not `ui/Button`/`SubmitButton`); template-download `<a>` styled as a button (inline/local)
- inputs / selects / search / filters: single file `<input type="file">` (inline/local) with client pre-check
- cards / tables / lists: instructions card (inline/local, bordered box + 2 bullet lists)
- badges / status chips: none (raw colored `<p>`/`<div>` banners for success/failure instead)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: inherited `guests/loading.tsx`; inline success/failure banners driven by action state
- destructive actions: none

### /app/events/[id]/guests/import/whatsapp
- buttons: local `SubmitButton` (shadows the shared one — see risk above) for אישור ייבוא / מחיקה
- inputs / selects / search / filters: none (no filter bar; per-row merge checkboxes only)
- cards / tables / lists: preview `<table>` per batch (inline/local, no mobile fallback), `MatchCard`/`FieldChoice` merge-review UI (inline/local, `<fieldset>`+checkboxes)
- badges / status chips: none (raw amber `<fieldset>`/`<p>` banners instead)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: inline "אין רשימות ממתינות" message; inherited `guests/loading.tsx`; `FormError`/`FormNotice` per card
- destructive actions: מחיקה (discard staged batch) — no confirm dialog (unlike guest/group delete elsewhere in this same area, which use `window.confirm`)

## 4. Responsive & RTL Findings

### /app/events/[id]/guests: mobile-fit = yes; wide areas: 8-col table guarded by `overflow-x-auto`+`min-w-[44rem]`, only reached `≥lg`; RTL risks: none found (phone cells correctly `dir="ltr"`)

### /app/events/[id]/guests/new: mobile-fit = yes; wide areas: none (`max-w-2xl` form); RTL risks: none found

### /app/events/[id]/guests/[guestId]: mobile-fit = yes; wide areas: none (`max-w-2xl` detail page); RTL risks: `text-left` physical class on `provider_id` paragraph — should be `text-start`

### /app/events/[id]/guests/import: mobile-fit = yes; wide areas: none; RTL risks: none found

### /app/events/[id]/guests/import/whatsapp: mobile-fit = partial (preview table has no mobile-card fallback, unlike the main list); wide areas: 4-col preview `<table>` wrapped in `overflow-x-auto`, risks scroll on ~360px with long names; RTL risks: `text-right` physical class on header `<tr>` (oversight) vs. the deliberately-commented `text-end`/symmetric-`px` exception on the `dir="ltr"` phone column (intentional, not a bug)

## 5. Duplications & Extract Candidates
- Cross-area `Badge`/`Pagination`/`formatDateTime` import from `@/app/(admin)/admin/_components` → seen in `guests/page.tsx`, `guests/[guestId]/page.tsx` → promote to a neutral shared location (`@/components/ui` or `@/components`) so customer pages don't reach into the `(admin)` route group.
- Stat-tile markup (`rounded-lg border border-border bg-card px-4 py-3` + `dt`/`dd`) → repeated 4× inline in `guests/page.tsx` → extract `StatTile`.
- "Import outcome" banner (success + per-row failure list) → seen in `import/import-form.tsx` and, in spirit, `import/whatsapp/staging-client.tsx`'s match/error messaging → candidate shared `ImportResultSummary` / Alert primitive once one exists.
- `SubmitButton` name collision → `@/components/forms` (used in `guest-form.tsx`) vs. a **separately implemented** local `SubmitButton` in `import/whatsapp/staging-client.tsx` (and a third ad-hoc `UploadButton` in `import/import-form.tsx`) → all three should converge on the one shared `SubmitButton`.
- Raw destructive-button styling (`border-destructive/40 ... text-destructive hover:bg-destructive/10`) → repeated in `groups-manager.tsx` (delete group) and `staging-client.tsx` (discard, `danger` prop) → both could use `ui/Button` `variant="destructive"`/`variant="outline"` instead of hand-rolled classes (already done correctly in `guest-row-actions.tsx`).
- `window.confirm` used for destructive confirms in `guest-row-actions.tsx` (delete guest) and `groups-manager.tsx` (delete group), but **not** for revoke-RSVP-link (`rsvp-link.tsx`) or discard-staged-import (`staging-client.tsx`) — inconsistent confirm coverage for similarly destructive actions across the same area.
- Mobile card ↔ desktop table pattern (established cleanly in `guests/page.tsx`) is **not** replicated in `import/whatsapp/page.tsx`'s preview table → apply the same pattern there for consistency.

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: `Button`, `buttonVariants` (`guests/page.tsx`, `guest-row-actions.tsx`)
- from `@/components`: `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`, used in `guest-form.tsx`, `groups-manager.tsx`, `import-form.tsx`, `rsvp-link.tsx`, `staging-client.tsx`); `recoverFromVersionSkew` (`@/components/use-version-skew-reload`, used in `contact-status-cell.tsx`, `guest-row-actions.tsx`, `groups-manager.tsx`)
- cross-area (not `@/components/*`, flagged above): `Badge`, `Pagination`, `formatDateTime`, `BadgeVariant` type from `@/app/(admin)/admin/_components` (`guests/page.tsx`, `guests/[guestId]/page.tsx`, `labels.ts`)
- inline/local components defined in this area:
  - `guests/labels.ts` → Hebrew label + `Badge`-variant maps for `guest_status`/`contact_status`/`contact_op_status`/`removal_requested` (re-exports `delivery_status` labels from `@/lib/data/admin/labels`)
  - `guests/contact-status-cell.tsx` → inline contact-status quick-select (client)
  - `guests/groups-manager.tsx` → collapsible (`<details>`) groups CRUD widget (client)
  - `guests/guest-form.tsx` → shared create/edit guest form (client)
  - `guests/guest-list-controls.tsx` → URL-driven filter/sort bar (client)
  - `guests/guest-row-actions.tsx` → per-row edit link + delete button, compact/full variants (client)
  - `guests/[guestId]/rsvp-link.tsx` → RSVP-link copy/revoke/regenerate widget (client)
  - `guests/import/import-form.tsx` → CSV upload form + result banners (client)
  - `guests/import/whatsapp/staging-client.tsx` → staged-import confirm/discard + per-field merge review UI (client)
