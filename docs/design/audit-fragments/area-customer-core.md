# Area: Customer — Dashboard & Events core

_Files read: 4 pages (+3 area-level loading/error/not-found), 5 co-located components._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/app/*` (layout) | `src/app/(customer)/app/layout.tsx` | Server | AppShell | Wraps all `/app/*` routes; requires user, resolves admin/org context |
| `/app/*` (loading) | `src/app/(customer)/app/loading.tsx` | Server | AppShell | Suspense fallback — generic pulse skeleton, not page-shaped |
| `/app/*` (not-found) | `src/app/(customer)/app/not-found.tsx` | Server | AppShell | `notFound()` fallback, links back to `/app` |
| `/app/*` (error) | `src/app/(customer)/app/error.tsx` | Client | AppShell | Error boundary; generic message + retry, version-skew-aware |
| `/app` | `src/app/(customer)/app/page.tsx` | Server | AppShell | Dashboard: counts + recent-events preview |
| `/app/events` | `src/app/(customer)/app/events/page.tsx` | Server | AppShell | Full events list (no pagination) |
| `/app/events/new` | `src/app/(customer)/app/events/new/page.tsx` | Server | AppShell | New-event page shell + back link |
| `/app/events/new` (form) | `src/app/(customer)/app/events/new/new-event-form.tsx` | Client | (co-located) | Create-event form |
| `/app/events/[id]` | `src/app/(customer)/app/events/[id]/page.tsx` | Server | AppShell | Event detail: status, campaign, edit form |
| `/app/events/[id]` (edit form) | `src/app/(customer)/app/events/[id]/edit-event-form.tsx` | Client | (co-located) | Edit event details form |
| `/app/events/[id]` (status actions) | `src/app/(customer)/app/events/[id]/event-status-actions.tsx` | Client | (co-located) | Publish / close-event buttons |
| `/app/events/[id]` (campaign section) | `src/app/(customer)/app/events/[id]/campaign-section.tsx` | Server | (co-located) | RSVP-campaign summary card + next-step CTA |
| `/app/events/[id]` (campaign setup form) | `src/app/(customer)/app/events/[id]/campaign-setup-form.tsx` | Client | (co-located) | "start RSVP campaign" CTA form |

No `loading.tsx`/`error.tsx`/`not-found.tsx` exist inside `events/` or `events/[id]/` — both inherit the `/app/*` area-level files above.

## 2. Design Briefs

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

## 3. UI Elements Per Page

### /app
- buttons: "אירוע חדש" CTA card ×1 (inline/local, styled as a card-link, not `Button`); "אירוע חדש" empty-state button (inline/local, `bg-primary` classes copy `Button`'s `default` look without using it); "לכל האירועים" text link (inline/local)
- inputs / selects / search / filters: none
- cards / tables / lists: 2 stat cards + 1 CTA card (inline/local `rounded-lg border ... bg-card p-5`); recent-events `<ul>` (inline/local, divide-y bordered)
- badges / status chips: event status pill (inline/local `rounded-full border`, not the `Badge` primitive)
- dropdown menus / dialogs / sheets: none (the account dropdown/menu lives in `AppShell`, out of this page's scope)
- empty / loading / error UI: inline empty state (icon+message+CTA) when zero events; loading/error via area-level files
- destructive actions: none

### /app/events
- buttons: "אירוע חדש" top button (inline/local `bg-primary`); "עריכה" per-row link (inline/local `border border-border`)
- inputs / selects / search / filters: none (no search/filter/sort on the events list)
- cards / tables / lists: single `<ul>` divide-y bordered list (inline/local)
- badges / status chips: event status pill (inline/local, same pattern as `/app`)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: inline empty state (message only, no CTA — see §2 inconsistency); loading/error via area-level files
- destructive actions: none

### /app/events/new
- buttons: "יצירת אירוע" submit (`SubmitButton`, shared, full-width by default); "חזרה לרשימה" back-link (inline/local text link)
- inputs / selects / search / filters: `name` text input (inline/local); `event_type` select (inline/local); celebrant text inputs + `host_composition` select (inline/local, per `CELEBRANT_FIELD_LABELS`); `event_date` (`DateSelectIL`, shared); `event_time` (`TimeSelect24`, shared); `venue_name` text input (inline/local)
- cards / tables / lists: none (single form, no card wrapper — page uses a bare `max-w-lg` container)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError` (shared) inline banner on failure; `FieldError` (shared) per-field
- destructive actions: none

### /app/events/[id]
- buttons: "ניהול מוזמנים" link-as-button (`buttonVariants({variant:'outline'})`, ui); publish/close buttons (inline/local `ActionButton` in `event-status-actions.tsx`, variants `primary`/`danger` are hand-rolled className strings, NOT `buttonVariants`); campaign CTA link (`buttonVariants()` default, and `buttonVariants({variant:'outline'})` for the past-event view-only case, both ui); "שמירת שינויים" submit (`SubmitButton`, shared); invite-image file input has no submit of its own (rides the main form submit)
- inputs / selects / search / filters: `name`, `venue_name`, `venue_address`, `gift_payment_url` text/url inputs (inline/local); `event_type` select (inline/local, conditionally disabled); celebrant fields (inline/local, conditionally required); `event_date`/`rsvp_deadline` (`DateSelectIL`, shared, conditionally disabled); `event_time` (`TimeSelect24`, shared, conditionally disabled); `show_meal_pref` checkbox (inline/local); `invite_image` file input (inline/local, with client-side size check)
- cards / tables / lists: 2 "section card" divs (campaign section, edit-form section) — both inline/local `rounded-lg border border-border bg-card p-6`, not `@/components/ui/card`
- badges / status chips: event status pill (inline/local plain span, NOT `Badge`); "האירוע חלף" past-event pill (inline/local, warning-toned); campaign status pill (`Badge`/`BadgeVariant` — imported from `@/app/(admin)/admin/_components`, cross-area, flagged in §5)
- dropdown menus / dialogs / sheets: none — the destructive close action uses a native `window.confirm()`, not the shared `Sheet`/any dialog primitive (no Dialog primitive exists at all per the known-components list)
- empty / loading / error UI: `CampaignSetupForm`'s `FormError` (no-campaign-yet state); `PastEventNotice` inline warning; `FormError`/`FormNotice` (shared) on every action form
- destructive actions: close-event button — `variant="danger"` (hand-rolled, not `buttonVariants({variant:'destructive'})`), gated by `window.confirm()`, disabled while an operational campaign exists (client hint), and server/DB-enforced per code comments

## 4. Responsive & RTL Findings

### /app: mobile-fit = yes; wide areas: none found; RTL risks: none found — all logical spacing/alignment classes
### /app/events: mobile-fit = partial (list row has `min-w-0 flex-1` so it can't force horizontal overflow, but lacks the `truncate` present in the dashboard's identical pattern — long names wrap to multiple lines instead of clipping); wide areas: none found; RTL risks: none found
### /app/events/new: mobile-fit = yes (form capped `max-w-lg`; `DateSelectIL`/`TimeSelect24` stay `w-fit`, not verified live at 360px); wide areas: none found; RTL risks: none — the two ltr-forced date/time controls are an intentional, documented exception
### /app/events/[id]: mobile-fit = yes (flex-wrap header/actions; invite-image preview capped `max-w-[20rem]`); wide areas: none found; RTL risks: none — `gift_payment_url` intentionally `dir="ltr"`, date/time controls ltr-internal as above

## 5. Duplications & Extract Candidates
- "Event summary row" (name + `[type · date · venue]` join + status pill) → seen in `/app` (dashboard, with `min-w-0`/`truncate`) and `/app/events` (list, without) → suggest extract as `EventListItem`, fixing the truncation drift in the process
- "Stat/section card" (`rounded-lg border border-border bg-card p-5|6`) → seen in `/app` (2 stat cards + CTA card) and `/app/events/[id]` (campaign section, edit-form section) → `@/components/ui/card` already exists and is unused everywhere in this area; suggest migrating these divs onto it
- `CelebrantFields` (per-event-type celebrant input group) → duplicated in `new-event-form.tsx` and `edit-event-form.tsx` (edit's version adds `disabled`/`required` lock props) → suggest one shared component parameterized by `{defaults?, requiredKeys?}`
- Local `inputClass` constant → redefined identically in `new-event-form.tsx` and `edit-event-form.tsx` (edit's adds `disabled:*` variants) → suggest a shared constant/util, or real `Input`/`Select` primitives
- Event-status pill markup (`rounded-full border border-border px-3 py-1 text-xs text-muted-foreground`) → identical inline markup in `/app`, `/app/events`, and `/app/events/[id]` (page.tsx) → suggest a shared `Badge`/status-chip usage, replacing 3 separate hand-rolled copies
- `ActionButton`'s destructive-confirm pattern (`event-status-actions.tsx`) → per its own code comment, mirrors a twin in `campaign/[campaignId]/manage-client.tsx` (outside this area's scope) → suggest a shared `ConfirmButton`
- `Button`/`buttonVariants` under-used → every hand-rolled `bg-primary`/`border border-border` link-as-button across `/app`, `/app/events`, `/app/events/new`, and `event-status-actions.tsx` duplicates styling that `buttonVariants` (already used elsewhere on `/app/events/[id]`) would produce consistently

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: `buttonVariants` (`events/[id]/page.tsx`, `campaign-section.tsx`)
- from `@/components`: `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`forms.tsx` — used in `new-event-form.tsx`, `edit-event-form.tsx`, `event-status-actions.tsx`, `campaign-setup-form.tsx`); `DateSelectIL`, `TimeSelect24` (used in `new-event-form.tsx`, `edit-event-form.tsx`); `compactSelectClass` (internal to `date-select-il.tsx`/`time-select-24.tsx`, not re-imported by this area's pages)
- **cross-area (not `@/components`):** `Badge`, `BadgeVariant` — imported by `campaign-section.tsx` from `@/app/(admin)/admin/_components` (an admin route-group file; flagged in §5/§2 as a boundary violation, not a `@/components` shared primitive)
- inline/local components defined in this area:
  - `new-event-form.tsx` → `RequiredMark`, `CelebrantFields`, `NewEventForm`
  - `edit-event-form.tsx` → `celebrantDefaults`, `CelebrantFields`, `EditEventForm`
  - `event-status-actions.tsx` → `ActionButton`, `EventStatusActions`
  - `campaign-section.tsx` → `nextStep`, `PastEventNotice`, `CampaignSection` (also re-exports the admin `Badge` visually into this area, see above)
  - `campaign-setup-form.tsx` → `CampaignSetupForm`
