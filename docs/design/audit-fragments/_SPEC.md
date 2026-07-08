# KALFA Design Audit — Shared Agent Spec

You are one agent in a parallel **Design System Audit + Page Inventory** of the KALFA codebase.
Repo root: `/var/www/vhosts/kalfa.me/beta`. Source under `src/`.

## Rules (non-negotiable)
1. **READ every assigned file FULLY** with the Read tool. Do NOT rely on grep/excerpts to decide behavior. Also `ls` each route directory you own and read EVERY co-located `.tsx` component (files like `*-form.tsx`, `*-client.tsx`, `_components.tsx`).
2. **Never guess.** If something is unclear from the code, write `Needs verification` — do not assert it as fact.
3. Classify every fact from the actual code you read. Quote file paths.
4. Output is a **Markdown fragment file** written to the exact path given in your task. Follow the Fragment Structure below EXACTLY (same headings/order) so the orchestrator can assemble the final docs.
5. Return to the orchestrator ONLY: a 4-6 line summary + the list of routes you documented + any assigned file that did NOT exist.

## Project context
- KALFA = Hebrew-first, **RTL**, B2C **per-event RSVP** platform. Stack: Next.js App Router, React, TypeScript, Tailwind, Supabase, `@base-ui/react` (shadcn-style wrappers).
- Server Component by default; a file is a **Client Component** only if its first line is `'use client'`. A `page.tsx` with no directive is a Server Component even if it renders client children.
- Design tokens: `src/app/globals.css` + `DESIGN.md` (root). Colors are semantic tokens: `primary`, `secondary`, `muted`, `destructive`, `success`, `border`, `foreground`, `background`, `ring`, `accent`.

## Known shared components (source of truth — do NOT propose recreating these)
**Primitives — `@/components/ui/*`:** `accordion`, `button`, `card`, `chart`, `collapsible`, `dropdown-menu`, `input`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `switch`, `tabs`, `tooltip`.
**IMPORTANT — these do NOT exist as shared primitives (so if a page needs them they are hand-rolled inline — flag as extract candidates):** Badge / status-chip, Table, Dialog/Modal (only `sheet` exists), Textarea, Label, Checkbox, Radio, Avatar, Alert/Banner, Pagination, EmptyState, PageHeader, Toast.
**Button variants available:** `default` (=primary), `outline`, `secondary`, `ghost`, `destructive`, `link`. Sizes: `default, xs, sm, lg, icon, icon-xs, icon-sm, icon-lg`.
**Shared composed — `@/components/*`:** `admin-shell` (AdminShell), `app-shell` (AppShell), `forms` (`SubmitButton`, `FieldError`, `FormError`, `FormNotice`, `compactSelectClass`), `date-select-il` (DateSelectIL), `time-select-24` (TimeSelect24), `password-input` (PasswordInput), `org-switcher` (OrgSwitcher).

## Shells
- **Customer `/app/*`** → wrapped by `src/app/(customer)/app/layout.tsx` which renders `<AppShell>`: RTL sidebar `side="right"`, `DirectionProvider`, offcanvas mobile drawer (hamburger `< md`), sticky top header with search placeholder + `OrgSwitcher` + account `DropdownMenu`; content container `mx-auto w-full max-w-5xl px-4 py-8`.
- **Admin `/admin/*`** → `src/app/(admin)/admin/layout.tsx` → `<AdminShell>`: same pattern, longer nav, no search/org-switcher, "אזור ניהול" header. Content container `max-w-5xl`.
- **Public `(public)/*`, Auth `auth/*`, root** → only the **root** `src/app/layout.tsx` (`<html lang="he" dir="rtl">`, Heebo font). **No sidebar/shell** — these pages own their full layout.

## Source classification for every UI element
- `ui` = imported from `@/components/ui/*`
- `shared` = imported from `@/components/*` (non-ui, e.g. forms.tsx, shells)
- `inline/local` = defined inside the page or a co-located file in the same route folder

## RTL / responsive checks (report from code)
- Flag physical-direction classes (`left/right`, `ml-/mr-/pl-/pr-`, `text-left/right`) — should be logical (`start/end`, `ms-/me-/ps-/pe-`, `text-start/end`). External API constraints excepted (note them).
- Flag fixed pixel widths (`w-[NNrem]`, `min-w-[NNrem]`, `w-96`) that could overflow a ~360px mobile viewport.
- Flag wide **tables** with no mobile-card fallback (desktop table vs mobile cards pattern).
- Flag horizontal-scroll / overflow risks; note if `overflow-x-auto` wrapper exists.

---

## BRIEF FORMAT — exactly these 20 fields, per page
```
### <route>
- **Route:** 
- **Page name:** <Hebrew> / <English>
- **Component type:** Server | Client
- **Shell/Layout:** AppShell | AdminShell | Root-only
- **Current purpose:** 
- **Primary user goal:** 
- **Main content sections:** 
- **Actions:** 
- **Forms / fields:** (field names + validation if visible; else "—")
- **Tables / lists:** 
- **Status states:** (RSVP status, order status, campaign status, etc. — actual values)
- **Empty / loading / error states:** (present? file-based loading.tsx/error.tsx? inline?)
- **Existing shared components used:** (ui + shared, with names)
- **Components that should be reused:** (existing primitives that this page hand-rolls instead)
- **Components that should be extracted:** (repeated inline patterns worth a shared component)
- **Mobile considerations:** 
- **Desktop considerations:** 
- **RTL considerations:** 
- **Design risks:** 
- **Recommended redesign scope:** None | Light | Medium | Heavy
```

## FRAGMENT STRUCTURE — write this to your output path
```
# Area: <Area Name>
_Files read: <count> pages, <count> co-located components._

## 1. Inventory Rows
| Route | File | Type | Shell | Purpose (short) |
|---|---|---|---|---|
(one row per page/route incl. loading/error/not-found files you own)

## 2. Design Briefs
(one brief per PAGE using the 20-field BRIEF FORMAT above; skip loading/error/not-found here)

## 3. UI Elements Per Page
### <route>
- buttons: <list + variant + source>
- inputs / selects / search / filters: <+ source>
- cards / tables / lists: <+ source>
- badges / status chips: <+ source, note if inline>
- dropdown menus / dialogs / sheets: <+ source>
- empty / loading / error UI: 
- destructive actions: 

## 4. Responsive & RTL Findings
### <route>: mobile-fit = yes|partial|no; wide areas: ...; RTL risks: ...

## 5. Duplications & Extract Candidates
- <pattern> → seen in <routes> → suggest extract as `<ComponentName>`

## 6. Shared Components Referenced (from imports)
- from `@/components/ui`: ...
- from `@/components`: ...
- inline/local components defined in this area: <filename → what it renders>
```
