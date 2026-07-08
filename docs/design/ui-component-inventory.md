# KALFA — UI Component Inventory

> Every existing UI component, where it is used, and what is duplicated / hand-rolled.
> Part A: the shared component library. Part B: per-page UI-element usage. Produced 2026-07-08.

**Scope note:** structure/usage/duplication only — no color analysis.

---

# Part A — Shared component library

## A. UI Primitives (src/components/ui)

| Component | File | Exported parts | Variants / sizes | Base (base-ui / cva / native) | Purpose |
|---|---|---|---|---|---|
| Accordion | `accordion.tsx` | `Accordion, AccordionItem, AccordionTrigger, AccordionPanel` | none | `@base-ui/react/accordion` | Collapsible grouped sections |
| Button | `button.tsx` | `Button, buttonVariants` | variant: `default/outline/secondary/ghost/destructive/link`; size: `default/xs/sm/lg/icon/icon-xs/icon-sm/icon-lg` | `@base-ui/react/button` + cva | Core action control, used everywhere |
| Card | `card.tsx` | `Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter` | `size: default/sm` | native `div` | Content container |
| Chart | `chart.tsx` | `ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle` + `ChartConfig` type | theme-driven (light/dark CSS var injection) | Recharts wrapper | Dashboard charts |
| Collapsible | `collapsible.tsx` | `Collapsible, CollapsibleTrigger, CollapsiblePanel` | none | `@base-ui/react/collapsible` | Single show/hide panel |
| DropdownMenu | `dropdown-menu.tsx` | `DropdownMenu, *Portal, *Trigger, *Content, *Group, *Label, *Item, *CheckboxItem, *RadioGroup, *RadioItem, *Separator, *Shortcut, *Sub, *SubTrigger, *SubContent` | Item `variant: default/destructive` | `@base-ui/react/menu` | Menus, account menus, per-row actions |
| Input | `input.tsx` | `Input` | none (relies on native `type`) | `@base-ui/react/input` | Text/search/etc. field |
| ScrollArea | `scroll-area.tsx` | `ScrollArea, ScrollBar` | `orientation: vertical/horizontal` | `@base-ui/react/scroll-area` | Custom-styled scroll container, RTL-safe scrollbar placement |
| Select | `select.tsx` | `Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectGroupLabel` | generic `<Value, Multiple>` | `@base-ui/react/select` | Styled dropdown select (portal-based; needs `DirectionProvider` ancestor) |
| Separator | `separator.tsx` | `Separator` | `orientation: horizontal/vertical` | `@base-ui/react/separator` | Divider line |
| Sheet | `sheet.tsx` | `Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription` | `side: top/right/bottom/left`, `showCloseButton` | `@base-ui/react/dialog` (aliased) | Slide-in panel — **the only dialog/modal primitive in the app** (no centered modal exists) |
| Sidebar | `sidebar.tsx` | `Sidebar, SidebarProvider, SidebarContent, SidebarFooter, SidebarGroup*, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu*, SidebarRail, SidebarSeparator, SidebarTrigger, useSidebar` (18 exports) | `side: left/right`, `variant: sidebar/floating/inset`, `collapsible: offcanvas/icon/none`, menu-button `variant: default/outline`, `size: default/sm/lg` | Base UI (`useRender`/`mergeProps`) + cva, composes `Sheet`/`Input`/`Separator`/`Skeleton`/`Tooltip`/`Button` | Full app-shell navigation scaffold; largest/most complex primitive (727 lines) |
| Skeleton | `skeleton.tsx` | `Skeleton` | none | native `div` + `animate-pulse` | Loading placeholder |
| Switch | `switch.tsx` | `Switch` | none | `@base-ui/react/switch` | Boolean toggle, RTL-safe via `ms-*` |
| Tabs | `tabs.tsx` | `Tabs, TabsList, TabsTab, TabsPanel` | none | `@base-ui/react/tabs` | Tabbed panels |
| Tooltip | `tooltip.tsx` | `TooltipProvider, Tooltip, TooltipTrigger, TooltipContent` | `side/align` position props | `@base-ui/react/tooltip` | Hover/focus hint popup |

## B. Shared Composed (src/components, non-ui)

| Component | File | Purpose | Depends on |
|---|---|---|---|
| AdminShell | `admin-shell.tsx` | Admin `/admin/*` shell: RTL right sidebar (offcanvas), 14-item nav, top bar with account dropdown + optional external jobs-dashboard link | `ui/sidebar`, `ui/dropdown-menu`, `ui/button`, `@base-ui/react/direction-provider` |
| AppShell | `app-shell.tsx` | Customer `/app/*` shell: RTL right sidebar, nav (dashboard/events/orders/[team]/settings/[admin link]), top bar with search placeholder + `OrgSwitcher` + account dropdown | `ui/sidebar`, `ui/dropdown-menu`, `ui/input`, `ui/button`, `OrgSwitcher` |
| SubmitButton / FieldError / FormError / FormNotice / compactSelectClass | `forms.tsx` | Form primitives: pending-aware submit button (via `useFormStatus`), field/form-level error text, success notice text, shared compact-select className | `ui/button`, `cn` |
| DateSelectIL | `date-select-il.tsx` | 3-part day/month/year `<select>` composing an ISO `YYYY-MM-DD` into a hidden input — forces IL dd/mm/yyyy order regardless of browser locale | `forms.tsx` (`compactSelectClass`), `lib/data/event-date` |
| TimeSelect24 | `time-select-24.tsx` | 2-part hour/minute `<select>` composing `HH:mm` into a hidden input — forces 24h display regardless of browser locale | `forms.tsx` |
| PasswordInput | `password-input.tsx` | Native password `<input>` + show/hide eye toggle button | `cn` |
| OrgSwitcher | `org-switcher.tsx` | Active-org switcher: static label if 1 org, dropdown-with-form-submit if multiple | `ui/dropdown-menu`, `ui/button`, `(customer)/app/team/actions` |
| useVersionSkewReload / recoverFromVersionSkew | `use-version-skew-reload.ts` | Hook + helper: detects a stale-deployment Server Action failure and reloads the tab once | `lib/version-skew` |

## C. Area-local shared kits

**`src/app/(admin)/admin/_components.tsx`** — server-rendered helpers local to the admin route group, but in practice functioning as **the app's de-facto Badge/EmptyState/Pagination/PageHeading kit**:
- `formatCurrency`, `formatDateTime` — He-IL formatters
- `PageHeading` — `<h1 className="text-2xl font-bold">`
- `EmptyState` — dashed-border placeholder box
- `Badge` + `badgeVariants` (cva) + exported `BadgeVariant` type — variants `neutral/success/warning/info/destructive`; a `<span>`
- `Pagination` — prev/next pager driven by `?page=`, pure `<Link>`s (works without JS)
- `parsePageParam`, `firstParam` — search-param parsing helpers

**This is NOT admin-only in practice.** `Badge`/`BadgeVariant` are imported directly from `@/app/(admin)/admin/_components` by customer-area code: `src/app/(customer)/app/events/[id]/guests/labels.ts:2`, `src/app/(customer)/app/events/[id]/guests/page.tsx:4`, `src/app/(customer)/app/events/[id]/campaign-section.tsx:3`. So the admin route group is an accidental shared-UI source for the customer app — a layering violation (`(customer)` reaching into `(admin)`) and the strongest single **promote-to-`src/components/ui/badge.tsx`** candidate in the codebase.

**Duplication found:** `src/app/(customer)/app/team/team-client.tsx:24-30` defines its **own local `Badge`** — `<span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">` — with no variant support, used 4× (role chip, "פעיל"/active chip, invitation role chip, "ממתינה"/pending chip). This is a second, independent Badge implementation coexisting with the admin one; a promoted `ui/badge.tsx` should absorb both, with variant coverage for the states this one currently hardcodes as neutral.

No other `_components.tsx` or obvious local UI-kit file exists elsewhere under `src/app` (verified via `find -iname "*_components*"` — the admin one is the only match).

## E. Status chip / Badge — STRUCTURE ONLY (IGNORE COLORS)

Ground truth from `src/lib/supabase/types.ts` enums + label maps, confirmed against actual render call sites:

| Domain | States (exact, from source) | Current rendering |
|---|---|---|
| **Order status** (`orders.status`, admin `AdminOrder`) | `pending, processing, paid, failed, demo, payment_review` | `admin/_components` `Badge`, variant from `ORDER_STATUS_VARIANTS` (`admin/labels.ts:26-33`) |
| **Guest RSVP status** (`guest_status`) | `pending, attending, declined, maybe` | `admin/_components` `Badge`, variant from a **locally re-declared** `GUEST_STATUS_VARIANTS` inside `guests/page.tsx:28-33` (labels come from `guests/labels.ts:17-22`, but the variant map is NOT colocated with the labels — a small inconsistency vs. every other domain, which keeps LABELS+VARIANTS together) |
| **Guest contact status (CRM)** (`contact_status`) | `not_contacted, contacted, responded, wrong_number, unclear, unavailable, callback` | **NOT a badge** — rendered as a native inline-editable `<select>` (`contact-status-cell.tsx:50-62`), styled with ad-hoc Tailwind border classes, not `ui/select.tsx`. The one domain-state that breaks the badge pattern entirely. |
| **Outreach op status** (`contact_op_status`, webhook-driven) | `pending_contact, not_eligible, whatsapp_sent, whatsapp_delivered, whatsapp_read, whatsapp_responded, pending_call, call_dialed, no_answer, voicemail, human_interaction_call, wrong_number, removal_requested, reached_billed, not_reached` | `admin/_components` `Badge`, variant from `OP_STATUS_VARIANTS` (`guests/labels.ts:64-80`) |
| **Delivery status** (`contact_interactions.delivery_status`, free text from Meta) | `sent, delivered, read, failed` (+ unknown fallback) | `admin/_components` `Badge`, variant from `DELIVERY_STATUS_VARIANTS` (`admin/labels.ts:107-116`), single source re-exported into the guest-domain `labels.ts` |
| **Removal-requested flag** | boolean (single state, no map) | `admin/_components` `Badge`, fixed `REMOVAL_REQUESTED_VARIANT` |
| **Campaign status** (`campaign_status`) | `draft, pending_approval, approved, scheduled, active, paused, closed, awaiting_invoice, billed, paid, cancelled` | `admin/_components` `Badge`, variant from a local `STATUS_VARIANTS` map in `campaign-section.tsx:28` (loose `Record<string, BadgeVariant>`, not exhaustive like the others) |
| **Callback status** (`callback_requests.status`, free text) | `new, in_progress, done, cancelled` (+ unknown fallback via `callbackStatusLabel`) | `admin/_components` `Badge`, **called with NO `variant` prop** (`admin/callbacks/page.tsx:41`) → always renders the `neutral` default regardless of state; a separate `<select>` (`callback-status-form.tsx`) is used to *change* it |
| **Webhook processing state** (derived, not a DB enum: `webhookProcessState()`) | `pending, processed, error` | `admin/_components` `Badge`, variant from `WEBHOOK_PROCESS_VARIANTS` (`admin/labels.ts:75-79`) |
| **Webhook kind** (free text) | `message, status` (+ unknown fallback) | `admin/_components` `Badge`, variant from `WEBHOOK_KIND_VARIANTS` (`admin/labels.ts:90-93`) |
| **Admin activity `action`** | free-text, dot-namespaced (`entity.verb`, e.g. `guest.created`, `event.published`) — ~33 distinct literals seen across call sites, only 17 covered by `ACTION_LABELS` in `admin/labels.ts`/`activity.ts`; uncovered ones fall back to the raw string | Rendered as plain text in the activity log, not a badge (**Needs verification** — did not read the activity-log page template itself) |
| **App role** (`app_role`) | `admin, user` | Label map only (`APP_ROLE_LABELS`); render site not verified in this pass |
| **Org role chips** (team page) | role names (exact enum not in the read set — **Needs verification**) | Local `team-client.tsx` `Badge` (see §C) — no variant, always neutral styling |

**Proposed single API** (structure/keys only, no colors):
```ts
type StatusTone = 'neutral' | 'success' | 'warning' | 'info' | 'destructive';
// One shared component, e.g. src/components/ui/badge.tsx
<Badge tone={STATUS_TONE[state]}>{STATUS_LABEL[state]}</Badge>
```
Keep the existing per-domain `Record<Enum, string>` (labels) and `Record<Enum, BadgeVariant>` (tones) pattern — it already works well and gives compile-time exhaustiveness. The fix is consolidation, not a new pattern:
1. Promote `Badge`/`BadgeVariant` out of `(admin)/admin/_components.tsx` into `src/components/ui/badge.tsx` (rename `variant` → keep `variant` for API stability, since 6+ files already pass it).
2. Delete `team-client.tsx`'s local `Badge`, adopt the shared one, add real variants for its role/active/pending chips instead of flattening them to neutral.
3. Fix `campaign-section.tsx`'s non-exhaustive `STATUS_VARIANTS` to match the exhaustive-`Record` pattern used everywhere else (would catch a missing `campaign_status` value at compile time).
4. Fix `admin/callbacks/page.tsx:41` to actually pass `variant={callbackStatusVariant(cb.status)}` (a variants map does not currently exist for callback status at all — labels-only) instead of silently rendering `neutral` always.
5. Decide deliberately whether `contact_status` (currently `<select>`-only) should ALSO get a badge for read-only contexts, or stay select-only by design — currently it's just inconsistent with every other domain, not clearly intentional.

## F. Missing shared primitives

| Primitive | Exists in `ui/`? | Current reality |
|---|---|---|
| **Table** | No | 2 raw `<table>` elements, hand-rolled: `guests/page.tsx` (desktop guest table) and `guests/import/whatsapp/page.tsx`. No shared `Table/TableHeader/TableRow/TableCell` primitive; each hand-writes its own `<thead>/<tbody>` classes. |
| **Dialog/Modal (centered)** | No — only `Sheet` (edge-anchored slide-in) | No confirmed centered/modal dialog anywhere in the read set; anything modal-like uses `Sheet`. |
| **Textarea** | No | 6 files use raw `<textarea>` with ad-hoc classes (not verified individually for style consistency). |
| **Label** | No dedicated `ui/label.tsx` | Raw `<label>` elements throughout (e.g. `contact-status-cell.tsx:47`, `PasswordInput` callers) — each hand-styles or uses `sr-only`. |
| **Checkbox** | No | 9 files use native `<input type="checkbox">`, no shared styled wrapper. |
| **Radio** | No | Zero native radio usage found in the app-facing search (`type="radio"` → 0 hits in `src/app`) — either unused or implemented via `@base-ui/react/select`/other patterns; **Needs verification** if a radio-group pattern exists anywhere outside `src/app`. |
| **EmptyState** | No — only area-local in `admin/_components.tsx` | Same promote-candidate as Badge; not confirmed whether customer-area pages hand-roll their own empty states or import this one too (**Needs verification** — out of this agent's read set). |
| **PageHeader/PageHeading** | No — only area-local `PageHeading` (`<h1>` only, no description/actions slot) in `admin/_components.tsx` | Minimal; no shared header-with-actions pattern found. |
| **Pagination** | No — only area-local in `admin/_components.tsx`, pure-Link based | Not confirmed if the customer guest-list pagination (which is server-paginated per `lib/data/guests.ts:listGuests`) reuses this or hand-rolls its own — **Needs verification**. |
| **Alert/Banner** | No | `FormError`/`FormNotice` in `forms.tsx` cover the two-state (error/success) inline message case with `role="alert"`/`role="status"` `<p>` tags (11 `role="alert"` hits total across `src/app`, so the pattern is used, just not componentized beyond `forms.tsx`'s two functions — no generic dismissible banner/toast). |
| **Avatar** | No | 4 hits of the same hand-rolled initials-circle pattern (`grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground`) — appears identically in `admin-shell.tsx` and `app-shell.tsx` account-menu triggers. Real duplication, small enough to be a 1-line `Avatar` component (`initial: string`). |

## G. Component taxonomy

- **Primitives** (`src/components/ui/*`, base-ui/native wrappers): `accordion`, `button`, `card`, `chart`, `collapsible`, `dropdown-menu`, `input`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `switch`, `tabs`, `tooltip`.
- **Composed** (`src/components/*`, non-ui — combine primitives + app logic): `AdminShell`, `AppShell`, `OrgSwitcher`, `SubmitButton`/`FieldError`/`FormError`/`FormNotice` (`forms.tsx`), `DateSelectIL`, `TimeSelect24`, `PasswordInput`.
- **Layout**: `AdminShell`, `AppShell` (both are shell/layout components, listed above under Composed since they also carry nav/data logic — dual-classified).
- **Page-specific** (area-local, not reusable outside their route): `admin/_components.tsx` (`Badge`, `PageHeading`, `EmptyState`, `Pagination`, formatters) — flagged in §C for promotion; `guests/contact-status-cell.tsx`; `guests/labels.ts` / `admin/labels.ts` (pure label/variant maps, not components but co-located with rendering); `team-client.tsx`'s local `Badge` (duplication flagged in §C); `campaign-section.tsx`'s local `STATUS_LABELS`/`STATUS_VARIANTS`.
- **Hooks** (not components but co-located in `src/components/`): `use-version-skew-reload.ts`.

_Button variant/size taxonomy: see `reusable-components-plan.md` §1 & §5._

---

# Part B — Per-page UI elements & shared-component usage


---

## Public + Root

### UI elements per page

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

### Shared components referenced

- from `@/components/ui`: none imported directly in this area (`SubmitButton` wraps `Button` internally, but no public-area file imports `ui/button` or any other `ui/*` primitive directly)
- from `@/components`: `FieldError`, `FormError`, `SubmitButton` (all from `@/components/forms`, used only in `r/[token]/rsvp-form.tsx`)
- inline/local components defined in this area:
  - `src/app/(public)/_legal.tsx` → `LegalShell` (page chrome: back-link, title, draft banner, company-footer) + `LegalSection` (title+prose wrapper); used by `/privacy` and `/terms`
  - `src/app/(public)/page.tsx` → `Eyebrow` (small icon+label kicker, local to this file only)
  - `src/app/(public)/r/[token]/page.tsx` → `Shell` (centered `<main>` wrapper, local to this file only, reused across its own 3 render branches)
  - `src/app/(public)/r/[token]/rsvp-form.tsx` → `Stepper` (accessible +/− counter control, local to this file, used twice for adults/kids), plus module-level helpers `asEventType`, `formatEventDateLine` (not components)


---

## Auth

### UI elements per page

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

### Shared components referenced

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


---

## Customer · Core (Dashboard & Events)

### UI elements per page

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

### Shared components referenced

- from `@/components/ui`: `buttonVariants` (`events/[id]/page.tsx`, `campaign-section.tsx`)
- from `@/components`: `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`forms.tsx` — used in `new-event-form.tsx`, `edit-event-form.tsx`, `event-status-actions.tsx`, `campaign-setup-form.tsx`); `DateSelectIL`, `TimeSelect24` (used in `new-event-form.tsx`, `edit-event-form.tsx`); `compactSelectClass` (internal to `date-select-il.tsx`/`time-select-24.tsx`, not re-imported by this area's pages)
- **cross-area (not `@/components`):** `Badge`, `BadgeVariant` — imported by `campaign-section.tsx` from `@/app/(admin)/admin/_components` (an admin route-group file; flagged in §5/§2 as a boundary violation, not a `@/components` shared primitive)
- inline/local components defined in this area:
  - `new-event-form.tsx` → `RequiredMark`, `CelebrantFields`, `NewEventForm`
  - `edit-event-form.tsx` → `celebrantDefaults`, `CelebrantFields`, `EditEventForm`
  - `event-status-actions.tsx` → `ActionButton`, `EventStatusActions`
  - `campaign-section.tsx` → `nextStep`, `PastEventNotice`, `CampaignSection` (also re-exports the admin `Badge` visually into this area, see above)
  - `campaign-setup-form.tsx` → `CampaignSetupForm`


---

## Customer · Guests

### UI elements per page

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

### Shared components referenced

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


---

## Customer · Campaign & Orders

### UI elements per page

### /app/events/[id]/campaign/[campaignId]
- buttons: lifecycle action buttons (`ActionButton`, inline/local) — variants `primary`/`danger`/default(outline-ish), none from `ui` Button
- inputs / selects / search / filters: none
- cards / tables / lists: `Stat` tiles (inline/local, `border border-border bg-card` cards); no tables
- badges / status chips: campaign status pill (inline/local `<span className="rounded-full border...">`)
- dropdown menus / dialogs / sheets: none (destructive actions use `window.confirm()` instead)
- empty / loading / error UI: delivery-breakdown hidden until `totalContacts > 0`; per-action `FormError`/`FormNotice` (shared)
- destructive actions: close campaign (danger variant + `window.confirm`), settle/charge (primary variant + `window.confirm`)

### /app/events/[id]/campaign/[campaignId]/approve
- buttons: `Button` (ui, `variant="outline"`, Sheet trigger); `SignButton`/`ResendButton` (inline/local, raw `<button>`, not `ui` Button); CTA link to payment step (inline/local anchor-styled)
- inputs / selects / search / filters: `otp_code` text input, signature hidden input + `<canvas>` (SignaturePad), 3 checkboxes — all inline/local
- cards / tables / lists: terms summary `dl` (inline/local); identity/OTP blocks are bordered `div`s (inline/local)
- badges / status chips: none (uses plain success/warning `<p>` banners instead)
- dropdown menus / dialogs / sheets: `Sheet`/`SheetTrigger`/`SheetContent`/`SheetHeader`/`SheetTitle` (ui) for the full agreement text
- empty / loading / error UI: `FormError`/`FieldError`/`FormNotice` (shared) per field/form; `useFormStatus` pending labels
- destructive actions: none directly (signing is consequential but not a delete/destroy action)

### /app/events/[id]/campaign/[campaignId]/payment
- buttons: submit button (inline/local raw `<button>`, primary-styled via literal classes, not `ui` Button)
- inputs / selects / search / filters: `cardnumber`, `expirationmonth`, `expirationyear`, `cvv`, `citizenid` (all inline/local, `data-og` attributes for SUMIT)
- cards / tables / lists: summary/explainer `section`s (inline/local bordered cards)
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: literal-color inline banners for each branch (already-held, past-event, not-active, bad-state, load-error) — none use `FormNotice`/`FormError`
- destructive actions: none (this is a capture/authorize step, not a charge)

### /app/orders
- buttons: none as `<button>`; "שלם עכשיו" is a styled `next/link` (inline/local classes, not `ui` Button)
- inputs / selects / search / filters: none
- cards / tables / lists: `<ul>` of `OrderCard` `<li>` cards (inline/local) — list, not a table
- badges / status chips: order-status badge (inline/local, `statusBadgeOverrides` map)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: explicit empty state (`Receipt` icon, inline/local), load-error banner (literal-color), `paid=1` success banner (literal-color)
- destructive actions: none

### /app/orders/[id]/pay
- buttons: submit button (inline/local raw `<button>`, same shape as the campaign hold form's)
- inputs / selects / search / filters: `cardnumber`, `expirationmonth`, `expirationyear`, `cvv`, `citizenid` (inline/local, `data-og`)
- cards / tables / lists: none beyond the plain status paragraphs
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: per-status literal-color banners (paid/success, payment_review/info, disabled/muted, error) — none use `FormNotice`/`FormError`
- destructive actions: none (payment submission, not a destructive action)

### Shared components referenced

- from `@/components/ui`: `sheet` (`Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle` — used only in `agreement-sheet.tsx`), `button` (`Button` — used only as the Sheet trigger in `agreement-sheet.tsx`). No other `ui` primitives (`input`, `select`, `card`, `tabs`, etc.) are used anywhere in this area — all inputs/cards are inline/local.
- from `@/components`: `forms` (`FormError`, `FormNotice`, `FieldError` — used in `manage-client.tsx` and the two `approve/` files; notably NOT used in either payment page or the orders pages, which hand-roll equivalent banners instead — see §5).
- inline/local components defined in this area:
  - `manage-client.tsx` → `Stat` (metric tile), `ActionButton` (confirm-gated lifecycle button), `DeliveryBar` (RTL-safe progress bar), `DeliveryBreakdown` (WhatsApp delivery/outcome section)
  - `agreement-sheet.tsx` → `AgreementSheet` (wraps `ui` Sheet with the trusted agreement HTML)
  - `sign-agreement-form.tsx` → `SignButton`, `ResendButton`, `SignAgreementForm` (OTP + signature-pad + consents)
  - `hold-form.tsx` → `CampaignHoldForm` (SUMIT J5 hold form)
  - `orders/page.tsx` → `OrderCard`
  - `payment-form.tsx` → `PaymentForm` (SUMIT J4 payment form)


---

## Customer · Account (Settings/Team/Access)

### UI elements per page

### /app/settings
- buttons: `SubmitButton` ×4 (profile save, notifications save, password-reset send, email-change send) — shared (`@/components/forms` → wraps `ui/button` default variant)
- inputs / selects / search / filters: `full_name`, `phone` (text/tel) — inline/local; 3× checkbox (`ToggleField`) — inline/local; `new_email` (email) — inline/local. No `ui/input`/`ui/select`/`ui/checkbox` used (checkbox has no shared primitive per spec; text/email inputs also hand-rolled rather than using `ui/input`).
- cards / tables / lists: 5× section "card" (`rounded-lg border border-border bg-card p-5`, inline/local, not `ui/card`); billing recent-orders `<ul>` — inline/local
- badges / status chips: order-status pill (`rounded-full border ... px-3 py-1`) — inline/local, not extracted
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: billing empty state (icon + text, inline); `loadError` top-of-page alert (inline, raw colors, not `FormError`)
- destructive actions: none on this page

### /app/team
- buttons: `RowSubmit` (local, NOT `SubmitButton`) ×5 usage sites (invite, per-member role-update, per-member remove, per-invitation resend, per-invitation revoke) — inline/local, hardcodes both its default and "danger" visual styles instead of using `ui/button` variants
- inputs / selects / search / filters: invite `email` input — inline/local; invite `role_id` select — inline/local; per-member `role_id` select — inline/local; hidden `member_id`/`invitation_id` inputs
- cards / tables / lists: `InviteForm` section card (inline/local `sectionClass`); member `<ul>` list; invitation `<ul>` list — none use `ui/card`, no `<table>` present
- badges / status chips: local `Badge` component, used 4× (role ×2, "active", "pending") — inline/local, not extracted, not the same markup as settings' order-status pill (duplication)
- dropdown menus / dialogs / sheets: none — notably absent for the destructive remove/revoke actions
- empty / loading / error UI: "אין חברים עדיין" / "אין הזמנות ממתינות" plain text (inline); per-row `FormError`/`FormNotice` (shared)
- destructive actions: **remove member**, **revoke invitation** — both fire immediately on click via `RowSubmit variant="danger"`, no confirmation step

### /app/admin-access
- buttons: `SubmitButton` (shared) for claim; `Link` styled as a button (inline/local classes) for "מעבר לאזור הניהול"
- inputs / selects / search / filters: none
- cards / tables / lists: none
- badges / status chips: none
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError` only (shared)
- destructive actions: none (claim is idempotent/safe — RPC refuses if an admin already exists)

### Shared components referenced

- from `@/components/ui`: none imported directly in any of the 3 pages/clients — `Button` is only pulled in indirectly through `SubmitButton` (`@/components/forms` → `@/components/ui/button`).
- from `@/components`: `forms.tsx` → `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (used across all three routes, though `team-client.tsx` skips `SubmitButton` in favor of a local `RowSubmit`).
- inline/local components defined in this area:
  - `settings-client.tsx`: `SectionTitle` (icon+title+description header), `ProfileSection`, `ToggleField` (checkbox toggle row), `NotificationsSection`, `BillingSection` (incl. inline order-status pill), `SecuritySection`, `AccountSection` (incl. email-change form + metadata `<dl>`), `SettingsPageClient` (top-level layout: anchor nav + sections).
  - `team-client.tsx`: `Badge` (status chip), `RowSubmit` (pending-aware submit button, primary/danger variants), `InviteForm`, `MemberRow`, `InvitationRow`, `TeamClient` (top-level layout).
  - `claim-admin-form.tsx`: `ClaimAdminForm` (submit-only form wrapper).


---

## Admin · Operations & Monitoring

### UI elements per page

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

### Shared components referenced

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


---

## Admin · Catalog (Packages/Templates/Channels)

### UI elements per page

### /admin/packages
- buttons: "חבילה חדשה" — hand-rolled `<Link>` styled as primary button (inline/local, should be `ui/button`)
- inputs / selects / search / filters: none
- cards / tables / lists: `<ul>` divided list (inline/local)
- badges / status chips: `Badge` (`shared`, `../_components`) for tier + "לא פעילה"
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `EmptyState` (shared)
- destructive actions: none on this page

### /admin/packages/new
- buttons: `SubmitButton` (shared, `@/components/forms`); "+ הוספת שלב" add-row (inline/local text button); "הסרה" remove-row (inline/local text button, destructive-colored text only)
- inputs / selects / search / filters: raw `<input>`/`<textarea>`/`<select>`/checkbox, all inline/local (no shared `Input`/`Textarea`/`Checkbox` primitives exist)
- cards / tables / lists: `TouchpointRow` repeatable row editor (inline/local, in `package-form.tsx`)
- badges / status chips: none (inline amber warning text instead, for `call` channel touchpoints)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError`/`FormNotice`/`FieldError` (shared)
- destructive actions: none (create-only)

### /admin/packages/[id]
- buttons: `SubmitButton` (shared); delete button — inline/local, hand-rolled destructive styling (should be `ui/button` `destructive` variant)
- inputs / selects / search / filters: same as `/new` (shared `PackageForm`)
- cards / tables / lists: same as `/new`
- badges / status chips: none
- dropdown menus / dialogs / sheets: native `window.confirm()` (browser-native, not a codebase `Dialog` — none exists)
- empty / loading / error UI: `FormError`/`FormNotice`/`FieldError` (shared)
- destructive actions: delete package (`DeletePackageForm`, confirm-gated)

### /admin/templates
- buttons: `SubmitButton` (shared) per template card
- inputs / selects / search / filters: raw `<input>`/`<textarea>`/checkbox, inline/local (`templates-client.tsx`); `HelpTip` (cross-route-group shared, `admin/agreement/help-tip.tsx`)
- cards / tables / lists: per-template `<form>` card, inline/local
- badges / status chips: active pill + channel pill — both inline/local (duplicate `Badge`, should reuse it)
- dropdown menus / dialogs / sheets: none
- empty / loading / error UI: `FormError`/`FormNotice`/`FieldError` (shared); **no EmptyState for zero templates**
- destructive actions: none

### /admin/channels
- buttons: `SubmitButton` (shared, save form); plain `<button>` for "בדיקת חיבור" test-connection (inline/local); copy button in `CopyRow` (inline/local, icon-only); eye-toggle button in `SecretField` (inline/local, icon-only)
- inputs / selects / search / filters: `Field`/`SecretField` (inline/local wrappers around raw `<input>`); `HelpTip` (cross-route-group shared)
- cards / tables / lists: none (uses `Accordion` panels instead)
- badges / status chips: `StatusBadge` (inline/local, 3-state — duplicate of `Badge`, should reuse it); redundant ✓/⚠ suffix on the WhatsApp tab label itself
- dropdown menus / dialogs / sheets: `Tabs`/`TabsList`/`TabsTab`/`TabsPanel` (ui, shared); `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionPanel` (ui, shared)
- empty / loading / error UI: `FormError`/`FormNotice`/`FieldError` (shared)
- destructive actions: none (enabling the channel starts live paid sends — a *consequential* action, but not a delete/destroy)

### Shared components referenced

- from `@/components/ui`: `tabs` (`Tabs`, `TabsList`, `TabsTab`, `TabsPanel`) — `channels/channels-client.tsx`; `accordion` (`Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionPanel`) — `channels/channels-client.tsx`
- from `@/components`: `forms` (`FieldError`, `FormError`, `FormNotice`, `SubmitButton`) — `packages/package-form.tsx`, `packages/[id]/delete-package-form.tsx`, `templates/templates-client.tsx`, `channels/channels-client.tsx`
- inline/local components defined in this area:
  - `admin/_components.tsx` → `PageHeading`, `EmptyState`, `Badge`, `Pagination` (not used by any page in this area), `formatCurrency`, `formatDateTime` (not used here), `parsePageParam`/`firstParam` (not used here) — consumed by all 5 pages in this area for `PageHeading`; `packages/page.tsx` additionally uses `EmptyState`, `Badge`, `formatCurrency`
  - `packages/package-form.tsx` → `PackageForm` (exported), `TouchpointRow` (local) — used by `packages/new/page.tsx` and `packages/[id]/page.tsx`
  - `packages/[id]/delete-package-form.tsx` → `DeletePackageForm` (exported) — used only by `packages/[id]/page.tsx`
  - `templates/templates-client.tsx` → `TemplatesClient` (exported), `TemplateForm` (local) — used only by `templates/page.tsx`
  - `channels/channels-client.tsx` → `ChannelsClient` (exported), `Field`, `SecretField`, `CopyRow`, `StatusBadge` (all local) — used only by `channels/page.tsx`
  - `admin/agreement/help-tip.tsx` → `HelpTip` — outside this area's route folders, but imported by both `templates-client.tsx` and `channels-client.tsx` (cross-route-group dependency)


---

## Admin · Config & Users

### UI elements per page

### /admin/agreement
- buttons: `SubmitButton` (shared, "שמירה" / "אישור והסרת טיוטה" / "עדכון אישור") ×2 default; `SubmitButton` with destructive-tint override className ("שחזור לתבנית") ×1; `HelpTip` trigger buttons (local, unstyled icon buttons) ×10 (3 in agreement-client.tsx — version, body_html, approve-version — + 7 in agreement-config-form.tsx, one per config field; verified by grep count, not the ×8 an earlier pass estimated)
- inputs / selects / search / filters: raw `<input type="text">` ×2 (version fields), raw `<textarea>` ×1 (body_html), raw `<input type="text">` ×7 (config values) — all inline/local, no shared Input primitive
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
- buttons: `SubmitButton` (shared) ×1; local "ערוך"/"הצג" toggle `<button type="button">`s ×8 (2 per maskable field × 4 maskable-or-editable fields... actually 3 maskable + edit-toggle on every field = 11 edit toggles + 3 reveal toggles)
- inputs / selects / search / filters: raw `<input>` ×11 (text/password-toggle/numeric), raw `<input type="checkbox">` ×4 (payments/sms/email/smtp_secure toggles, hand-rolled instead of shared `ui/switch`) — all inline/local via local `EditableField`
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

### Shared components referenced

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
