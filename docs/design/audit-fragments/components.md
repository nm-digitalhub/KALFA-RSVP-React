# Component Inventory & Design System
_Files read: 24 (16 ui primitives + 8 non-ui shared components/hooks) + 4 area/data files (`_components.tsx`, `admin/labels.ts`, `admin/orders.ts`, `guests.ts`) + 5 verification reads (`guests/labels.ts`, `contact-status-cell.tsx`, `team-client.tsx`, `campaign-section.tsx`, `guests/page.tsx` excerpt, `callbacks/*`)._

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

## D. Button taxonomy

| Existing variant | Maps to role | Notes |
|---|---|---|
| `default` | **primary** | `bg-primary`, main CTA |
| `secondary` | **secondary** | `bg-secondary` |
| `outline` | **outline** | bordered, transparent bg |
| `ghost` | **ghost** | no border/bg until hover |
| `destructive` | **destructive** | tinted `bg-destructive/10`, not solid red |
| `link` | text-link role | underline-on-hover, no button chrome |
| size `icon` / `icon-xs` / `icon-sm` / `icon-lg` | **icon** role | a *size*, combinable with any variant (commonly `ghost` + `icon-sm`, seen throughout shells/sidebar/sheet-close) |

All 6 roles the app needs (primary/secondary/ghost/outline/destructive/icon) are already covered by the existing variant × size matrix — **no missing button role**. One soft gap: `SubmitButton` (`forms.tsx`) swaps label text to `"רגע…"` while pending but has no spinner/icon affordance — pending state is text-only, not a `Button`-level `loading` prop. If a spinner pattern is wanted later, it belongs on `ui/button.tsx` itself (a `loading?: boolean` prop), not as another forms.tsx one-off.

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
