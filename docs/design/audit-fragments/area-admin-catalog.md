# Area: Admin — Catalog (packages, templates, channels)
_Files read: 5 pages, 4 co-located components (+ 3 `actions.ts` server-action files, `admin/_components.tsx`, `admin/layout.tsx`, and `admin/agreement/help-tip.tsx` read for context)._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
| `/admin/packages` | `src/app/(admin)/admin/packages/page.tsx` | Server | AdminShell | List all packages (active + inactive), link to create/edit |
| `/admin/packages/new` | `src/app/(admin)/admin/packages/new/page.tsx` | Server | AdminShell | Create a new package |
| `/admin/packages/[id]` | `src/app/(admin)/admin/packages/[id]/page.tsx` | Server | AdminShell | Edit an existing package; delete |
| `/admin/templates` | `src/app/(admin)/admin/templates/page.tsx` | Server | AdminShell | Manage outreach message-template content + active flag |
| `/admin/channels` | `src/app/(admin)/admin/channels/page.tsx` | Server | AdminShell | Configure WhatsApp Cloud API provider + master enable switch |

No `loading.tsx`, `error.tsx`, or `not-found.tsx` exist inside `packages/`, `packages/new/`, `packages/[id]/`, `templates/`, or `channels/` — all three routes inherit only the admin-root `admin/error.tsx` and `admin/loading.tsx` (outside this area's assigned scope). `packages/[id]/page.tsx` calls `notFound()` for a missing id with no local `not-found.tsx` in this subtree — falls through to the nearest boundary above (**Needs verification** whether one exists higher up `/admin` or root).

## 2. Design Briefs

### /admin/packages
- **Route:** `/admin/packages`
- **Page name:** חבילות / Packages (catalog list)
- **Component type:** Server
- **Shell/Layout:** AdminShell
- **Current purpose:** List every package in the catalog (active + inactive), no pagination (catalog is small per code comment).
- **Primary user goal:** Scan the catalog at a glance, jump to create or edit a package.
- **Main content sections:** Header row (heading + "new package" link) → single list.
- **Actions:** "חבילה חדשה" (create, link to `/admin/packages/new`); each list row is a `<Link>` to `/admin/packages/[id]` (whole-row click target).
- **Forms / fields:** —
- **Tables / lists:** `<ul>` divided list (`divide-y`), not a `<table>`. Each `<li>` shows name, tier badge, conditional "לא פעילה" badge, category, price.
- **Status states:** `tier` (free-text string per `package-form.tsx`, not a fixed enum — **Needs verification** whether it's constrained elsewhere); `active`/inactive — only the inactive case renders a badge ("לא פעילה"); active packages show no badge (asymmetric).
- **Empty / loading / error states:** Inline `EmptyState` ("אין חבילות עדיין. צרו את החבילה הראשונה."). No route-local loading/error files (see §1 note).
- **Existing shared components used:** `PageHeading`, `EmptyState`, `Badge`, `formatCurrency` — all from `../_components` (ui: none directly).
- **Components that should be reused:** The "חבילה חדשה" link hand-rolls primary-button classes (`rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90`) instead of `<Button asChild>` from `@/components/ui/button`.
- **Components that should be extracted:** None unique to this page (see area-wide §5 for the cross-page Badge/pill duplication).
- **Mobile considerations:** Each `<li>` row is `flex items-center justify-between gap-4` with **no `flex-wrap`** — a long package name + tier badge + inactive badge + price on one line risks overflow/clipping under ~360px. Flag.
- **Desktop considerations:** Straightforward, no issues.
- **RTL considerations:** No physical left/right classes found; uses `gap`/logical spacing throughout.
- **Design risks:** Freeform `tier` badge (no enum → visual drift if admins type inconsistent values); hand-rolled "new" button drifts from `ui/button` styling over time; asymmetric active/inactive badge reads as a possible bug at a glance; unwrapped row risks mobile overflow.
- **Recommended redesign scope:** Light

### /admin/packages/new
- **Route:** `/admin/packages/new`
- **Page name:** חבילה חדשה / New Package
- **Component type:** Server (page) wrapping Client `PackageForm`
- **Shell/Layout:** AdminShell
- **Current purpose:** Create a new package, including optional campaign/outreach configuration.
- **Primary user goal:** Fill in base package fields and (optionally) enable + configure the campaign outreach schedule, then submit.
- **Main content sections:** Heading + back-to-list link → `PackageForm` (base fields → `<hr>` → "תצורת קמפיין (אופציונלי)" section with campaign fields + dynamic touchpoint rows).
- **Actions:** Submit (create); "+ הוספת שלב" (add outreach touchpoint row); "הסרה" (remove a touchpoint row, per-row); back-to-list link.
- **Forms / fields:** `name` (text, required), `tier` (text, required), `category` (text, required), `price_with_vat` (number, required, `dir="ltr"`), `description` (textarea), `includes` (textarea, one item per line), `sort_order` (number), `active` (checkbox, default true), `price_per_reached` (number, optional — empty ⇒ non-campaign package), `channels` (checkbox group: whatsapp/call), `outreach_schedule` (dynamic repeatable rows: `days_before` number, `channel` select, `message_key` text — synced into hidden `outreach_schedule_json`), `min_hold_floor` (number), `hold_buffer_pct` (number, displayed as percent). Server-validated via `packageBaseSchema`/`operationalFieldsSchema` (Zod) in `packages/actions.ts`; per-row field errors keyed `outreach_schedule.{i}.{field}`.
- **Tables / lists:** Dynamic touchpoint row list (`TouchpointRow`, repeated) — not a `<table>`.
- **Status states:** N/A (creation form). Inline amber warning per row when `channel === 'call'` ("לא מאומת — ערוץ ה-AI voice (Voximplant) טרם נבנה").
- **Empty / loading / error states:** No route-local loading/error. `FormError`/`FormNotice` render inline from `useActionState`.
- **Existing shared components used:** `PageHeading` (`../../_components`); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`).
- **Components that should be reused:** All text inputs/selects/textarea/checkboxes are raw HTML with a locally-defined `inputClass`/`labelClass` — expected since `Input`/`Textarea`/`Label`/`Checkbox` are not shared primitives per the spec's known-gaps list, but flagged as extract candidates below.
- **Components that should be extracted:** `TouchpointRow` (structured repeatable-row editor) is a reusable pattern in its own right. `inputClass`/`labelClass` literal Tailwind strings are independently redefined here AND in `templates-client.tsx` AND in `channels-client.tsx` (3 separate copies of essentially the same classes) — extract to shared `Input`/`Label` components.
- **Mobile considerations:** `TouchpointRow`'s grid (`sm:grid-cols-[6rem_10rem_1fr_auto]`) correctly collapses to one column below `sm`. The base-fields/campaign-fields grids (`sm:grid-cols-2`) are responsive. Overall single-column mobile-first layout — no fixed-pixel-width or overflow risk found.
- **Desktop considerations:** `mx-auto max-w-2xl` centers the form; fine.
- **RTL considerations:** `dir="ltr"` is deliberately applied to all numeric/id-like fields (`price_with_vat`, `sort_order`, `price_per_reached`, `min_hold_floor`, `hold_buffer_pct`, `days_before`, `message_key`) — consistent, intentional pattern, not a bug. No physical left/right classes found.
- **Design risks:** Very long single form (base + full campaign config) with only an `<hr>`+`<h2>` as a visual section break — could feel overwhelming on first use; a `call` touchpoint can be configured for a channel that isn't built yet (Voximplant), gated only by a small amber inline warning, not a hard block; the row-remove "הסרה" control is a plain text link, not a real destructive-styled button.
- **Recommended redesign scope:** Medium (extract form primitives + touchpoint editor; consider splitting base vs. campaign config into steps/tabs)

### /admin/packages/[id]
- **Route:** `/admin/packages/[id]`
- **Page name:** עריכת חבילה / Edit Package
- **Component type:** Server (async; `getPackage(id)` → `notFound()` on missing id)
- **Shell/Layout:** AdminShell
- **Current purpose:** Edit an existing package's base + campaign fields; delete the package.
- **Primary user goal:** Update and save fields; optionally delete the package.
- **Main content sections:** Heading + back-to-list link → `PackageForm` (pre-filled) → border-divided "danger zone" with `DeletePackageForm`.
- **Actions:** Submit (save changes, stays on page with a `FormNotice`); delete (confirm-gated via native `window.confirm`, redirects to list on success); back-to-list link.
- **Forms / fields:** Same field set as `/admin/packages/new`, pre-populated from `getPackage()` (including `hold_buffer_pct` converted fraction→percent via `holdBufferFractionToPercent`). `DeletePackageForm` has no fields, just a submit.
- **Tables / lists:** Same touchpoint row list as `/new`.
- **Status states:** Same as `/new` (reuses `PackageForm`).
- **Empty / loading / error states:** `getPackage()` 404s via `notFound()`; no route-local `not-found.tsx` (see §1). No route-local loading/error otherwise.
- **Existing shared components used:** `PageHeading`, `PackageForm`, `FormError` (in `DeletePackageForm`).
- **Components that should be reused:** The delete button hand-rolls destructive styling (`bg-destructive/10 ... text-destructive`) instead of `<Button variant="destructive">` from `@/components/ui/button`.
- **Components that should be extracted:** `DeletePackageForm`'s pattern (native `window.confirm` guard + destructive submit button + `FormError`) is a "danger zone" pattern worth a shared `ConfirmDeleteForm` if repeated elsewhere in admin (**Needs verification** — not confirmed outside this file's scope).
- **Mobile / Desktop considerations:** Same as `/new` (shared `PackageForm`).
- **RTL considerations:** Same as `/new`.
- **Design risks:** Same as `/new`, plus: the destructive delete flow relies on the browser-native `confirm()` dialog rather than an in-app modal — reasonable today since no `Dialog` primitive exists in the codebase at all (per spec's known-gaps list; `sheet` exists but isn't used here), but worth flagging if a `Dialog` primitive is ever added.
- **Recommended redesign scope:** Medium

### /admin/templates
- **Route:** `/admin/templates`
- **Page name:** תבניות פנייה / Message Templates
- **Component type:** Server (async page) wrapping Client `TemplatesClient`
- **Shell/Layout:** AdminShell
- **Current purpose:** Manage outreach message-template content (WhatsApp Meta-approved template name, or call script) and each template's active flag. Seeded fail-closed (inactive until content + activation).
- **Primary user goal:** Find a template by label/key, edit name/language/body, and toggle active.
- **Main content sections:** `PageHeading` → one card `<section>` (intro paragraph) → `TemplatesClient`: one independent form-card per template.
- **Actions:** Per-template save (each `TemplateForm` has its own `useActionState`, independent of siblings).
- **Forms / fields:** Per template: `name` (text), `language` (text, default `he`), `body` (textarea, 2 rows for WhatsApp / 4 rows for call), `active` (checkbox). Server-validated (Zod, `templates/actions.ts`); fail-closed rule: cannot activate a template with both `name` and `body` empty.
- **Tables / lists:** List of card-style forms (`space-y-4`), one per template — not a `<table>`.
- **Status states:** active pill ("פעיל" / "כבוי"); channel pill ("שיחה" / "WhatsApp") — both hand-rolled inline, see below.
- **Empty / loading / error states:** **No empty state** — if `templates` is `[]`, `TemplatesClient` renders nothing (no message). No route-local loading/error.
- **Existing shared components used:** `PageHeading` (`../_components`); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`); `HelpTip` (`@/app/(admin)/admin/agreement/help-tip` — cross-route-group import, not in the spec's known-shared list).
- **Components that should be reused:** The active/inactive pill (`template.active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/30 bg-amber-500/10 text-amber-600'`) duplicates the `Badge` component from `../_components.tsx`, which already has matching `success`/`warning` variants for exactly this case — should use `<Badge variant="success">`/`<Badge variant="warning">` instead. Also redefines `inputClass`/`labelClass` locally (3rd copy area-wide, see §5).
- **Components that should be extracted:** The per-template "card with header pill row + form + save button" shape repeats structurally in `ChannelsClient`'s WhatsApp panel — a shared `SettingsCard` wrapper could serve both.
- **Mobile considerations:** `grid gap-3 sm:grid-cols-2` (name/language) collapses to one column on mobile — fine. Header `flex flex-wrap items-center justify-between gap-2` wraps correctly. The `<code>{template.message_key}</code>` tag has **no truncation/overflow handling** — a long key could overflow on narrow screens (contrast with `channels-client.tsx`'s `CopyRow`, which does truncate). Flag.
- **Desktop considerations:** Cards always render single-column (`space-y-4`) regardless of viewport width — not a bug, just unused width at wide desktop sizes.
- **RTL considerations:** No physical left/right classes found.
- **Design risks:** Hand-rolled status/channel pills duplicate the existing `Badge` primitive (color-drift risk since the classes are literal here vs. centralized in `Badge`'s `cva`); missing empty state; un-truncated `<code>` key.
- **Recommended redesign scope:** Light

### /admin/channels
- **Route:** `/admin/channels`
- **Page name:** ערוצי תקשורת / Communication Channels
- **Component type:** Server (async page) wrapping Client `ChannelsClient`
- **Shell/Layout:** AdminShell
- **Current purpose:** Configure the WhatsApp Cloud API provider (credentials + webhook wiring info) and a master `outreach_enabled` switch. Voximplant tab reserved and disabled for the future AI-call channel (C2).
- **Primary user goal:** Enter/update WhatsApp credentials, flip the enabled switch, copy webhook config values into Meta, test the connection.
- **Main content sections:** `PageHeading` → card `<section>` (intro) → `ChannelsClient`: `Tabs` (WhatsApp / Voximplant-disabled) → within WhatsApp tab: enabled-toggle row with `StatusBadge` → `Accordion` ("פרטי התחברות" credentials panel, "חיווט Webhook" info panel with `CopyRow`s) → submit button; separate small form below for "בדיקת חיבור" (test connection).
- **Actions:** Save channel config (submit, includes the `outreach_enabled` checkbox in the same form); copy-to-clipboard (`CopyRow` for callback URL / verify token); toggle secret visibility (`Eye`/`EyeOff` on Access Token / App Secret via `SecretField`); test connection (separate independent form/submit).
- **Forms / fields:** `whatsapp_phone_number_id` (text), `whatsapp_waba_id` (text, with `HelpTip`), `whatsapp_access_token` (password-toggle, with `HelpTip`), `whatsapp_app_secret` (password-toggle, with `HelpTip`), `whatsapp_verify_token` (text, with `HelpTip`), `outreach_enabled` (checkbox). Server-validated (Zod, `channels/actions.ts`); fail-closed: cannot enable without `whatsapp_phone_number_id` + `whatsapp_access_token`.
- **Tables / lists:** None — `Accordion` sections instead.
- **Status states:** `StatusBadge` — 3 states: "פעיל" (enabled), "מוגדר · כבוי" (configured but disabled), "לא מוגדר" (not configured); the WhatsApp tab label itself also appends a redundant ✓/⚠ suffix computed from `whatsapp.configured`.
- **Empty / loading / error states:** No empty state needed (form always renders). No route-local loading/error.
- **Existing shared components used:** `PageHeading`; `Tabs`/`TabsList`/`TabsTab`/`TabsPanel` (`@/components/ui/tabs`); `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionPanel` (`@/components/ui/accordion`); `FieldError`, `FormError`, `FormNotice`, `SubmitButton` (`@/components/forms`); `HelpTip` (cross-route-group, same as templates).
- **Components that should be reused:** `StatusBadge` is a **third** independent hand-rolled status-pill implementation in this area (after packages' generic `Badge` usage and templates' inline pill) — should route through the shared `Badge` (`../_components`) using its `success`/`warning`/`neutral` variants instead of a bespoke `[text, cls]` tuple. `inputClass`/`labelClass` redefined a third time (see §5).
- **Components that should be extracted:** `SecretField` (show/hide password-style field) and `CopyRow` (label + monospace value + copy button) are strong, self-contained extract candidates — likely reusable anywhere else in admin that edits secrets (**Needs verification** — outside this audit's file scope).
- **Mobile considerations:** `SecretField`'s eye-toggle button uses `absolute inset-y-0 end-0` (logical, RTL-safe). `CopyRow`'s `<code>` uses `min-w-0 flex-1 truncate` — correctly handles overflow (contrast with templates' un-truncated `<code>`, a good pattern to propagate). `Tabs`/`Accordion` collapse fine on narrow widths; no fixed-pixel widths found.
- **Desktop considerations:** No issues found.
- **RTL considerations:** `SecretField`/`CopyRow` use logical `pe-10`/`end-0` correctly. No physical left/right classes found anywhere in `channels-client.tsx`.
- **Design risks:** Clearest duplication case in the whole area — 3 independent hand-rolled status-pill implementations across packages/templates/channels. Secrets (`whatsapp_access_token`, `whatsapp_app_secret`) are rendered into the client as `defaultValue` on a togglable `type="password"` input — **Needs verification** whether `getWhatsAppChannelConfig()` (data layer, outside this file's scope) returns the real secret value or a masked placeholder to the browser; worth flagging to a security-focused reviewer even though it's outside this structural audit.
- **Recommended redesign scope:** Light–Medium (badge/pill consolidation; extract `SecretField`/`CopyRow`)

## 3. UI Elements Per Page

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

## 4. Responsive & RTL Findings

### /admin/packages: mobile-fit = partial; wide areas: list-row `flex items-center justify-between gap-4` has no `flex-wrap`, risking overflow on a long name + 2 badges + price at ~360px; RTL risks: none found (logical spacing throughout).

### /admin/packages/new: mobile-fit = yes; wide areas: none found — `TouchpointRow`'s `sm:grid-cols-[6rem_10rem_1fr_auto]` and the base-field `sm:grid-cols-2` grids both collapse to one column below `sm`; RTL risks: none — `dir="ltr"` is deliberately scoped to numeric/id fields only, no physical left/right classes.

### /admin/packages/[id]: mobile-fit = yes (inherits `PackageForm`); wide areas: none beyond `/new`; RTL risks: none beyond `/new`.

### /admin/templates: mobile-fit = partial; wide areas: `<code>{template.message_key}</code>` has no `truncate`/`overflow-x-auto` wrapper — could overflow on a narrow screen with a long key; RTL risks: none found.

### /admin/channels: mobile-fit = yes; wide areas: none found — `SecretField`/`CopyRow` explicitly handle overflow (`truncate`, `min-w-0 flex-1`) and use logical positioning (`end-0`, `pe-10`); RTL risks: none found.

## 5. Duplications & Extract Candidates
- **`inputClass`/`labelClass` literal Tailwind strings redefined independently 3×** → `packages/package-form.tsx`, `templates/templates-client.tsx`, `channels/channels-client.tsx` each declare their own near-identical copy → suggest extract as shared `Input`/`Label`/`Textarea` components (or at minimum a single shared class-constants module), since these primitives don't exist yet per the spec's known-gaps list.
- **Status/pill hand-rolled 3× independently**, each with its own literal color classes → `/admin/packages` uses generic `Badge` reasonably, but `/admin/templates`'s active/channel pills and `/admin/channels`'s `StatusBadge` both duplicate logic that the existing `Badge` (`../_components.tsx`, which already ships `success`/`warning`/`neutral` variants) could serve directly → suggest routing all three through `Badge`.
- **"Primary button styled as `<Link>`" pattern** → seen in `/admin/packages` ("חבילה חדשה") → suggest `<Button asChild>` from `@/components/ui/button`.
- **Destructive button hand-rolled** → seen in `packages/[id]/delete-package-form.tsx` → suggest `<Button variant="destructive">`.
- **"Danger zone" delete pattern** (native `window.confirm()` + destructive submit + `FormError`) → seen once in this area (`DeletePackageForm`) → flag as an extract candidate as `ConfirmDeleteForm` if the pattern repeats elsewhere in admin (**Needs verification**, outside this area's scope).
- **`SecretField` (show/hide secret input) and `CopyRow` (copy-to-clipboard row)** → seen in `channels/channels-client.tsx` → both are clean, self-contained, and likely reusable admin-wide → suggest extracting to `@/components/*`.
- **Settings-card shape** (header + pill + form + save button) → seen in `templates/templates-client.tsx`'s `TemplateForm` and structurally echoed in `channels/channels-client.tsx`'s WhatsApp panel → suggest a shared `SettingsCard` wrapper.
- **`HelpTip` lives under `admin/agreement/help-tip.tsx`** but is imported cross-route-group by both `templates-client.tsx` and `channels-client.tsx` — works today, but its home directory implies agreement-specific scope when it's actually area-wide; suggest promoting it into `admin/_components.tsx` or `@/components/`.

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: `tabs` (`Tabs`, `TabsList`, `TabsTab`, `TabsPanel`) — `channels/channels-client.tsx`; `accordion` (`Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionPanel`) — `channels/channels-client.tsx`
- from `@/components`: `forms` (`FieldError`, `FormError`, `FormNotice`, `SubmitButton`) — `packages/package-form.tsx`, `packages/[id]/delete-package-form.tsx`, `templates/templates-client.tsx`, `channels/channels-client.tsx`
- inline/local components defined in this area:
  - `admin/_components.tsx` → `PageHeading`, `EmptyState`, `Badge`, `Pagination` (not used by any page in this area), `formatCurrency`, `formatDateTime` (not used here), `parsePageParam`/`firstParam` (not used here) — consumed by all 5 pages in this area for `PageHeading`; `packages/page.tsx` additionally uses `EmptyState`, `Badge`, `formatCurrency`
  - `packages/package-form.tsx` → `PackageForm` (exported), `TouchpointRow` (local) — used by `packages/new/page.tsx` and `packages/[id]/page.tsx`
  - `packages/[id]/delete-package-form.tsx` → `DeletePackageForm` (exported) — used only by `packages/[id]/page.tsx`
  - `templates/templates-client.tsx` → `TemplatesClient` (exported), `TemplateForm` (local) — used only by `templates/page.tsx`
  - `channels/channels-client.tsx` → `ChannelsClient` (exported), `Field`, `SecretField`, `CopyRow`, `StatusBadge` (all local) — used only by `channels/page.tsx`
  - `admin/agreement/help-tip.tsx` → `HelpTip` — outside this area's route folders, but imported by both `templates-client.tsx` and `channels-client.tsx` (cross-route-group dependency)
