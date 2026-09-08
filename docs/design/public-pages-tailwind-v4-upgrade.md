# Public pages — Tailwind v4.3 upgrade: layout, type, touch targets (2026-09-08)

> Scope: the marketing site `src/app/(public)/(site)/**` + `SiteHeader` / `SiteFooter` /
> `EventTypePage`, and the guest token pages `/r` `/g` `/ty` `/rate` `/join` (visual only).
> Builds on the 2026-07-08 audit (`design-audit-summary.md`, `responsive-rtl-audit.md`,
> `audit-fragments/area-public.md`, `reusable-components-plan.md`) — it closes the public-area
> findings there and does not re-audit.
>
> **Lane split (team-lead ruling, 2026-09-08):** this document covers **layout, container queries,
> logical properties, fluid typography, spacing, touch targets, focus states and static gradients**.
> **All motion** — entrances, scroll reveals, hover lifts/tilts, keyframes, `@starting-style`,
> tw-animate — is owned by the motion layer (`src/app/motion.css`, `public-pages-motion-spec.md`,
> `tailwind-v4-motion-cheatsheet.md`) and is deliberately absent from the files below. Pre-existing
> hover strings on the homepage cards were restored verbatim for that layer to replace.
>
> **Rulings honoured:** colours untouched (every colour class on every touched page is the one that
> was there; the `/faq` lavender `bg-indigo-50` card stays); logical properties only; no new
> dependencies; no `any`, no suppressions; token pages: **zero** change to data loading, Server
> Actions, token validation, RPC calls, rate limiting, redirects or error semantics.
>
> **Verification method for every utility below:** compiled against the INSTALLED
> `tailwindcss@4.3.3` (a scratch `compile()` script listing each candidate class, run before the
> class was written into any file), then confirmed present in the production build's CSS
> (`.next-verify/static/css/*`). Nothing here was written from memory of Tailwind syntax.

## 1. What changed, per file

| File | Change | Tailwind v4 feature | Why (before → after) |
|---|---|---|---|
| `src/app/globals.css` | `@theme { --text-hero / --text-title / --text-display + --line-height pairs }` | `@theme` custom text scale (same `--text-x--line-height` pair shape as `node_modules/tailwindcss/theme.css`) | Headings jumped at the 640px breakpoint (`text-4xl sm:text-6xl`). Now fluid `clamp()`: hero 36→60px, title 36→48px, display 30→36px. The clamp endpoints are the OLD sizes, so nothing changed at the extremes — the middle stops jumping. |
| `src/components/site/cta.tsx` (new) | `siteCta` cva class builder: variants `primary / outline / dark / onPrimary`, sizes `sm / md / lg / xl` | `focus-visible:outline-*` (v4 solid outline, forced-colors safe), `shadow-primary/25` | The audit counted ~14 hand-rolled CTA class strings across 6 files. Same colours, now with a 44px+ target (`min-h-10/11/12/13`), visible keyboard focus and a static primary-tinted shadow. Not `buttonVariants`: its sizes top out at h-11/md:h-9 and would shrink the hero CTAs on desktop. |
| `(site)/page.tsx` (home) | hero `relative isolate` + static radial wash (`before:bg-radial-[at_top_end] before:from-primary/10 before:via-transparent before:to-transparent`); `text-hero` / `text-display`; `text-balance` / `text-pretty`; `@container/preview` on the dashboard mock (`@[20rem]/preview:flex-row`, `@[22rem]/preview:text-2xl`, `tabular-nums`); `scroll-mt-16` on `#features/#how/#trust`; closing banner `before:bg-radial-[at_top_start] before:from-white/15`; `inset-ring-1 inset-ring-white/10` on the navy solution card; audience tiles `min-h-11` + focus outline; `aria-hidden` on decorative icons | `bg-radial-[…]` (logical position keywords), named `@container` + arbitrary `@[…]/name:` breakpoints, `scroll-mt-*`, `text-balance`, `inset-ring-*` | Anchor nav landed with section titles under the 64px sticky header (fixed). The hero preview card is half-row on lg and full-column on mobile — it now responds to ITS width (header row stacks < 20rem, stat numbers step down < 22rem). |
| `src/components/site/event-type-page.tsx` (`/wedding /bar-mitzva /brit /event`) | same hero wash / CTA / `text-title` / `text-display` / `text-balance` treatment | as above | One template, four pages — consistent with home. The hero copy sits in a plain `<div>` wrapper (an animation hook left for the motion layer). |
| `(site)/whatsapp/page.tsx`, `(site)/guest-list-template/page.tsx` | same hero / CTA / heading treatment; WhatsApp "rules" navy box `inset-ring-1 inset-ring-white/10` | as above | Same rhythm as home; the download `<a>` on the template page stays a plain link. |
| `(site)/faq/page.tsx` | h1 `text-display`; category chips `min-h-11 px-4` + focus outline; sections `scroll-mt-20` | `scroll-mt-*`, `min-h-11` | Chips were ~34px; anchors landed under the sticky header. Price card untouched. |
| `(site)/contact/page.tsx` + `contact/inquiry-forms.tsx` | sections `@container/form scroll-mt-20 p-4 sm:p-6`; email/phone pair `@md/form:grid-cols-2`; `Label` + `Textarea` primitives replace raw `<label>` / `<textarea>` (field wrappers `grid gap-1.5`, the shape `rating-form.tsx` already uses); native `<select>` styled like `ui/input` (`text-base md:text-sm`); radio chips `min-h-11 has-focus-visible:outline-*`; radio `outline-hidden`; page `px-4 py-10 sm:px-6 sm:py-12` | `@container` (component-width grid — a form inside a card), `has-focus-visible:`, `outline-hidden` (v4's forced-colors-safe replacement for `outline-none`) | Three field types now share one focus ring; the 2-column pair reacts to the card, not the viewport. Built CSS: `@container form (min-width:28rem)`. |
| `(site)/_legal.tsx` (`/privacy /terms /cookies`) | back link = lucide `ArrowRight` (was a literal `←` glyph — audit §3), `min-h-11` + focus outline; h1 `text-display`; page rhythm `px-4 py-10 sm:px-6 sm:py-12` like `/faq`; `space-y-8` | — (logical-direction fix) | In RTL "back" points to reading start = right; the glyph pointed the same way as the "forward" CTAs. **Visual question #3.** |
| `src/components/site/site-header.tsx` | wordmark + כניסה get `min-h-*` + focus outline; CTA → `siteCta({ size: 'sm' })` | `focus-visible:outline-*` | Keyboard focus was invisible on the wordmark and the login link. |
| `src/components/landing-mobile-nav.tsx` | rows `flex min-h-11 items-center` + focus outline; drawer CTAs → `siteCta` (`cn()`-merged) | as above | 44px rows in the drawer. |
| `/r/[token]/rsvp-form.tsx` | Stepper +/− `size-11` (was `h-9 w-9` = 36px — the audit's public-area P1), `touch-manipulation`, `tabular-nums` count; status toggles `min-h-11 text-base` + focus outline; form `@container` with `@[20rem]:grid-cols-3` (the three answers stack on ≤320px phones); all fields `FIELD_CLASS` = `min-h-11 text-base` (16px = no iOS zoom) + the `ui/input` focus ring; checkboxes `size-5 accent-primary` in `min-h-11` rows; `SubmitButton size="lg"` (h-11); Waze + gift links `min-h-11` + focus | `@container` + `@[…]:`, `touch-manipulation`, `tabular-nums`, `accent-*` | The most mobile-heavy page: every control ≥44px, every field 16px, visible focus everywhere. **No change** to `submitRsvpAction`, hidden inputs, caps or gating. |
| `/g/[token]/gift-landing.tsx`, `/ty/[token]/thankyou-landing.tsx` | gift CTA `min-h-12` + primary-tinted shadow; image/Waze links focus outline; `text-balance` on h1 | `focus-visible:outline-*` | CTA target ≥44px; focus visible. |
| `src/lib/data/event-theme.ts` (+ test) | `bg-gradient-to-b` → `bg-linear-to-b` (9 entries) | v4 gradient naming (`bg-gradient-to-*` is the v3 compatibility alias) | Same output, current name. Test updated to match. |
| `/rate/[token]/rating-form.tsx` | picker buttons focus outline + `touch-manipulation` | `focus-visible:outline-*` | Already 64px targets; focus was invisible. |
| `/join/[token]/page.tsx` | bare `<button>` → shared `SubmitButton size="lg"` (pending state); back link `min-h-11` + focus | — (reuse fix from the audit) | Double-submit risk on slow networks removed; the action is unchanged. |

**Not touched (deliberately):** every colour class; the token pages' `bg-amber-50` / `bg-red-50`
banners (routing them through `ui/alert` would change their colours); `SiteFooter` (already met the
bar); `GuestShell`; `(public)/loading.tsx` (`Skeleton` uses `bg-muted`, a colour change); `error.tsx`
files; the audit docs (they stay as the record); anything animated (motion lane).

## 2. Accessibility checklist

- **Touch targets (MEASURED in the built CSS):** `.size-11{width:calc(var(--spacing) * 11)…}`,
  `.min-h-11{min-height:calc(var(--spacing) * 11)}` → 44px at the 4px base, applied to the `/r`
  stepper, status toggles, fields, checkbox rows, submit (`Button` `lg` = h-11), Waze/gift links,
  FAQ chips, header/drawer links, legal back link, join button/link. Rendering in a real browser was
  **not** performed in this pass (INFERRED from the CSS; runtime check = owner deploys to beta).
- **Focus:** v4 `focus-visible:outline-2 outline-offset-2 outline-ring` (solid outline, survives
  forced-colors) on every link/button touched; `outline-none` avoided (v4 = true `outline-style:none`);
  the one radio uses `outline-hidden`. On the primary/navy banners the outline is `white/70`.
- **Contrast:** unchanged — no colour class was added or altered.
- **RTL:** all new utilities are logical (`start/end`, `ms/me`); `bg-radial-[at_top_end]` /
  `[at_top_start]` use logical position keywords. No physical-direction class exists in any touched
  file (grep `\b(ml|mr|pl|pr|left|right|text-left|text-right)-` → 0 hits before and after).
- **iOS zoom:** guest-page fields are 16px (`text-base`); contact fields follow `ui/input`'s
  `text-base md:text-sm`.
- **Reduced motion:** nothing in this lane animates; the motion layer carries its own guards.

## 3. P3 proposals (NOT implemented — structural / owner decisions)

1. **Safe-area padding for a sticky RSVP action bar.** There is no sticky bar today (the submit sits at
   the end of the flow), so `env(safe-area-inset-bottom)` has nothing to pad — and it would be a no-op
   anyway: the root layout exports no `viewport`, so the meta tag lacks `viewport-fit=cover` (Next's
   `Viewport` type has `viewportFit: 'cover'`, verified in `next/dist/lib/metadata/types/extra-types.d.ts`;
   `generate-viewport.md` documents the export). If a sticky submit bar is wanted on `/r`: add
   `export const viewport: Viewport = { viewportFit: 'cover' }` in `src/app/layout.tsx` (root-level,
   affects app/admin too — out of this scope) and `pb-[env(safe-area-inset-bottom)]` on the bar.
2. **`ui/alert` for the token-page banners** — the audit's highest-value extraction, but `Alert`'s
   `destructive` variant recolours (`bg-card text-destructive`), so it is a colour decision.
3. **`Card` adoption on `/contact` sections and the token cards** — `Card` brings `ring-1 ring-foreground/10`
   + `text-sm`; swapping changes border rendering. Keep for the P2 "Card everywhere" programme.
4. **`buttonVariants` for `error.tsx` buttons** ((site) + (public)) — small; bundle with the error-state sweep.
5. **`(public)/loading.tsx` → `Skeleton`** — colour change (`bg-border` → `bg-muted`).
6. **Hero copy wrapper `<div>`** in event-type / whatsapp / guest-list-template — currently a bare
   wrapper; either the motion layer uses it as its entrance hook or it should be flattened.

## 4. Open visual questions for the owner (one concrete question each)

1. Homepage hero: do you like the soft indigo glow behind the headline (top-start corner, fading to white)?
2. Headings now grow smoothly with the viewport instead of jumping at 640px — does the tablet size (~48px hero) look right to you?
3. Legal pages: the back-to-home arrow now points RIGHT (→ לדף הבית) instead of the old ← — is that the direction you expect?
4. `/r` RSVP: the +/− buttons are now 44px and the three answer buttons stack vertically on very narrow phones (≤320px) — does the stacked version look acceptable?
5. Closing CTA banners: do you like the light highlight in the top-start corner of the indigo banner?
6. Primary CTAs now carry a faint indigo-tinted shadow that deepens on hover — keep or remove?
