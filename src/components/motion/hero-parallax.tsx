'use client';

import { createContext, useContext, useRef } from 'react';
import {
  LazyMotion,
  domAnimation,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react';
import * as m from 'motion/react-m';

import { cn } from '@/lib/utils';

// Homepage hero depth parallax (motion 13, `useScroll` + `useTransform`).
// Scroll-LINKED, never scroll-hijacking: each layer's `y` is a pure function
// of how far the hero has scrolled out of the viewport (0 → 1 between "top of
// hero at top of viewport" and "bottom of hero at top of viewport"), so the
// page scrolls exactly as before and layers merely drift at different speeds.
//
// Why JS and not the CSS scroll timelines the rest of the motion layer uses:
// three layers sharing ONE progress source with different multipliers, plus a
// live reduced-motion switch, is what `useScroll`/`useTransform` are for; the
// CSS `view()` reveals stay in motion.css and are not re-implemented here.
//
// `m` + LazyMotion(domAnimation) instead of `motion.*`: the smaller runtime
// (motion.dev/docs/react-reduce-bundle-size). Transform-only (`y`), so no
// layout work per frame; children are the server-rendered hero markup.

const ProgressContext = createContext<MotionValue<number> | null>(null);

export function HeroParallax({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  });
  return (
    <LazyMotion features={domAnimation} strict>
      <ProgressContext.Provider value={scrollYProgress}>
        <div ref={ref} className={className}>
          {children}
        </div>
      </ProgressContext.Provider>
    </LazyMotion>
  );
}

// `depth` = pixels of travel over the hero's scroll-out. Negative = moves
// ahead of the scroll (foreground), positive = lags behind it (background).
export function ParallaxLayer({
  depth,
  children,
  className,
  decorative = false,
}: {
  depth: number;
  children?: React.ReactNode;
  className?: string;
  decorative?: boolean;
}) {
  const progress = useContext(ProgressContext);
  const still = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const y = useTransform(progress ?? still, [0, 1], [0, depth]);
  return (
    <m.div
      className={cn('will-change-transform', className)}
      style={{ y: reduceMotion || progress === null ? 0 : y }}
      aria-hidden={decorative || undefined}
    >
      {children}
    </m.div>
  );
}
