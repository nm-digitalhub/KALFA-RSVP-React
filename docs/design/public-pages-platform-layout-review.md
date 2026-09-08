# Public pages — cross-platform layout review (2026-09-08)

> Scope: every public surface — the marketing site `src/app/(public)/(site)/**` (home, `/wedding`
> `/bar-mitzva` `/brit` `/event` via `EventTypePage`, `/faq`, `/contact`, `/whatsapp`,
> `/guest-list-template`, `/privacy` `/terms` `/cookies` via `_legal.tsx`), its chrome (`SiteHeader`,
> `SiteFooter`, `LandingHeaderNav`, `LandingMobileNav`, `LandingUserMenu`, `siteCta`, the call-me-now
> widget) and the guest token pages (`/r` `/g` `/ty` `/rate` `/join`, `GuestShell`), plus the motion
> layer (`src/app/motion.css`, `src/components/motion/*`) and the root layout.
>
> **Method:** every file above was read in full (no sampling); findings are derived from the code and
> from CSS / React semantics. Nothing was rendered in a browser in this pass. Each row is therefore
> tagged **MEASURED** (a fact in the code or in the compiled output) or **INFERRED** (a consequence
> predicted from the code). Items that need eyes are in §5.
>
> **Rulings honoured:** no colour change; no logic/data change on token pages; no new dependency;
> `package.json` / lockfiles / skills-lock / the `.backup` file untouched.
>
> Companion documents: `responsive-rtl-audit.md` (2026-07-08 baseline), `public-pages-tailwind-v4-upgrade.md`
> (layout lane), `public-pages-motion-spec.md` (motion lane; §3 and §9 updated by this review).

## 1. What changed (files)

| File | Change | Why (proof from the code) |
|---|---|---|
| `src/app/motion.css` | New `@keyframes k-ico-pulse` / `k-bar` + `@utility k-ico-pulse` / `@utility k-ico-bars`, driven by `.k-card:hover &`, gated `(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)`; `will-change` only inside the hover rule; header comment updated | **Task A — owner decision "option 2".** The loops were unconditional `animation: … infinite` in `globals.css` (2 extra ambient loops next to the one permitted glow). Now inert at rest, hover-only, pointer-fine only, and owned by the motion layer. Compiled against the installed Tailwind 4.3.3 `compile()` before editing: emits `.k-card:hover .k-ico-bars rect {…}` and the nested `.k-card:hover &` rule (MEASURED). |
| `src/app/globals.css` | Removed the `k-ico-*` keyframes, rules and the `prefers-reduced-motion: reduce` override | Same — one motion system; `globals.css` again defines nothing animated (its own header comment said so and was wrong). |
| `src/app/(public)/(site)/page.tsx` | (a) root wrapper `bg-background` → `overflow-x-clip bg-background`; (b) the mockup's `@starting-style` entrance classes moved from the inner card `<div>` to its `ParallaxLayer` | (a) **Horizontal overflow (INFERRED from CSS overflow semantics):** the hero's `before:` wash is `absolute inset-0` and `motion-safe:before:animate-k-glow-drift` scales it to `1.08` (`motion.css` `k-glow-drift`). A transformed absolutely-positioned box extends the *scrollable* overflow of the root scroller (unlike blur/shadow ink). The section is `max-w-6xl` (1152px) with no clip, so on every viewport narrower than ≈1244px the page gains a horizontal scroll of up to 4% of the hero width (≈15px at 375px, ≈31px at 768px), oscillating over the 14s loop. `overflow-x: clip` does not create a scroll container, so the `view()` reveal timelines and the sticky header keep working (clipping the *section* would have cut the blurred blob visibly on desktop — hence the wrapper). (b) **Double entrance (INFERRED from React + CSS semantics):** `TiltCard` uses `useSyncExternalStore` with a `false` server snapshot; after hydration on a pointer-fine device the snapshot becomes `true`, React re-renders and the root switches from `<div>` to `<Tilt>` — a different element type — so the children **remount**, and a `@starting-style` entrance on the remounted card replays (fade-in twice on every desktop load). The `ParallaxLayer` (`m.div`) persists across that switch; motion only writes `transform` on it, so the CSS `opacity`/`translate` transition is untouched. |
| `src/components/motion/tilt-card.tsx` | `fallbackClassName` also applied to the `<Tilt>` wrapper; caller contract documented | react-parallax-tilt 1.7 (`dist/modern/index.js`, read) applies `tiltAngleYInitial` from `componentDidMount → mainLoop → requestAnimationFrame(renderFrame)` — one frame after mount the wrapper is at 0°. With the CSS class on the wrapper too, that frame is already at −6°; Tilt's inline `transform` then overrides it (MEASURED in the library source; visibility of the frame is INFERRED). |
| `src/app/(public)/ty/[token]/thankyou-landing.tsx` | Entrance moved to a wrapper `<div>` outside `TiltCard` (inside a `perspective-distant` div so the 6° starting tilt keeps its depth) | Same remount replay as the homepage mockup, on desktop only (phones never switch branches). Visual-only; no data/props changed. |
| `src/components/landing-mobile-nav.tsx` | Hamburger `Button size="icon"` gets `size-11` | `ui/button` `icon` = `size-8` = **32px** (MEASURED). It is the only route into the nav on phones (`hidden md:flex` elsewhere). `cn()` lets `size-11` win. |
| `src/components/landing-user-menu.tsx` | Avatar trigger gets `size-11` | Same 32px `icon` size; the only account control in the public header for signed-in visitors. The 32px avatar stays centred inside a 44px hit area. |
| `src/components/landing-header-nav.tsx` | Nav links `cn(navigationMenuTriggerStyle(), 'min-h-11')` | `navigationMenuTriggerStyle` is `h-9` = **36px** (MEASURED). The nav is visible from `md` (768px), i.e. on touch tablets. `min-height` beats `height`, so the pill grows to 44px inside the 64px header. Layout-only override, consistent with the shadcn rule stated in the file. |
| `src/components/site/site-header.tsx` | כניסה link `min-h-10` → `min-h-11`; signup CTA `cn(siteCta({ size: 'sm' }), 'min-h-11')`; `cn` import | Both were 40px (`min-h-10`) and visible on tablets. `cn()` (tailwind-merge) drops the `sm` size's `min-h-10` so no two `min-h-*` compete by CSS order. |
| `src/components/add-to-calendar.tsx` | `LINK_CLASS` gets `min-h-11` | The three calendar links are standalone tap targets (a row of controls, not inline prose) on `/r` (success box) and `/g` (back face) — the most phone-heavy pages. Only those two files import it (MEASURED via grep after reading). |
| `src/app/(public)/(site)/cookies/page.tsx` | §7 `ManageCookiesButton` gets `inline-flex min-h-11 items-center` | Alone in its paragraph = a standalone control (20px tall). The inline mention on `/privacy` is prose and stays. |
| `src/app/(public)/(site)/_legal.tsx` | `LegalShell` root `<div>` → `<main>` | `/privacy` `/terms` `/cookies` were the only public pages without a `main` landmark (every other page renders its own `<main>`; the (site) layout renders none). Same classes, no layout change. |
| `src/app/motion.css` (2nd change) + `page.tsx` hero | `@custom-variant pointer-fine-hover (@media (hover: hover) and (pointer: fine))`; hero wash `motion-safe:before:animate-k-glow-drift` → `motion-safe:pointer-fine-hover:before:animate-k-glow-drift` | **Owner (battery):** the one ambient loop ran on touch devices for as long as the tab was open. Now it runs only for hover-capable fine pointers; phones and tablets get the static glow. Compiled with the installed 4.3.3 `compile()` before editing: emits the utility inside a nested `@media (hover: hover) and (pointer: fine)` under the reduced-motion block, keyframes still emitted (MEASURED). |
| `src/app/(public)/(site)/contact/inquiry-forms.tsx` | `FIELD_CLS` (`min-h-11 text-base md:text-base`) on 5 `Input`s + 2 `Textarea`s; `SELECT_CLS` → `min-h-11`, 16px at all widths; both submits `SubmitButton size="lg" className="min-h-11"` | Live-beta measurement by the team lead: 32px inputs/select, 40px submit at every viewport. Same bar as `/r`. Primitives untouched. |
| `docs/design/public-pages-motion-spec.md` | §1 new row (hover-only icon loops) + ambient row gated; §3 rows for the icons and the hero glow rewritten with the owner decisions; §9 TiltCard caller contract | Spec kept in step with the code. |

Not changed on purpose (each is an owner or shared-primitive decision — see §4).

## 2. Matrix — page × platform

Legend: **OK** = no issue found in the code · **fixed** = changed in this review (§1) · **check** = cannot be
proven from code, listed in §5 · **note** = known limitation, not changed (§4).

Platforms: **P** phones 320–430 (iOS Safari incl. dynamic toolbar, Android Chrome, WhatsApp in-app) ·
**T** tablets 768–1024 portrait/landscape · **D** desktop 1280–1920 · **U** ultra-wide ≥2560 ·
**Ptr** pointer-fine vs touch · **RTL** direction / bidi · **RM** reduced motion.

| Page / component | P | T | D | U | Ptr | RTL | RM | Notes (file:line refer to the current tree) |
|---|---|---|---|---|---|---|---|---|
| Root layout `src/app/layout.tsx` | OK | OK | OK | OK | — | OK | — | `html lang="he" dir="rtl"`, `h-full`, Heebo `display: swap` via next/font (size-adjusted fallback → negligible CLS). **No `viewport` export** → the meta tag has no `viewport-fit=cover`, so `env(safe-area-inset-*)` is 0 and the browser keeps every fixed element inside the safe area by itself (note, see §4.1). |
| `(site)/layout.tsx` | OK | OK | OK | OK | — | OK | — | header → children → footer → GA (consent) → widget (config-gated). No `<main>` here; every page provides one (legal pages now do too — fixed). |
| `SiteHeader` (`site-header.tsx`) | **fixed** (hamburger 32→44) | **check** (768–~860 fit) + **fixed** (36/40→44px controls) | OK | OK | n/a | OK (`justify-between`: wordmark at start=right, actions at end=left; `ArrowLeft` = forward) | OK (`k-scroll-shadow` in `@media no-preference`) | Sticky `top-0 z-50 h-16`, `bg-background/85 backdrop-blur`. **Width budget at 768px (INFERRED, font metrics estimated):** wordmark ≈85 + 5 nav pills ≈480 + כניסה ≈45 + CTA ≈120 + padding 48 + gaps ≈ 790px > 768 — the row may overflow or crowd on iPad portrait until ~860px. Flex items do not shrink below their text, so this would widen the document (horizontal scroll) rather than wrap. Needs a browser measurement (§5.1); the remedy, if confirmed, is a design call (e.g. `lg:flex` for the nav or dropping כניסה below `lg`). |
| `LandingHeaderNav` | n/a (hidden < md) | **fixed** (36→44px) | OK | OK | OK | OK (inline Base UI root, `DirectionProvider` at root) | — | Absolute hrefs; `active` only for routed pages. |
| `LandingMobileNav` (drawer) | OK / **note** (close button 28px) | OK | n/a | n/a | touch | OK (`side="right"` = inline-start in RTL; `rtl:` translate variants; close at `end-3`) | OK (Sheet transitions only) | Rows `min-h-11`; `w-3/4 sm:max-w-sm`; brand row `h-16` matches header. The shared `ui/sheet` close button is `size="icon-sm"` = 28px (§4.3). |
| `LandingUserMenu` | **fixed** (32→44) | fixed | OK | OK | OK | OK (own `DirectionProvider`, `align="end"`) | — | Menu `w-56`; name `truncate`. |
| `SiteFooter` | OK | OK | OK | OK | — | OK (no physical classes — pinned by `site-footer.test.ts`) | — | `pb-24 sm:pb-10` when the widget is mounted; links `min-h-11 flex-wrap`. |
| `siteCta` | OK (`min-h-11/12/13`) | OK | OK | OK | OK | OK | OK (`motion-safe:` lift/press) | `sm` = `min-h-10` (40px) — only used in the header, overridden there now. |
| Call-me-now widget (config-gated) | OK / note | OK | OK | OK | — | OK (`end-4`, own `DirectionProvider`) | — | `fixed bottom-4 end-4 z-40`, panel `w-80 max-w-[calc(100vw-2rem)]`. No safe-area padding, but see §4.1 (not needed while `viewport-fit` is not `cover`). Below the header's `z-50`; the cookie banner (own z-index) paints above both. |
| **Home `/`** hero | **fixed** (h-scroll; glow loop now static on touch) | fixed | OK (≥1244 no overflow before either) | OK | **fixed** (glow loop `k-glow-drift` gated `pointer-fine-hover:` = `@media (hover: hover) and (pointer: fine)` — owner: battery on phones; TiltCard static on touch; tilt + glare on fine pointer; `gyroscope={false}`) | OK (`bg-radial-[at_top_end]`, blob `end-0`, `restAngleY=-6` faces the headline) | OK (`motion-safe:` everywhere; islands `useReducedMotion`) | `py-10 sm:py-20`; `text-hero` = 36px at 320 (clamp floor) → "אישורי הגעה," fits 272px; `text-balance` on h1. **HeroParallax:** `offset ['start start','end start']`, clamped 0–1; at load the hero top sits 64px below the viewport top → progress < 0 → clamped 0 (no initial offset). Short landscape viewports: layers move −16/−40/+48px over the hero's scroll-out — scroll-linked, never hijacking. `ParallaxLayer` blob `+48` lags downward and can peek under the next section (no background) — cosmetic (§5.6). |
| Home dashboard mockup | OK (`@container/preview`: header row stacks <20rem, stats step down <22rem — a 320px phone gives the card 272px = 17rem) | OK | **fixed** (double entrance) | OK | OK | OK (progress bar `flex` fills from the right; `tabular-nums`; `14.06.2026` = EN CS EN → one LTR run) | OK | Stat tiles at 272px: (272−24)/3 = 82px each, `text-xl` "248" ≈36px wide → fits. |
| Home problem / solution | OK | OK | OK | OK | OK | OK | OK (`k-reveal*` inside `@supports` + `no-preference`; rest = visible) | `lg:grid-cols-2`; dark panel `p-7`. |
| Home features grid (+ Task A icons) | OK (1 col) | OK (`sm:grid-cols-2`) | OK (`lg:grid-cols-3`) | OK | **fixed** (loops hover-only; touch = inert) | OK | **fixed** (loops inert under RM) | `TiltCard` wraps each `k-card`; `k-reveal-group` staggers the *wrapper* (fine — reveal owns `opacity`/`translate`, Tilt owns `transform`). Hover = Tilt (5°) **and** `k-card` lift: two transforms on two elements — legal, but see §5.7 for feel. CTA tile `siteCta md w-fit`. |
| Home how-it-works / trust | OK | OK | OK (`lg:grid-cols-3` / `-4`) | OK | OK | OK | OK | `scroll-mt-16` = header height; the sections' `py-16` gives the visual breathing room. |
| Home audiences | OK (`grid-cols-2`: 130px tiles at 320 → "אירועים משפחתיים" wraps to 2 lines inside `min-h-11 py-4`) | OK (`sm:grid-cols-3`) | OK | OK | OK | OK | OK | Link tiles carry the focus outline; the two non-link tiles keep the same box. |
| Home closing band | OK (208px inner at 320: xl CTA ≈194px fits; `flex-wrap`) | OK | OK | OK | OK (`k-sheen` hover only) | OK (`bg-radial-[at_top_start]`) | OK | `overflow-hidden` clips the `k-sheen ::after` (`inset:-40%`) — correct. `h2 text-3xl sm:text-5xl` is the one non-fluid heading (note, not a bug). |
| `EventTypePage` (`/wedding` `/bar-mitzva` `/brit` `/event`) | OK | OK | OK | OK | OK (`k-card` hover only on `hover:hover`) | OK | OK | Static wash (no `k-glow-drift`) → no overflow. `text-title` fluid 36→48; `max-w-3xl text-balance`; timing `<ol>` `k-reveal-group`; FAQ expanded, no accordion. Hero copy sits in a bare `<div>` (upgrade doc P3 #6). |
| `/whatsapp` | OK | OK | OK | OK | OK | OK | OK | Rules panel `p-8 sm:p-10`, `ul sm:grid-cols-2`. |
| `/guest-list-template` | OK (table in `overflow-x-auto` + `min-w-[32rem]`, scrolls inside its box — body never scrolls horizontally) | OK | OK | OK | OK | OK (`text-start` headers; sample phones wrapped in LRM marks in the copy) | OK | The download `<a>` is a plain link (works without JS). The scroll box has no `tabindex`, so keyboard-only users cannot scroll it — WCAG note (§4.5). |
| `/faq` | OK | OK | OK | OK | OK | OK | OK | Chips `min-h-11`; sections `scroll-mt-20`; `main max-w-3xl px-4 sm:px-6`. Price card untouched (owner-approved exception). |
| `/contact` + `inquiry-forms.tsx` | **fixed** (32/40px → 44px, 16px text) | fixed | fixed | fixed | OK | OK (`dir="ltr"` on email/phone; `@md/form:grid-cols-2` reacts to the card width) | OK | **Live-beta measurement (team lead, headless Chromium, 5 viewports):** text inputs and the select 32px, submit 40px at every viewport. Fixed via a local `FIELD_CLS = 'min-h-11 text-base md:text-base'` on every `Input`/`Textarea` (merged by the primitives' `cn()`; `ui/input` has no size variant), `SELECT_CLS` `h-8`→`min-h-11` / `text-base` at all widths, `SubmitButton size="lg" className="min-h-11"` (the `lg` size is `h-11 md:h-9`, so min-height keeps 44px on md+). The two 16px radios sit inside `<label>` chips that are `min-h-11` — the chip is the target (MEASURED in the markup: the `<input>` is a child of the `<label>`). Honeypot clipped. |
| `/privacy` `/terms` `/cookies` (`_legal.tsx`) | OK + **fixed** (`<main>`, §7 button 44px) | OK | OK | OK | — | OK (`ArrowRight` = back in RTL; `ps-5` lists; `span dir="ltr"` on cookie names; phone/email runs resolve LTR by bidi rules) | — | `max-w-3xl`; `CategoryStatusBadge` inside a `flex-wrap` h2. |
| `(site)/error.tsx`, `(public)/error.tsx` | note | note | OK | OK | — | OK | — | Buttons `px-4 py-2 text-sm` ≈36px (upgrade doc P3 #4 — `buttonVariants` sweep). |
| `(public)/loading.tsx` | OK | OK | OK | OK | — | OK | note | `min-h-dvh` skeleton; `animate-pulse` is not `motion-safe:`-guarded (a skeleton pulse, upgrade doc P3 #5 territory). |
| `GuestShell` | OK / note | OK | OK | OK | — | OK | — | `min-h-svh` (smallest viewport → no jump when the iOS/WhatsApp toolbar collapses; content ≥ small viewport, brand line pinned to the small-viewport bottom). `max-w-md` for `/r`, `max-w-lg` otherwise, `px-4 py-10`. Brand line link is `text-xs` with no 44px target (§4.6). |
| **`/r/[token]`** `RsvpForm` | OK + **fixed** (calendar links 44px) | OK | OK | OK | OK (`touch-manipulation` on toggles/steppers) | OK (Waze link; `, ` venue join is bidi-neutral; h1 `flex` + `text-balance` works on the anonymous text item) | OK (`motion-safe:` press / mount / pop; alerts static) | Form width at 320 = 288px = 18rem → the 3 status buttons **stack** (`@[20rem]:grid-cols-3`); at 375 = 343px → 3 columns of ≈107px, "לא מגיע/ה" at 16px ≈94px incl. padding — fits. Steppers: 2 × ((288−16)/2 = 136px) each holding 44+32+44 = 120px → fits. All fields `min-h-11 text-base` (no iOS zoom). `Image 448×560 h-auto w-full` reserves its box (no CLS). h1 has no `break-words` unlike `/g` `/ty` (§4.7). |
| **`/g/[token]`** `GiftLanding` + `FlipCard` | OK | OK | OK | OK | touch: toggles only; auto-flip 1.4s (spec) | OK (rotateY 180° ends identically) | OK (`MotionConfig reducedMotion="user"` → no auto-flip, instant swap) | Faces share one grid cell → height = taller face, no shift on flip. SSR has no `inert`/`aria-hidden` (pinned by `flip-card.test.ts`). CTA `min-h-12` outside the card. 3D at 45° with `perspective-distant` (1200px) stays inside the card's half-width (≈198 < 240px) → no overflow. **Safari:** `backface-hidden` + `overflow-hidden rounded-2xl` on a 3D-transformed face is a known corner/flicker risk (§5.4). |
| **`/ty/[token]`** `ThankyouLanding` | OK | OK | **fixed** (double entrance) | OK | OK (static on touch) | OK | OK | Wrapper order now: `perspective-distant` → entrance div → `TiltCard` → card. |
| `/rate/[token]` `RatingForm` | OK (3 × 64px + gaps = 208px inside `max-w-sm`) | OK | OK | OK | OK (`touch-manipulation`) | OK | OK | `selected → scale-110` on `transform`; `✓` badge `size-11`. |
| `/join/[token]` | OK | OK | OK | OK | — | OK | — | Own `main min-h-svh max-w-md`; `SubmitButton size="lg"` (44px). |
| Cookie banner (vanilla-cookieconsent) | OK / note | OK | OK | OK | — | OK (`language.rtl: 'he'`) | — | Library-owned fixed box; theme vars mapped in `globals.css`. Safe-area: §4.1. |
| Fluid type (`--text-hero/title/display`) | OK (floors 36/36/30px at 320) | OK (≈48px hero at 768) | OK (caps 60/48/36 from ≈1024/1080/1024px) | OK (capped — no runaway on 2560) | — | — | — | Endpoints = the old breakpoint sizes (MEASURED in `globals.css`). |
| Container vs viewport queries | OK | OK | OK | OK | — | — | — | `@container/preview` (mockup) and `@container/form` (`/contact`) react to their box; the `/r` form's unnamed `@container` to the form. No container query sits inside another container's breakpoint in a way that could fight a viewport breakpoint (the grids around them are viewport-driven, the internals container-driven). |
| Islands' static fallbacks | OK | OK | fixed | OK | OK | OK | OK | TiltCard: SSR = plain div (both hooks `false` on the server) → **remount on desktop** (now harmless: entrances moved out). FlipCard: SSR = front face, no `inert`. HeroParallax: SSR `y: 0`; reduced motion → `0`. |

## 3. Cross-cutting checks

- **Horizontal overflow:** the only transformed box that could widen the document was the animated hero
  wash (fixed with `overflow-x-clip` on the homepage wrapper). Every other transform is either inside an
  `overflow-hidden` band (`k-sheen`), inside the section padding (`k-card` rotateX ≈+1.5px; Tilt ±7°
  + scale 1.02 ≈ +13px on a 550px card, inside `px-6` = 24px), or vertical only (parallax, reveals).
  Blur/shadow ink (`blur-3xl` blob, `shadow-xl`) never contributes to scrollable overflow.
  `/guest-list-template`'s table scrolls inside its own `overflow-x-auto` box. No physical
  `left/right`, `ml/mr`, `pl/pr`, `text-left/right` class exists in any file read (the footer test
  pins this for the footer; the `ui/sheet` `right-0/left-0` are the shadcn primitive's `data-side`
  physical anchors, consumed through `DirectionProvider` per the established project pattern).
- **Long Hebrew words:** headings use `text-balance`, leads `text-pretty`; `/g` and `/ty` add
  `break-words` on guest-facing DB text (event name, venue). `/r`'s h1 does not (§4.7).
- **Sticky header + anchors:** `scroll-mt-16` (home sections) and `scroll-mt-20` (`/faq`, `/contact`)
  clear the 64px header. The drawer's `SheetHeader h-16` mirrors it.
- **Fixed bottom elements vs safe-area:** none of the fixed elements (widget, cookie banner) pad for
  `env(safe-area-inset-bottom)`, and none needs to while the viewport meta is not `viewport-fit=cover`
  (§4.1). There is no sticky action bar on any token page.
- **44px targets:** every standalone control on every public page is now ≥44px except the shared-primitive
  cases in §4 (`ui/input` 32px fields, `ui/sheet` 28px close, `error.tsx` 36px buttons, the brand line).
- **Focus visibility:** all touched controls carry `focus-visible:outline-2 outline-offset-2 outline-ring`
  (white/70 on dark surfaces); `outline-none` is not used on links; the calendar links keep the UA ring
  (`* { outline-ring/50 }` in `@layer base` only sets the colour).
- **Layout shift:** every `next/image` has width/height; islands wrap the same children (no size change);
  the TiltCard remount re-inserts identical markup at the same size (opacity/translate only, now on a
  persistent ancestor). Heebo via next/font with automatic fallback metrics.
- **Reduced motion:** every animation in `motion.css` is inside `prefers-reduced-motion: no-preference`;
  every markup animation is behind `motion-safe:`; the islands read `useReducedMotion` live. The one
  unguarded animation left is `animate-pulse` on the token-page skeleton.

## 4. Known limitations — deliberately not changed

1. **Safe-area / `viewport-fit`.** `src/app/layout.tsx` exports no `viewport`, so the meta tag lacks
   `viewport-fit=cover`; `env(safe-area-inset-bottom)` is 0 and iOS keeps fixed elements out of the
   home-indicator area on its own. This is *correct today*. It becomes a bug only if someone adds
   `viewportFit: 'cover'` (root-level, affects app/admin) — then the widget, the cookie banner and any
   future sticky bar need `pb-[env(safe-area-inset-bottom)]`. Recorded in the upgrade doc §3.1 too.
2. **Header width at 768–~860px** — needs measurement (§5.1); the fix is a design decision.
3. **`ui/sheet` close button = 28px** (`size="icon-sm"`) in the mobile drawer. Shared primitive; the
   backdrop tap and Escape also close the drawer. Changing it means `showCloseButton={false}` + a local
   44px `SheetClose` in the drawer header, or changing the primitive for the whole app.
4. ~~`/contact` fields = 32px~~ — **fixed after the live-beta measurement** (see §1 / §2): the override is
   local to `inquiry-forms.tsx`; the shared `ui/input` / `ui/textarea` / `ui/button` primitives are
   unchanged, so the app's own forms keep their compact sizing.
5. **Table scroll box without `tabindex="0"`** on `/guest-list-template`: keyboard-only users cannot
   scroll it horizontally on narrow viewports. Adding `tabIndex={0}` + an `aria-label` is a one-line a11y
   change; left for the owner because it adds a tab stop to the page.
6. **Brand line link** in `GuestShell` (`text-xs`, ~16px tall). It is a signature, not a control; making
   it 44px tall would change the guest pages' bottom rhythm. Left as is.
7. **`/r` h1 has no `break-words`** (`/g` and `/ty` do). An unbreakable event name longer than ~18rem could
   overflow the 288px form on a 320px phone. Hebrew event names are short in practice; adding
   `break-words` is safe if the owner wants parity.
8. **`(site)/error.tsx` / `(public)/error.tsx` buttons ≈36px** and **`loading.tsx` `animate-pulse`
   unguarded** — already listed as P3 #4/#5 in the upgrade doc.
9. **Closing band h2 `text-3xl sm:text-5xl`** is the one heading still on a breakpoint jump (the fluid
   tokens cover hero/title/display only). Cosmetic consistency; not a layout defect.
10. **Two hover transforms on the feature cards** (Tilt 5° on the wrapper + `k-card` 4px lift/1.5°
    rotateX on the card). Legal and separate, but the combined feel is a taste call (§5.7).

## 5. Browser checks (cannot be proven from the code)

Run on live beta after deploy. Chrome DevTools device toolbar is enough for 1–3 and 5–9; 4 needs a
real iPhone (Safari and the WhatsApp in-app browser).

1. **Header row fit — ~~768×1024~~ (MEASURED live 2026-09-08: fits, no overflow), still open at 800–860px
   (820×1180 iPad Air portrait):** `/`, anonymous. Look for the nav pills, כניסה and צרו אירוע wrapping,
   overlapping the wordmark, or `document.documentElement.scrollWidth > innerWidth`. The INFERRED width
   budget (≈790px) was pessimistic — Heebo runs narrower than the estimate.
2. **Homepage horizontal scroll (regression check of the fix) — 375×812, 390×844, 430×932, 768×1024,
   1024×768, 1280×800:** motion enabled, wait 7–14s (the glow scale peaks at 1.08), `scrollWidth` must
   equal `innerWidth`; swipe sideways — nothing moves. Also confirm the blurred blob and the wash show no
   hard edge on desktop (the clip is at the viewport, not the section).
3. **Mockup entrance once — desktop 1440×900 with a mouse:** reload `/`; the dashboard card must fade in
   exactly once and never flash at 0° before settling at −6°. Then hover it (tilt + glare) and move away
   (600ms return to −6°).
4. **iOS Safari + WhatsApp in-app (iPhone 320/375/390 widths):** `/r/<token>` — fields do not zoom on
   focus; 3 answer buttons in one row at 375, stacked at 320; brand line pinned above the toolbar with no
   jump when the toolbar collapses (`svh`). `/g/<token>` — card flips after 1.4s without corner glitches
   or flicker (`backface-visibility` + `overflow-hidden` + radius on a 3D face is a Safari-specific risk);
   the CTA is tappable before the page finishes loading. Older iOS (≤17.4): no `@starting-style` → content
   simply appears at rest (expected).
5. **Icon loops (Task A) — desktop with a mouse:** hover feature card 04 (pulse + ring) and 07 (bars);
   leave → both stop within ~0.3s; at rest nothing moves. iPad (touch) and with "Emulate CSS
   prefers-reduced-motion: reduce": nothing moves even while hovering.
6. **Hero blob under the next section — 375 and 1440:** scroll the hero out slowly; the lagging
   primary/10 blob may show through the problem/solution section's white background. Decide whether to
   keep it.
7. **Feature-card hover feel — desktop:** Tilt (5°) plus `k-card` lift together — accept or reduce one.
8. **Tablet touch targets after the fix — iPad 1024×768 landscape:** nav pills 44px tall, כניסה and צרו
   אירוע 44px, no visible misalignment in the 64px header.
9. **Reduced motion sweep — any desktop:** with the emulation on, load `/`, `/wedding`, `/faq`,
   `/r/<token>`, `/g/<token>`, `/ty/<token>`: nothing fades, slides, tilts, flips automatically or
   pulses.
10. **Hebrew wrapping at 320×568:** hero h1 breaks as "אישורי הגעה," / "במקום אחד." (`<br>`) with no third
    line; audience tiles wrap to two lines cleanly; `/guest-list-template` `text-title` h1 fits.
11. **Ultra-wide 2560×1440:** everything centred in `max-w-6xl`; the trust and footer bands full-bleed;
    the hero blob stays inside the hero column; no horizontal scroll.
12. **Footer + widget — 360×740 with the widget enabled:** the last footer row (ניהול עוגיות) is not under
    the floating button (`pb-24`).

## 6. Gates (run sequentially on 2026-09-08, this tree)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | pass, 0 errors |
| `npm run lint` (`eslint`) | pass, 0 errors, 0 warnings |
| `npx vitest run src/components "src/app/(public)" src/lib/data/event-theme.test.ts` | 16 files, 81 tests, all passed |
| `npm run build` (`NEXT_DIST_DIR=.next-verify next build --webpack`, single run, `pgrep -f "next build"` empty beforehand) | pass, exit 0, 0 warning lines and 0 error lines in the build log (run twice: once after the Task A/B edits, once more after the `/contact` + `k-glow-drift` additions — both exit 0). Built CSS contains `.k-card:hover .k-ico-pulse{will-change:…;animation:k-ico-pulse 1.8s ease-out infinite}`, `.k-card:hover .k-ico-bars rect{animation:k-bar …}`, no rest-state `k-ico-*` animation, `overflow-x:clip`, and the glow utility inside `@media (hover:hover) and (pointer:fine)` (MEASURED) |

All four gates were re-run after the two later additions (`/contact` sizing, `pointer-fine-hover` gate on the
glow): tsc 0 errors · eslint 0 errors / 0 warnings · vitest 16 files / 81 tests passed · build exit 0.

**Live-beta measurements by the team lead (headless Chromium, 2026-09-08), folded back in:** no horizontal
overflow on 25 viewport × page combinations before and after the deploy; h1 visible ≤ 552ms after load
everywhere; homepage h1 = 36px @320–390, 47px @768, 54.7px @1024, 60px @1440 (matches the clamp); at
768×1024 the header fits (`scrollWidth === clientWidth`) — §5.1 is answered for 768, 800–860 untested;
`/contact` controls measured 32/32/40px → fixed above.

Compile check for the new utilities (before editing): the Tailwind 4.3.3 `compile()` API over the
proposed `@utility` bodies emitted `.k-card:hover .k-ico-bars rect {…}`, the nested `.k-card:hover &`
pulse rule, both `@keyframes`, and `.overflow-x-clip { overflow-x: clip }` (MEASURED).
