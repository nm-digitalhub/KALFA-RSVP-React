---
name: building-rtl-ui
description: >
  Use when building or fixing UI in the KALFA app — components under
  src/components/ or src/app/, shadcn/Base UI primitives, RTL/Hebrew layout
  issues (כיווניות, עברית), portaled menus/sheets opening the wrong way,
  sidebar/overflow bugs, or adding a missing UI primitive. Do NOT use for
  server-side data logic.
paths:
  - src/components/**
  - src/app/**
---

# Building RTL UI in KALFA

Hebrew-first, RTL-first. The stack: shadcn (base-nova registry) on
**@base-ui/react** (NOT Radix) + Tailwind v4 (CSS-config, `@theme`).

## Live-verified gotchas (these override intuition and generic docs)

1. **Base UI defaults LTR and ignores DOM `dir`.** Portaled components
   (menus, selects, sheets, tooltips) need `DirectionProvider` — and
   DirectionProvider does NOT set the `dir` attribute itself (verified from
   base-ui.com 2026-07-18): keep `dir="rtl"` on the HTML AND the provider.
   Layout wiring already exists in `src/app/layout.tsx` — reuse, don't re-wrap.
2. **Missing primitive? `npx shadcn@latest add <component>` — NEVER hand-roll**
   a `src/components/ui/*` primitive; check what exists first and reuse.
   The shadcn skill provides project context (`npx shadcn@latest info`).
3. **Collapsible in sidebar**: `SidebarGroupLabel render={<CollapsibleTrigger/>}`
   silently fails to toggle (nested useRender, runtime-only). Use
   `useState` + conditional render for sidebar group collapse.
4. **RTL + flex overflow**: nested horizontal scroll leaks into page scroll —
   fix with `overflow-x-clip` on `SidebarInset` (NOT `min-w-0`). Cells with
   status animations need a unique `scope` (ContactStatusCell precedent).
5. Logical CSS properties only (`ps-*`/`pe-*`, `start`/`end`) — physical
   left/right classes are review defects in this codebase.
6. Dates in UI: only via `src/lib/date.ts` he-IL formatters; never
   `slice(0,10)` on `event_date` (timestamptz).

## Working method

1. Find the closest existing component and match its idiom (tokens, spacing,
   focus states). 2. Reuse `src/components/ui/` + shared form primitives
   (`forms.tsx`, FormState) — never duplicate. 3. Verify in the browser in
   BOTH themes and RTL; keyboard focus visible; contrast sufficient.
   4. Accessibility floor: semantic HTML + keyboard operability (business
   exemption exists, but public RSVP pages serve the general public — keep
   them accessible; see shared/legal-catalog-israel.md §5).

For heavier work (new pages, design-system decisions) consult
`docs/design/*` (audit, page inventory, reusable-components plan) first.
