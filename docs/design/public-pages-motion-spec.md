# Public pages — motion & effects spec

> Scope: the marketing surface (`src/app/(public)/(site)/**`, `SiteHeader`, `SiteFooter`,
> `EventTypePage`, `siteCta`) and the guest token pages (`/r`, `/g`, `/ty`, `/rate`, `/join`).
> Companion to `tailwind-v4-motion-cheatsheet.md` (what the stack can do) and `design-audit-summary.md`
> / `DESIGN.md` (what the surface looks like). Written 2026-09-08.
>
> **Rulings honoured:** colours are out of scope (only existing tokens, or their opacity/blur, appear
> below — the `/faq` lavender card stays); every animation is inert under `prefers-reduced-motion`;
> horizontal movement is logical only; token pages are visual-only (no change to data loading, actions,
> token validation, RPCs, rate limiting, redirects or error semantics); no new dependencies; pure CSS
> wherever the docs confirm support — **zero new client components**.

## 1. Motion language (one intent, reused)

| Intent | Mechanism | Duration / easing | Reduced-motion fallback |
| --- | --- | --- | --- |
| **Entrance** (above the fold) | `@starting-style` transition on `opacity` + `translate` (`motion-safe:starting:*`) | 700ms `ease-k-out`, stagger 0 / 120 / 240 / 360ms (`k-delay-*`), total ≤ 500ms | element renders at rest, no transition |
| **Reveal** (below the fold) | scroll-driven `animation-timeline: view()` — `k-reveal` (block) / `k-reveal-group` (grid children, 3-column stagger) | scroll-linked, `ease-k-out`, range `entry 0%→45%` | fully visible at rest (also for browsers without scroll timelines and for deep links) |
| **Card hover** | `k-card`: lift 4px + `rotateX(1.5deg)` in `perspective(900px)`, on `transform` | 320ms `ease-k-out` | no hover transform (`@media (hover:hover) and (prefers-reduced-motion: no-preference)`) |
| **CTA press / glow** | `siteCta` already: `shadow-primary/25 → /30`, `motion-safe:active:scale-[0.98]`; add `motion-safe:hover:-translate-y-0.5 ease-k-out duration-300` | 300ms | shadow change only |
| **Success pop** | `motion-safe:animate-k-pop` (scale .6 → 1.06 → 1, `ease-k-spring`) | 480ms one-shot | static |
| **Mount of a new panel** | tw-animate `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 duration-300 ease-k-out` | 300ms | static |
| **Ambient (the one allowed loop)** | hero glow `motion-safe:pointer-fine-hover:before:animate-k-glow-drift` (translate/scale, 14s alternate). `pointer-fine-hover:` is a `@custom-variant` in `motion.css` = `@media (hover: hover) and (pointer: fine)` — **owner decision 2026-09-08: the loop never runs on touch devices (battery); they get the static glow** | 14s | none (static glow, same as touch) |
| **Hover-only icon loops** (homepage cards 04 / 07) | `k-ico-pulse` (container scale + fading ring) / `k-ico-bars` (chart `<rect>` scaleY) run **only** under `.k-card:hover`, `@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)`; nothing at rest, `will-change` only while hovered | 1.8s / 1.2s cycles while hovered | inert (also inert on touch) |
| **Header depth on scroll** | `k-scroll-shadow` — `::after` shadow opacity 0 → .22 over the first 96px (`scroll(root)`) | scroll-linked | no shadow |

Performance: every animated property is compositor-only (`opacity`, `translate`, `scale`, `transform`);
`box-shadow` changes only on hover of single elements. Property ownership rule: scroll reveals own
`opacity`+`translate` (they stay active at 100% forever), hovers own `transform`. Nothing animates layout.

## 2. Shared chrome

### `SiteHeader` (`src/components/site/site-header.tsx`)
- `<header class="sticky top-0 z-50 … k-scroll-shadow">` — the blur/saturate stays; the shadow fades in with scroll.
  Perf: `::after` opacity on a scroll timeline, no listener. RM: no shadow.
- Signup CTA (`siteCta` once migrated): hover lift via the shared `siteCta` classes below.

### `siteCta` (`src/components/site/cta.tsx`, owned by public-ui-upgrader; motion classes added after it is finished)
- Base: add `motion-safe:hover:-translate-y-0.5 active:translate-y-0 duration-300 ease-k-out`.
  Existing `transition`, `shadow-primary/25 → hover:shadow-primary/30`, `motion-safe:active:scale-[0.98]` stay.
- Perf: translate + shadow on hover only. RM: shadow only.

### `SiteFooter`
- No motion (a footer that animates competes with the page). Links keep `transition-colors`.

## 3. Homepage `/` (`src/app/(public)/(site)/page.tsx`)

| Section | Effect | Classes (exact) | Timing | RM |
| --- | --- | --- | --- | --- |
| Hero copy column | staggered entrance (eyebrow → h1 → lead → CTAs → trust row) | each block: `transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3` + `k-delay-100/200/300/400` (eyebrow first, via a `className` prop added to the local `Eyebrow`) | 700ms, 400ms stagger | static |
| Hero glow (upgrader's `before:bg-radial-[at_top_end] before:from-primary/10`) | the single ambient drift — fine hover pointers only (owner 2026-09-08) | `motion-safe:pointer-fine-hover:before:animate-k-glow-drift` | 14s alternate | static glow (also on touch) |
| Dashboard mockup | entrance + resting 3D tilt facing the headline; hover straightens & lifts | wrapper `lg:perspective-distant`; card `transition-[opacity,translate,transform] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-4 k-delay-200 lg:-rotate-y-6 lg:motion-safe:hover:rotate-y-0 lg:motion-safe:hover:-translate-y-1` (RTL sign: the preview sits at inline-end = left, `-rotate-y` turns its inner edge toward the headline; an LTR build would use `rotate-y-6` — `rtl:`/`ltr:` variants are zero-specificity `:where()` selectors, so the sign is written per direction rather than stacked) | 700ms in; 700ms hover | static, tilt kept (static angle is not motion) |
| Problem list (4 rows) | reveal as they enter | container `k-reveal-group` | scroll | visible |
| Solution dark panel | reveal | `k-reveal` (upgrader's `inset-ring-1 inset-ring-white/10` stays) | scroll | visible |
| Features header | reveal | `k-reveal` on the centred header div | scroll | visible |
| Features grid (7 cards + CTA tile) | staggered reveal + hover tilt | grid `k-reveal-group`; each card `k-card hover:shadow-md` (replaces `transition hover:-translate-y-1`) | 320ms hover | visible, flat |
| Feature icons `k-ico-pulse` / `k-ico-bars` (were infinite loops in `globals.css`) | **Owner decision 2026-09-08 — option 2:** loop only while the card is hovered. Moved into `motion.css` as `@utility k-ico-pulse` / `@utility k-ico-bars`, driven by `.k-card:hover` (the card is the hover surface; no `group` marker added), gated `(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)`. At rest: no animation, no `will-change`; `k-ico-pulse` keeps a 320ms `transform` transition so a mid-cycle pointer-leave settles instead of snapping. `globals.css` again defines nothing animated. | same class names on the icon container / `<svg>` | 1.8s / 1.2s while hovered | inert |
| How-it-works header + 6 step cards | `k-reveal` / `k-reveal-group` + `k-card hover:shadow-md` | scroll / 320ms | visible |
| Trust header + 4 cards (dark) | `k-reveal` / `k-reveal-group`; cards `k-card` (no shadow — dark surface) | scroll / 320ms | visible |
| Audiences tiles | `k-reveal-group`; tile `k-card hover:border-primary hover:shadow-sm` (replaces `transition hover:-translate-y-1`) | 320ms | visible |
| Closing CTA band | reveal + hover sheen | band `relative k-reveal k-sheen` (already `overflow-hidden rounded-3xl bg-primary`) | 1100ms sheen | visible, no sheen |

## 4. Event-type pages (`EventTypePage`: `/wedding` `/bar-mitzva` `/brit` `/event`), `/whatsapp`, `/guest-list-template`

Same vocabulary, fewer beats:
- Hero: eyebrow / h1 / lead / CTA row → `motion-safe:starting:*` entrance with `k-delay-100/200/300` (eyebrow first).
- Challenge / point / mistake grids → `k-reveal-group`; cards `k-card hover:shadow-md` (they have no hover today; the lift is new).
- Timing list (`<ol>`) → `k-reveal-group` on the list (li = children).
- FAQ blocks → `k-reveal` on the section header only (Q/A text stays static — readable, extractable).
- Dark "rules" panel (`/whatsapp`) → `k-reveal`.
- Closing CTA band → `relative k-reveal k-sheen`.
- `/guest-list-template` table → no motion (data table).

## 5. `/faq` and `/contact`

- `/faq`: h1 + lead entrance (`k-delay-100` on the lead); Q/A entries per section `k-reveal-group`. The price card
  (lavender, stays), the category pills and the section headers are untouched.
- `/contact`: h1 + lead entrance only. Form cards and inputs untouched (shared primitives).

## 6. Guest token pages (visual-only; server code untouched)

| Page | Effect | Classes | RM |
| --- | --- | --- | --- |
| `/r/[token]` `RsvpForm` | invite image + header entrance | image link and `<header>`: `transition-[opacity,translate] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3` (+ `k-delay-120` on the header) | static |
| | status buttons press | add `motion-safe:active:scale-95 duration-200` (`transition-colors` → `transition`) | colour only |
| | attending panel mount | `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 duration-300 ease-k-out` | static |
| | success notice (`state.notice`) | box `motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-500 ease-k-out`; `PartyPopper` icon `motion-safe:animate-k-pop k-delay-150` | static |
| | gift CTA | `transition motion-safe:hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/25` | static |
| `/g/[token]` `GiftLanding` | card depth entrance: rises and settles from a 6° backward tilt inside a perspective | new plain wrapper `<div class="perspective-distant">` around the card; card gets `transition-[opacity,translate,transform] duration-700 ease-k-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-4 motion-safe:starting:rotate-x-6` | static |
| | banner icon | `motion-safe:animate-k-pop k-delay-300` | static |
| | gift CTA | `duration-300 ease-k-out motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]` added to the upgrader's `shadow-primary/25 → /30` + `transition` | static |
| `/ty/[token]` `ThankyouLanding` | same card entrance + icon pop (no CTA) | as above | static |
| `/rate/[token]` `RatingForm` | option press `duration-200 ease-k-out motion-safe:active:scale-95` (on the existing `transition-all`); thank-you card mount `motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-500 ease-k-out`; ✓ badge `motion-safe:animate-k-pop k-delay-150` | static |
| `/join/[token]` | no motion beyond the shared button behaviour (an authorisation step should feel still) | — |

Error / rate-limit alerts on all token pages: **no animation** (an alert must never look like a reward).

## 7. RTL notes
- All movement is vertical or logical. The only horizontal motion is the mockup's Y-axis tilt, written as
  `rotate-y-6 rtl:-rotate-y-6` so the preview faces the headline in both directions.
- `k-reveal-group` staggers by `:nth-child`, i.e. DOM order = reading order — right → left in RTL.
- tw-animate `slide-in-from-start/end` are `:dir()`-aware if ever needed; `slide-in-from-left/right` are banned.

## 8. Reconciliation with the layout upgrade (2026-09-08, same session)

`public-pages-tailwind-v4-upgrade.md` (public-ui-upgrader) landed first with its own motion: a
`reveal-on-scroll` @utility + `--animate-reveal` keyframes in `globals.css` (reveal on `transform`,
hover lift on `translate`), `animate-in … fill-mode-both` hero/token entrances, and press feedback in
`siteCta`. Team-lead ruling: **motion.css is the single motion system**. What is now superseded in that
document:

| Statement there | Status now |
| --- | --- |
| §0 "This upgrade instead added a small `@theme` / `@utility` block directly in `globals.css`" and "inverted property ownership … one reconciliation pass is needed" | Done. `globals.css` keeps only the `--text-*` tokens; the `reveal-on-scroll` block was removed and `@import "./motion.css"` added. Ownership is the spec's: reveal = `opacity`+`translate`, hover = `transform` (`k-card`). |
| §1 rows mentioning `reveal-on-scroll`, `motion-safe:animate-in … delay-150 fill-mode-both`, `motion-safe:hover:-translate-y-1`, `starting:` on the RSVP attending block / rating feedback, `siteCta` "motion-safe press feedback" | Replaced by `k-reveal` / `k-reveal-group`, `motion-safe:starting:*` entrances with `k-delay-*`, `k-card`, the `MOUNT`/`SUCCESS` tw-animate combos and `motion-safe:animate-k-pop` listed in §1–§6 above. `siteCta` now carries the hover lift + press via `ease-k-out`. |
| §2 "Reduced motion: every entrance/reveal/hover-lift/press is behind `motion-safe:` or an explicit `@media`" | Still true for the new layer (verified in the compiled CSS: 8 `prefers-reduced-motion: no-preference` blocks, 0 unguarded animations). |
| §3 P3 #5 "Header depth on scroll … reconcile there" | Implemented: `k-scroll-shadow` on `SiteHeader`. |
| §4 visual questions 1, 3, 6, 7 (glow, reveals, banner highlight, CTA shadow) | Still the owner's to answer; the mechanisms behind 3 and 7 changed to the ones in this spec. |

Kept from that upgrade and built on: the hero `before:` radial wash (now also the one ambient loop),
the closing-band `before:` highlight (the `k-sheen` drift uses `::after` beneath it), `siteCta`'s
`shadow-primary/25 → /30`, the `inset-ring-1 inset-ring-white/10` on the navy panels.

## 9. JS islands (Phase 5, 2026-09-08) — `motion@13.2.0` + `react-parallax-tilt@1.7.341`

Rule kept: `motion.css` stays the system for entrances, scroll reveals, header shadow, sheen and hover lift.
JavaScript is used **only where CSS has no primitive** — pointer position, one shared scroll-progress
value driving several layers, and a stateful two-faced card. Every island is `"use client"`, small,
wraps server-rendered children (no data fetching, no props beyond presentation), SSR-safe (media
queries via `useSyncExternalStore` with a `false` server snapshot; `useReducedMotion` live), transform-only,
and reserves its size (wrappers are plain divs around the same children — no layout shift).

| Island (`src/components/motion/`) | Where | Effect | Touch / reduced motion |
| --- | --- | --- | --- |
| `TiltCard` (react-parallax-tilt) | homepage mockup (`restAngleY=-6` from `lg`, `maxAngle 7`, `scale 1.02`, glare 12% white), 7 feature cards (`maxAngle 5`, no glare), `/ty` card (`maxAngle 6`) — 8 instances on the homepage, the cap | cursor-following 3D tilt + glare, `perspective(1000px)`, 600ms `ease-k-out` return to the resting angle | no fine pointer → plain div with `fallbackClassName` (`lg:-rotate-y-6` on the mockup); reduced motion → same static branch. Gyroscope off (iOS permission prompt). |
| `HeroParallax` + `ParallaxLayer` (motion `useScroll`/`useTransform`, `m.div`, `LazyMotion domAnimation`) | homepage hero only | three depth layers over the hero's scroll-out: copy `depth −16`, mockup `−40`, a decorative primary/10 blob `+48` (lags = background). Scroll-linked, never hijacking | `useReducedMotion` → `y: 0` (static) |
| `FlipCard` (motion `m.div animate={{ rotateY }}` spring 110/16, `MotionConfig reducedMotion="user"`) | `/g` gift card | front = invitation image + greeting + date/venue, back = Waze + the shared add-to-calendar button (row below). Auto-flips to the back after 1.4s unless the guest has interacted with the card or focus is inside it — and, when the front carries the invitation (`autoFlipAwaitsFrontImage`), only once that `<img>` has loaded plus a 2.5s dwell (`autoFlipDwellMs`; rule in `auto-flip.ts`, unit-tested: pending image → no flip, failed image → the 1.4s timer from mount; owner's 4G recording 2026-09-08 showed the card turning before the invitation had painted); toggles both ways, a user flip moves focus to the new face's toggle; the hidden face becomes `inert` + `aria-hidden` **only after hydration**. **The payment CTA and the page `<h1>` (sr-only) sit OUTSIDE the card** — clickable/exposed with zero JS (security review 2026-09-08, guarded by `flip-card.test.ts`: SSR has no inert/aria-hidden face, CTA source-order outside `<FlipCard/>`) | reduced motion → no auto-flip, instant toggles |
| `AddToCalendar` → `AddToCalendarIsland` (`src/components/add-to-calendar*.tsx`, `src/lib/calendar/*`, 2026-09-08 v2) | `/g` card back face, `/r` success box | Not motion: KALFA's own "הוספה ליומן" button + Base UI Dialog menu (portaled to `<body>`, so the card's `overflow-hidden` + 3D transform never clip it and the FlipCard `inert` covers only the button). Bottom sheet under `sm` (220 ms `translate-y-6` + opacity rise, `ease-k-out`, `motion-reduce:transition-none`), centred 360px card above. Rows are per-platform links (Android intent → Google Calendar app, iOS → inline https ICS = Calendar preview, downloads elsewhere); links + ICS generated server-side by `add-to-calendar-button` in sink mode. Full matrix: `docs/design/add-to-calendar-button.md` | static (transition disabled) |
| `siteCta` spring press | — | **Not done**: the CSS lift/press (300ms `ease-k-out`, `scale .98`) is indistinguishable from a spring at this size, and converting ~14 `<Link>`s into client islands would add hydration for no visible gain | — |

Security (MEASURED in the diff): the `/g` CTA is still `href="/g/[token]/go"` (server-side redirect,
`payment_url` never reaches the client) and is rendered by the server outside any island, so it works before/without hydration; no island receives data beyond `children` and presentation
props; no data loading moved to the client.

RTL: `restAngleY=-6` faces the mockup toward the headline in RTL; the flip's 180° ends identically in
both directions; the glow blob is positioned with `end-0`.

Property ownership still holds: Tilt/parallax/flip transforms live on their own wrapper divs; the
children keep the CSS entrance (`opacity`/`translate`) and `k-card` (`transform`) — the mockup's CSS
`rotate-y` hover was removed because Tilt now owns that angle.

**TiltCard caller contract (layout review 2026-09-08):** `TiltCard` renders a plain `<div>` on the server
and switches to the `<Tilt>` island once the pointer-fine media query resolves after hydration. That is
a change of element type, so React **remounts its children** on every desktop load — and a
`@starting-style` entrance on the children (or on `className`) replays a second time. Entrances
therefore sit on an ancestor: the homepage mockup's entrance moved to its `ParallaxLayer`, `/ty`'s to a
wrapper div outside `TiltCard`. `fallbackClassName` is now also applied to the Tilt wrapper, because
the library writes its initial angle from a `requestAnimationFrame` after mount (one frame at 0°
otherwise). See `docs/design/public-pages-platform-layout-review.md`.

Bundle (MEASURED from the webpack client-reference manifests of `.next-verify`, gzip −9, same
`scratch/measure-js.py` before and after): public-route client JS 107.6 KB → 142.7 KB gz = **+35.1 KB gz**
(threshold 40). New chunks: `365-*.js` 7.0 KB gz (tilt library + the three islands), `7570-*.js` 27.8 KB gz
(motion runtime incl. `domAnimation`), homepage `page-*.js` +1.1 KB. Caveat: Next's client-reference
manifest lists the client modules of the whole app tree, so the same figure appears for every `(public)`
route; a route that renders no island (e.g. `/rate`) does not request the motion chunks at runtime
(INFERRED — verify in the browser's network panel on beta).

## 10. Touch devices (plan 2026-09-08 — phones, tablets, WhatsApp in-app)

> Status: **SHIPPED as planned, 2026-09-08** (see 10.5 for what landed and the gates). Every fact below
> tagged MEASURED was read in `node_modules/react-parallax-tilt/dist/modern/index.js` (1.7.341),
> `node_modules/motion` docs via Context7 (`/websites/motion_dev`) and the installed Tailwind 4.3.3
> `compile()`; INFERRED = predicted from code, to be confirmed on a real device (10.6).

### 10.1 What the library does on touch (MEASURED, `dist/modern/index.js`)

- The wrapper `<div>` always carries `onTouchStart → onEnter`, `onTouchMove → onMove`, `onTouchEnd →
  onLeave` — touch tracking is **not** a prop; every `<Tilt>` already tracks a finger. `touchstart`
  only measures the box and arms `will-change: transform` + the CSS transition; the **position is read
  from `touchmove` (`touches[0].pageX/Y`) only**, so a still tap does nothing and a finger *drag*
  tilts. `touchend → onLeave → reset` (default `reset: true`) eases back to `tiltAngleX/YInitial`,
  scale 1. No `preventDefault` anywhere, so the page keeps scrolling under the finger (no hijack).
- `will-change: transform` is set on first enter and never cleared (one compositor layer per touched
  card — 8 on the homepage at most).
- `gyroscope`: read **once at mount** (`componentDidMount → addEventListeners`) and once at unmount.
  Toggling the prop later neither adds nor removes the `deviceorientation` listener — so an on/off
  switch has to **remount** the `<Tilt>` (React `key`). If `DeviceOrientationEvent.requestPermission`
  is a function (iOS 13+) the library calls it immediately at mount — without a user gesture Safari
  rejects, an unhandled promise, and no listener. Therefore the gate stays in our code, before the
  prop: `gyroscope` is passed only when `typeof DeviceOrientationEvent !== 'undefined' && typeof
  DeviceOrientationEvent.requestPermission !== 'function'` (Android, desktop-less) — **no permission
  dialog is ever triggered, never on iOS**.
- `processInputDeviceOrientation`: `xPercentage = beta / tiltMaxAngleX × 100`, `yPercentage = gamma /
  tiltMaxAngleY × 100`, both clamped ±100 → the tilt angle **equals the device angle, clamped to the
  max**. A phone held for reading (beta ≈ 30–60°) pins the X axis at `+tiltMaxAngleX` (a constant
  lean-back); the visible life is the Y sway from `gamma` (left/right hand rotation, ±max). Portrait
  only — the axes are device-frame, not screen-frame (landscape swaps them; not compensated).
- **Gyro vs finger fight:** `deviceorientation` (≈60 Hz) and `touchmove` both feed `mainLoop`; the
  orientation branch skips `updateClientInput` and writes the percentages directly, so while a finger
  is down the two sources alternate frame by frame → shimmer. `reset` on `touchend` is undone by the
  next sensor event. Conclusion: **one input per instance.** Gyro instances get `pointer-events-none`
  (decorative, no interactive children) so no touch handler ever fires on them; finger instances get no
  gyro.
- The library sets its CSS transition only in `onEnter`/`onLeave`. A gyro-only element never
  "enters", so raw sensor frames would snap (≈±0.5° noise ≈ 2px edge jitter on a 550px card,
  INFERRED). The gyro branch therefore carries `transition-transform duration-300 ease-k-out` on the
  wrapper as a low-pass filter (each 16 ms frame re-targets the running transition).

### 10.2 Elements — exact behaviour, props and classes

Pointer detection (`use-media-query.ts`): `FINE_POINTER = (hover: hover) and (pointer: fine)` (unchanged);
new `COARSE_POINTER = (pointer: coarse)`. Branch order in `TiltCard`: reduced motion → static `<div>`;
fine → `<Tilt>` exactly as today (byte-identical props); coarse → `<Tilt>` touch profile; otherwise
(`pointer: none`) → static `<div>`. Server = static `<div>` (both hooks `false`), so hydration is
unchanged; the coarse branch switches after hydration like the fine one (remount → entrances stay on
ancestors, caller contract §9).

| Element | Fine pointer (unchanged) | Coarse pointer — finger | Gyro (Android only) | Static / reduced motion |
|---|---|---|---|---|
| Homepage dashboard mockup (`TiltCard restAngleY=-6`) | tilt 7°, glare 12%, scale 1.02, rest −6° from `lg` | `tiltMaxAngleX/Y 5`, `glareEnable false`, `scale 1`, `transitionSpeed 400`, `reset` default true, `tiltAngleYInitial = twoColumns ? −6 : −3` → finger drag tilts, release eases back to −3° | hero mockup **only**: `gyroscope` + `pointer-events-none will-change-transform transition-transform duration-300 ease-k-out`, `tiltMaxAngleX 4` (the pinned lean-back), `tiltMaxAngleY 8` (the sway), mounted only while the card is in view (`useInView` from `motion/react` on a plain wrapper div + `key` remount — off-screen = no sensor listener, owner battery ruling) | `fallbackClassName="-rotate-y-3 lg:-rotate-y-6"`; the `ParallaxLayer` wrapper `lg:perspective-distant` → `perspective-distant` (below `lg` a rotateY without perspective is an invisible squash). Overflow: rotateY(−3°) on a 343px card ≈ +1.5px on the near edge, inside `px-6` (INFERRED from the projection) |
| 7 feature cards (`TiltCard maxAngle=5 glare=false`) | tilt 5° + `k-card` lift | finger tilt 5°, scale 1, `transitionSpeed 400`, reset to 0 | none (7 × 60 Hz listeners + fights with the scrolling finger — rejected) | plain div |
| `/ty` card (`TiltCard maxAngle=6`) | tilt 6°, glare 12% | finger tilt 5°, no glare, scale 1 | none (the card holds the full-size-invitation link; `pointer-events-none` would kill it) | plain div |
| Feature / step / trust grids (`k-reveal-group`) | 2D reveal (unchanged) | **`k-reveal-3d`** replaces `k-reveal-group` on these three grids: same longhands + 3-column stagger; under `@media (pointer: coarse)` the grid gets `perspective: 1200px` and the children animate `k-reveal-3d` = `opacity 0→1`, `translate 0 1.25rem→0`, **`rotate: x 6deg → x 0deg`** (the individual `rotate` property — not `transform`, which `k-card` owns for hover, and not the Tilt wrapper's inline `transform`; one system per property holds: reveal = `opacity`+`translate`+`rotate`, `k-card` hover = `transform`, Tilt = inline `transform`, press = `scale`). Guarded `@media (prefers-reduced-motion: no-preference)` and `@supports (animation-timeline: view()) and (rotate: x 1deg)`. Rest = fully visible, flat. A standalone utility (not stacked with `k-reveal-group`) because Tailwind orders same-property utilities by name and `k-reveal-3d` would sort *before* `k-reveal-group` and lose. Compiled with the installed 4.3.3 `compile()`: emits `.k-reveal-3d > *`, the `:nth-child` stagger, and the nested `@media (pointer: coarse)` block (MEASURED) | — | visible, flat |
| Hero mockup reveal | — | not applicable: above the fold, a `view()` timeline is already at 100% on load; the mockup's touch 3D is the resting angle + finger + gyro above | — | — |
| Feature cards press-in | none (mouse click on a non-link must not look like a button) | new `@utility k-press`: `@media (prefers-reduced-motion: no-preference) and (pointer: coarse) { &:active { scale: .98 } }` on the 7 feature cards' inner `k-card` div; `k-card`'s `transition-property` gains `scale` so the press eases at the family's 320ms `ease-k-out`. **CSS `:active`, not `whileTap`** — `whileTap` needs `m.div` + `LazyMotion(domAnimation)` inside `TiltCard`; that would pull the 27.8 KB gz motion runtime into the `/ty` route (today it loads only the 7 KB tilt chunk) and exceed the +10 KB budget; a separate wrapper island per card is the "large island" the brief forbids. iOS Safari applies `:active` on touch only when a touch listener exists on the element or an ancestor — React 19 registers one on the root container (INFERRED; verify on iPhone). Chrome drops `:active` when a scroll starts, so scrolling over a card never presses it | — | none (inside the reduced-motion guard) |

Physical actions → effect (for the report): **finger drag** over a card = tilt following the finger,
release = ease back (400 ms); **scroll with the thumb over a card** = the card leans with the finger's
travel, then settles; **scroll** = cards stand up from a 6° lean-back as they enter (coarse only);
**tilt the phone** (Android, homepage hero in view) = the mockup sways left/right and leans back; **tap
and hold** a feature card = 2% press-in; **iOS** = everything except the gyro; **WhatsApp in-app** =
same as the host OS browser (Chrome Custom Tab on Android → gyro works there too, INFERRED;
SFSafariViewController on iOS → no gyro), `@starting-style` entrances need iOS 17.5+ / Chrome 117+;
**tablet** = phone behaviour (iPad with trackpad reports a fine hover pointer → desktop branch).

### 10.3 Fallbacks, battery, performance

- Reduced motion: `useReducedMotion` → static div (no Tilt, no gyro); every new CSS rule sits inside
  `prefers-reduced-motion: no-preference`. Static resting angles (−3°/−6°) are kept (a static angle is
  not motion, §3).
- No `animation-timeline` / no `rotate: x` support → `k-reveal-3d` never applies (double `@supports`);
  cards render flat and visible.
- No `DeviceOrientationEvent`, no sensor (events arrive with `null` beta/gamma → early return), a
  cross-origin iframe, or `requestPermission` present → no gyro, finger tracking only. Chrome pauses
  sensor events for hidden tabs (INFERRED); the `useInView` gate removes the listener whenever the
  hero is off-screen, so reading the FAQ costs nothing.
- Cost: touch tilt = one `transform` write per `touchmove` on one element (compositor-only); gyro =
  one style write per sensor frame on one element while the hero is visible; reveal-3d = compositor
  properties on a scroll timeline; press = `scale` transition. Nothing paints per frame, nothing
  animates layout, no layout shift (wrappers are transform-only divs around the same children).
- Bundle: `TiltCard` grows by the branch logic + `useInView` (already in the motion runtime chunk);
  estimate < 1 KB gz, budget +10 KB gz, measured after the build against the `.next-verify` snapshot
  taken before the change (BUILD_ID of 2026-09-08 12:35, client-reference manifests + gzip −9 of every
  referenced chunk).

### 10.4 Files to change (Phase 2)

`src/components/motion/use-media-query.ts` (+`COARSE_POINTER`), `src/components/motion/tilt-card.tsx`
(coarse branch, gyro gate, `restAngleYNarrow`, `gyroscope` prop opt-in), `src/app/motion.css`
(`@keyframes k-reveal-3d`, `@utility k-reveal-3d`, `@utility k-press`, `k-card` transition list), 
`src/app/(public)/(site)/page.tsx` (`perspective-distant`, `fallbackClassName`, `restAngleYNarrow={-3}`,
`gyroscope` on the mockup, `k-reveal-3d` on three grids, `k-press` on feature cards), and this spec
(§10 → "what shipped"). Token pages: `/ty` needs no edit (its `TiltCard` inherits the coarse branch);
`/g` is untouched (FlipCard, CTA outside the card, vitest stays green). No `package.json` / lock changes.

### 10.5 What shipped (2026-09-08, same session)

Implemented exactly as 10.2/10.4 describe. Files: `src/components/motion/use-media-query.ts`
(`COARSE_POINTER`), `src/components/motion/tilt-card.tsx` (three client branches, `restAngleYNarrow`,
opt-in `gyroscope` with the no-prompt gate, `useInView` + `key` remount, `pointer-events-none` on the
gyro branch; the fine-pointer branch is unchanged except that `tiltAngleYInitial` below `lg` now reads
`restAngleYNarrow`, default 0), `src/app/motion.css` (`@keyframes k-reveal-3d`, `@utility k-reveal-3d`,
`@utility k-press`, `k-card` transition list gains `scale`, header ownership note), 
`src/app/(public)/(site)/page.tsx` (`perspective-distant` at all widths on the mockup layer, mockup
`restAngleYNarrow={-3} fallbackClassName="-rotate-y-3 lg:-rotate-y-6" gyroscope`, `k-reveal-3d` on the
features / steps / trust grids, `k-press` on the 7 feature cards), `src/app/(public)/ty/[token]/thankyou-landing.tsx`
(comment wording only). `/g`, `/r`, `/rate`, `/join`, `EventTypePage`: untouched.

Gates (sequential, this tree): `npx tsc --noEmit` 0 errors · `npm run lint` 0 errors / 0 warnings ·
`npx vitest run src/components "src/app/(public)" src/lib/data/event-theme.test.ts` 16 files, 81 tests
passed (incl. `flip-card.test.ts`) · `npm run build` (single run, `.next-verify`, BUILD_ID
`build-TfctsWXpff2fKS`) exit 0, 0 warnings. Built CSS (`f21748941d06bb37.css`) contains
`.k-reveal-3d>*{animation-name:k-reveal;…animation-timeline:view()…}`, `@media (pointer:coarse){.k-reveal-3d{perspective:1200px}` +
`.k-reveal-3d>*{animation-name:k-reveal-3d}`, and one `.k-press:active` rule (MEASURED).

Bundle (MEASURED — client-reference manifests of `.next-verify`, gzip −9 of every referenced
`static/chunks/*.js`, same script before and after; baseline = the 12:35 build of the frozen tree):

| Route | before | after | Δ |
|---|---|---|---|
| `/` (homepage) | 143.2 KB gz | 143.7 KB gz | **+0.5 KB** |
| `/ty/[token]` | 147.0 KB gz | 148.2 KB gz | **+1.2 KB** |
| every other `(public)` route | +0.4–0.5 KB (shared islands chunk) | | |
| union of all public client chunks | 241.2 KB gz | 242.3 KB gz | **+1.1 KB** (budget +10) |

Changed chunks: islands chunk `365-*.js` 7.0 → `5492-*.js` 7.3 KB (TiltCard branches + `useInView`),
homepage `page-*.js` 1.2 → 1.4 KB, `/ty` `page-*.js` 3.8 → 4.5 KB. The motion runtime chunk (27.7 KB) is
unchanged and, as before, only requested by routes that render an island (INFERRED — network panel).

### 10.6 Needs eyes (real devices — cannot be proven from code)

1. **Android Chrome, `/`:** hold the phone normally, hero in view → the mockup leans back slightly and
   sways left/right with the hand, smoothly (no jitter); scroll the hero out → it stops; scroll back →
   it "wakes" over ~300 ms. No permission dialog. Landscape: the sway axis swaps (device frame) —
   acceptable or gate to portrait.
2. **iPhone Safari + WhatsApp in-app, `/` and `/ty/<token>`:** drag a finger over a feature card / the
   invitation → it tilts toward the finger, releases back in ~400 ms; no permission dialog ever;
   `:active` press-in visible on a held feature card (React root touch listener → INFERRED).
3. **Any phone, `/`:** scrolling down, the feature/step/trust cards stand up from a 6° lean-back as
   they enter (Chrome 115+ / Safari 26+ for `view()`; otherwise flat); the mockup rests at −3° below
   `lg` with depth (not a squash) and no horizontal scroll at 320/375/430.
4. **Desktop regression:** hover behaviour on the mockup and cards is byte-identical to before.

## 11. Verification plan
1. `node scratch/verify-classes.mjs` — every class string above compiles (done: 92/93 + 23/23, `group` is a marker); `npx @tailwindcss/cli` over `globals.css` + `motion.css` emits every custom name.
2. `npx tsc --noEmit`, `npm run lint`, focused `npx vitest run src/components/site src/app/(public)`, then one `npm run build` (coordinated with public-ui-upgrader). Phase 5: repeat, plus `scratch/measure-js.py .next-verify` before/after for the per-route client-JS delta.
3. Runtime (owner, live beta): DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce" — no element may move or fade; Performance panel — no layout/paint storms while scrolling; Hebrew RTL — stagger runs right→left, mockup tilts toward the headline.
