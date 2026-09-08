# Tailwind v4.3 motion & effects cheat sheet (KALFA)

> Copy-ready, **verified** reference for animation, 3D, and visual-effect utilities
> as they exist in the installed stack. Written 2026-09-08.
>
> **Installed (package.json / node_modules):** `tailwindcss 4.3.3`, `tw-animate-css 1.4.0`,
> `@tailwindcss/postcss ^4`, shadcn `base-nova` on `@base-ui/react 1.6`.
>
> **Verification method.** Every class listed below was compiled through the installed
> `@tailwindcss/node` `compile()` against the real `src/app/globals.css` + `src/app/motion.css`
> (script: scratch `verify-classes.mjs`, 92/93 candidates emitted CSS; the 93rd, `group`, is a
> marker class that emits nothing by design). Doc sources are the official docs fetched via
> Context7 (`/tailwindlabs/tailwindcss.com`) and the package sources named per row. Tags:
> **MEASURED** = seen in compiled output / package source; **DOCS** = official docs only.

---

## 0. What Tailwind 4.3 can and cannot do natively

| Capability | Native? | How |
| --- | --- | --- |
| Keyframe animations, custom `animate-*` | ✅ | `@theme { --animate-x: x 1s …; @keyframes x {…} }` → `animate-x` (MEASURED) |
| Enter/exit composition (`animate-in fade-in zoom-in-95 slide-in-from-start-4`) | ✅ via **tw-animate-css** | `dist/tw-animate.css` (MEASURED) |
| Logical-direction slides (`slide-in-from-start/end`) | ✅ via tw-animate-css | `:dir(rtl)`/`[dir="rtl"]`-aware `@utility` (MEASURED) |
| `@starting-style` entrances | ✅ | `starting:` variant (MEASURED) |
| `transition-behavior: allow-discrete` | ✅ | `transition-discrete` (MEASURED) |
| 3D transforms | ✅ | `perspective-*`, `perspective-origin-*`, `transform-3d`, `rotate-x/y/z-*`, `translate-z-*`, `backface-hidden` (MEASURED) |
| Masks | ✅ | `mask-linear-*`, `mask-t/r/b/l-from-*`, `mask-radial-*`, `mask-conic-*`, composite/mode/size (MEASURED) |
| Text shadow | ✅ | `text-shadow-2xs…lg`, `text-shadow-<color>` (MEASURED, theme.css) |
| Drop shadow / backdrop filters / inset shadow / inset ring | ✅ | `drop-shadow-*`, `backdrop-blur-*`, `backdrop-saturate-*`, `inset-shadow-*`, `inset-ring-*` (MEASURED) |
| Gradients: linear/radial/conic + interpolation | ✅ | `bg-linear-to-*`, `bg-linear-<angle>`, `bg-radial`, `bg-conic-<angle>`, `/oklch` `/srgb` `/hsl` `/oklab` `/longer` `/shorter` `/increasing` `/decreasing` (MEASURED) |
| `motion-safe:` / `motion-reduce:` variants | ✅ | `@media (prefers-reduced-motion: no-preference \| reduce)` (MEASURED) |
| `pointer-fine:` / `pointer-coarse:` / `any-pointer-*` variants | ✅ | (MEASURED in `dist/lib.js`) |
| `supports-[…]:` arbitrary variant | ✅ | `supports-[animation-timeline:view()]:…` (MEASURED) |
| `@utility`, functional `@utility x-*` with `--value()` / `--default()` | ✅ | (MEASURED; `--default()` DOCS, v4.3 blog) |
| `@custom-variant` | ✅ | `@custom-variant dark (&:is(.dark *));` already in globals.css |
| `@property` (registered custom properties) | ✅ pass-through | Tailwind emits its own `@property --tw-*` rules (103 in compiled output, MEASURED); author `@property` in CSS is preserved |
| **Scroll-driven animations** (`animation-timeline: scroll()/view()`, `animation-range`) | ❌ **no utilities** | grep of `dist/lib.js` for `animation-timeline`/`scroll-timeline`/`view-timeline` = 0 hits (MEASURED). Add via `@utility` + `@supports` — see §7 / `src/app/motion.css` |
| Pointer-tracking 3D tilt | ❌ CSS cannot read pointer position | JS only; KALFA uses a static perspective tilt instead |

---

## 1. Animation utilities & custom keyframes

**Built-ins** (theme.css, MEASURED): `animate-spin` · `animate-ping` · `animate-pulse` · `animate-bounce` · `animate-none`.

**Custom** (docs: theme.mdx "Defining animation keyframes"):

```css
@theme {
  --animate-k-pop: k-pop 480ms var(--ease-k-spring) both; /* → class `animate-k-pop` */
  @keyframes k-pop { 0% { opacity: 0; scale: .6 } 60% { scale: 1.06 } 100% { opacity: 1; scale: 1 } }
}
```

Gotchas (MEASURED):
- `@keyframes` **inside** `@theme` are emitted only when the linked `--animate-*` var is used; keyframes that
  an `@utility` refers to must sit **outside** `@theme`.
- `animate-k-pop` emits `animation: var(--animate-k-pop)` — a shorthand, so combine it with
  `k-delay-*` (below) rather than tw-animate's `delay-*` if you also transition the element.
- `--ease-*` theme tokens become `ease-*` utilities that also set `--tw-ease`, so a theme easing works
  for both transitions and tw-animate animations: `ease-k-out` → `--tw-ease: var(--ease-k-out); transition-timing-function: …`.

**tw-animate-css 1.4.0** (README + `dist/tw-animate.css`, MEASURED):

| Class | Effect |
| --- | --- |
| `animate-in` / `animate-out` | base; duration = `var(--tw-animation-duration, var(--tw-duration, .15s))`, easing = `var(--tw-ease, ease)` — so Tailwind's `duration-300` / `ease-k-out` drive it |
| `fade-in[-<n>]` / `fade-out[-<n>]` | from/to opacity (`fade-in-0` = 0) |
| `zoom-in[-<n>]` / `zoom-out[-<n>]` | from/to scale3d (`zoom-in-95`) |
| `spin-in[-<deg>]` / `spin-out` | rotation |
| `blur-in[-<px>]` / `blur-out` | filter blur |
| `slide-in-from-top/bottom-<n>` | vertical, spacing scale |
| **`slide-in-from-start/end-<n>`**, `slide-out-to-start/end-<n>` | **logical** horizontal — `:dir(rtl)` flips sign. Use these, never `left/right` |
| `duration-*`, `ease-*`, `delay-*`, `repeat-*`, `direction-*`, `fill-mode-*`, `running`, `paused` | animation params (tw-animate redefines `delay-*` to set animation-delay) |
| `accordion-down/up`, `collapsible-down/up`, `caret-blink` | ready-made |

Pattern for a mount animation on a React re-render (element newly inserted):
`motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 duration-500 ease-k-out`.

## 2. `@starting-style` and discrete transitions

Docs: hover-focus-and-other-states.mdx "@starting-style"; transition-behavior.mdx.

```html
<!-- Entrance on first render, no JS, nothing hidden at rest: -->
<h1 class="transition-[opacity,translate] duration-700 ease-k-out
           motion-safe:starting:opacity-0 motion-safe:starting:translate-y-3">…</h1>
```

Compiled (MEASURED): `@media (prefers-reduced-motion: no-preference) { @starting-style { .motion-safe\:starting\:translate-y-3 { --tw-translate-y: calc(var(--spacing)*3); translate: … } } }`.

- Variant stacking order in the class = nesting order in CSS (`motion-safe:` outside, `starting:` inside).
- `transition-discrete` → `transition-behavior: allow-discrete` for `display`/`overlay` transitions
  (popover pattern: `transition-discrete starting:open:opacity-0`).
- Tailwind's `transition` property list already includes `transform, translate, scale, rotate, filter,
  display, content-visibility, overlay` (MEASURED) — use the narrow `transition-[opacity,translate]`
  on entrance elements so a colour change does not inherit a 700ms duration.

## 3. 3D transforms

Docs: transform-style.mdx, perspective.mdx, perspective-origin.mdx, rotate.mdx, translate.mdx, backface-visibility.mdx.

| Class | CSS (MEASURED) |
| --- | --- |
| `perspective-dramatic/near/normal/midrange/distant` | `perspective: 100/300/500/800/1200px` (theme.css) |
| `perspective-origin-*` | `perspective-origin: …` |
| `transform-3d` / `transform-flat` | `transform-style: preserve-3d / flat` |
| `rotate-x-<deg>` `rotate-y-<deg>` `rotate-z-<deg>` (+ negative) | `--tw-rotate-y: rotateY(6deg); transform: var(--tw-rotate-x,) var(--tw-rotate-y,) …` |
| `translate-z-<n>` (needs `transform-3d` parent) | `translate: … …` z component |
| `backface-hidden` / `backface-visible` | `backface-visibility` |
| `rtl:-rotate-y-6` / `ltr:rotate-y-6` | direction-aware sign for a mockup that should face the headline |

**Property split (important):** `translate-*`/`scale-*` utilities write the individual `translate`/`scale`
properties; `rotate-x/y/z-*` write `transform`. A running animation (fill-mode `both`) on `translate`
overrides any hover `translate-*` on the same element — keep hover effects on `transform` when the
element also has a scroll-driven reveal (this is why `k-card` exists).

## 4. Masks, shadows, backdrop, rings

| Class | Note (MEASURED) |
| --- | --- |
| `mask-t-from-50%`, `mask-b-from-40%`, `mask-l/r-*` | linear edge masks; composite via `mask-composite: intersect` |
| `mask-linear-<deg>`, `mask-linear-from/to-*` | angled |
| `mask-radial-from-40%`, `mask-radial-at-*`, `mask-circle/ellipse` | radial |
| `mask-conic-*` | conic |
| `text-shadow-2xs/xs/sm/md/lg`, `text-shadow-<color>` | theme.css `--text-shadow-*` |
| `drop-shadow-xs…2xl`, `drop-shadow-<color>` | `filter: drop-shadow(var(--drop-shadow-*))` |
| `shadow-primary/25` | shadow **colour** from a token with opacity — the only "glow" permitted under the colours-out-of-scope ruling |
| `inset-shadow-2xs/xs/sm` | theme.css |
| `inset-ring`, `inset-ring-<n>`, `inset-ring-<color>` | v4 name (was `ring-inset` in v3) |
| `backdrop-blur-*`, `backdrop-saturate-*`, `backdrop-hue-rotate-*` | header already uses `backdrop-blur-md backdrop-saturate-150` |

## 5. Gradients

Docs: background-image.mdx.

| Class | CSS |
| --- | --- |
| `bg-linear-to-r` … `bg-linear-to-bl`, `bg-linear-<angle>` (`bg-linear-135`) | linear |
| `bg-radial`, `bg-radial-[at_top]` | `radial-gradient(var(--tw-gradient-stops))`, default `in oklab` (MEASURED) |
| `bg-conic`, `bg-conic-<angle>` | conic |
| `/srgb` `/hsl` `/oklab` `/oklch` `/longer` `/shorter` `/increasing` `/decreasing` | interpolation modifier, e.g. `bg-linear-135/oklch` |
| `from-primary/10 via-* to-transparent`, `from-40%`, `via-60%` | stops & positions |

Animatable gradient **angle**: not a utility. Native CSS: register `@property --k-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg }`
and use `bg-[conic-gradient(from_var(--k-angle),…)]` + a keyframe on `--k-angle`. Passes through the pipeline
(Tailwind itself emits `@property`). Not used in KALFA (colour tokens only, and it is paint-per-frame).

## 6. Reduced motion, custom variants, custom utilities

- `motion-safe:` = `@media (prefers-reduced-motion: no-preference)`; `motion-reduce:` = `reduce`.
  Prefer `motion-safe:` on the *effect* (one class) over undoing with `motion-reduce:` (docs).
- Hover in v4 is already `@media (hover: hover)`; add `pointer-fine:` for effects that only make sense with a mouse.
- `@custom-variant name (selector-or-@media);` — e.g. `@custom-variant dark (&:is(.dark *));` (globals.css).
- `@utility name { … }` (static) / `@utility name-* { prop: --value(integer|number|[length]|--theme-ns-*) }`
  (functional). Nested `&`, `@media`, `@supports` allowed (MEASURED — `k-reveal-group`, `k-card`).

## 7. Scroll-driven animations (added in `src/app/motion.css`)

Not native in 4.3 (MEASURED). Defined as utilities, each guarded twice
(`@media (prefers-reduced-motion: no-preference)` **and** `@supports (animation-timeline: view())`):

| Utility | What it does | Rest state without support |
| --- | --- | --- |
| `k-reveal` | fade + 1.25rem rise as the element enters the viewport (`animation-range: entry 0% entry 45%`) | fully visible |
| `k-reveal-group` | same on every direct child, with columns 2/3 (`:nth-child(3n+2/3n+3)`) offset for a right→left stagger in RTL | fully visible |
| `k-scroll-shadow` | header `::after` ink shadow whose OPACITY fades to 0.22 over the first 96px of root scroll (`scroll(root block)`) — opacity, not `color-mix()`, because Tailwind wraps `color-mix()` in `@supports` with a solid-colour fallback | no shadow |

Rules: **longhands only** (`animation-name/-timing-function/-fill-mode/-timeline/-range`) — the `animation`
shorthand resets `animation-timeline`; and `fill-mode: both` keeps the animation active, so see the
property-split rule in §3.

Other KALFA utilities in the same file: `k-card` (hover lift + 1.5° perspective tilt on `transform`),
`k-sheen` (CTA highlight on `::after`, z-index −1 inside the band's `isolate`, drifting on hover, `primary-foreground` at 16% opacity), `k-delay-<ms>`
(one delay for both transition and animation), tokens `ease-k-out`, `ease-k-spring`, `animate-k-pop`,
`animate-k-rise`, `animate-k-glow-drift`.

## 8. What the two JS libraries add beyond Tailwind (installed 2026-09-08)

| Need | Tailwind / CSS | `motion@13.2.0` (`motion/react`, `motion/react-m`) | `react-parallax-tilt@1.7.341` |
| --- | --- | --- | --- |
| Pointer-following 3D tilt + glare | ✗ (no pointer position in CSS) | possible with `useMotionValue` + `onPointerMove` (hand-rolled) | ✅ `<Tilt tiltMaxAngleX/Y perspective scale glareEnable glareMaxOpacity glareColor glarePosition glareBorderRadius tiltAngleX/YInitial transitionSpeed transitionEasing gyroscope>` — 2.9 kB, class component (needs a `"use client"` wrapper), appends its glare layer as an absolutely positioned child (give the wrapper `relative`) |
| One scroll progress driving several layers | `animation-timeline: view()/scroll()` per element (no shared value, no live reduced-motion switch) | ✅ `useScroll({ target, offset })` → `scrollYProgress`; `useTransform(v, [0,1], [0, px])`; `useSpring(v, { skipInitialAnimation })` for smoothing | ✗ |
| Spring physics on state change | ✗ (`linear()` easing only approximates) | ✅ `<m.div animate={{ rotateY }} transition={{ type: 'spring', stiffness, damping, mass }}>` | ✗ |
| Reduced motion | `motion-safe:` / `@media` | `useReducedMotion()` (live) · `<MotionConfig reducedMotion="user">` disables transform/layout animations, keeps opacity/colour | ✗ (wrap in the reduced-motion branch yourself) |
| Bundle discipline | 0 kB | `m` from `motion/react-m` + `<LazyMotion features={domAnimation} strict>` instead of `motion.*`; `motion/react-client` for RSC files; hooks import from `motion/react` | 2.9 kB gz |
| RSC | n/a | every file using motion components/hooks is `"use client"` (docs: react-installation) | same |

Rule of thumb applied in KALFA: CSS first (`motion.css`), JS only for the three rows above that are ✗ in CSS.

## 9. Taste rules applied (motion-doctrine skill)

- Single entrance ≤ ~800ms; stagger total ≤ 500ms; no `bounce`/`elastic`; mild overshoot ok (`ease-k-spring`).
- No idle wobble loops. One ambient loop maximum (hero glow, 14s, `motion-safe:` only).
- Similar elements share one ease + duration (`ease-k-out`, 320ms hover / 600–700ms entrance).
- Compositor-only: opacity, translate, scale, rotate/transform. Shadows only transition on hover.
