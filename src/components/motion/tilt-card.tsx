'use client';

import { useRef } from 'react';
import Tilt from 'react-parallax-tilt';
import { useInView, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

import { COARSE_POINTER, FINE_POINTER, LG_UP, useMediaQuery } from './use-media-query';

// Pointer-following 3D tilt (react-parallax-tilt 1.7, 2.9 kB) around
// server-rendered children. This is the ONE thing the CSS motion layer
// (src/app/motion.css) cannot do — CSS has no pointer position — so the
// island is deliberately tiny and wraps, never replaces, the existing markup.
//
// Three client branches (motion spec §10), chosen from live media queries:
//   - FINE pointer (mouse / trackpad): cursor tilt + glare + scale, exactly as
//     before.
//   - COARSE pointer (phones, tablets): the library tracks a FINGER natively —
//     the wrapper always carries onTouchStart/Move/End (verified in
//     dist/modern/index.js), and reads the position from `touchmove` only. So a
//     drag tilts the card, a still tap does nothing, and lifting the finger
//     eases back to the resting angle (`reset`, the library default). Smaller
//     angles, no glare layer, no scale (a scale-UP under a finger reads as the
//     opposite of a press), a slightly faster return. The library never calls
//     preventDefault, so page scrolling is untouched.
//   - Otherwise (`pointer: none`, or the user prefers reduced motion): the
//     plain <div> resting state.
// The plain <div> is also what the server renders (every hook reports false
// on the server), so hydration is always consistent and there is no layout
// shift: the Tilt wrapper is a transform-only div around the same children.
//
// GYROSCOPE (`gyroscope` prop, opt-in per instance — the homepage mockup only):
//   - Android only, by construction: iOS 13+ exposes
//     `DeviceOrientationEvent.requestPermission`, and the library calls it at
//     mount, which needs a user gesture and otherwise rejects. When that
//     function exists we never pass `gyroscope` to the library, so no
//     permission dialog can ever appear.
//   - The library maps device angle → tilt angle 1:1, clamped to the max, and
//     feeds `deviceorientation` and `touchmove` into the same loop, where they
//     would alternate frame by frame. One input per instance: the gyro branch
//     is `pointer-events-none` (the mockup is decorative), so no touch handler
//     fires on it, and the finger path is left to the other cards.
//   - The library sets its CSS transition only on enter/leave, which a
//     pointer-less element never gets; `transition-transform duration-300`
//     on the wrapper acts as the low-pass filter for raw sensor frames.
//   - The library reads `gyroscope` ONLY at mount/unmount, so the listener is
//     switched by REMOUNTING the Tilt (`key`) and exists only while the card is
//     in view (`useInView`): off-screen = no sensor listener (owner ruling
//     2026-09-08: no idle work on touch devices — battery).
//
// `restAngleY` is the resting Y rotation (degrees) the card returns to when
// the pointer leaves — the homepage mockup uses -6 in RTL so the preview
// faces the headline; it is applied only from `lg`, where the hero is two
// columns. `restAngleYNarrow` is the same below `lg` (the mockup uses -3).
// `fallbackClassName` carries the CSS equivalent (e.g. `-rotate-y-3
// lg:-rotate-y-6`) for the static branch — and is ALSO put on the Tilt
// wrapper: the library applies its initial angle from a requestAnimationFrame
// after mount, so without the class the card would paint one frame at 0° when
// the branch switches. Once Tilt writes its inline `transform` the class is
// simply overridden.
//
// CALLER CONTRACT: this component swaps element types (<div> → <Tilt>) after
// hydration on pointer-fine AND pointer-coarse devices, which REMOUNTS its
// children (the gyro branch also remounts when the card scrolls in/out of
// view). Any `@starting-style` entrance must therefore sit on an ancestor,
// never on the children or on `className` (it would replay).

const TOUCH_MAX_ANGLE = 5;
const TOUCH_TRANSITION_MS = 400;
// Gyro: a phone held for reading sits at beta ≈ 30–60°, so the X axis is
// pinned at its max (a constant lean-back) — keep it small; the visible life
// is the Y sway from gamma (left/right hand rotation), so give it more room.
const GYRO_MAX_ANGLE_X = 4;
const GYRO_MAX_ANGLE_Y = 8;
const EASE_K_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** True when `deviceorientation` events can be listened to WITHOUT a permission
 *  dialog (Android Chrome / WebView). iOS 13+ exposes `requestPermission`, which
 *  needs a user gesture — we never trigger it. Client-only. */
function gyroscopeWithoutPrompt(): boolean {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return false;
  const ctor = DeviceOrientationEvent as unknown as { requestPermission?: unknown };
  return typeof ctor.requestPermission !== 'function';
}

export function TiltCard({
  children,
  className,
  fallbackClassName,
  restAngleY = 0,
  restAngleYNarrow = 0,
  maxAngle = 8,
  scale = 1.02,
  glare = true,
  perspective = 1000,
  gyroscope = false,
}: {
  children: React.ReactNode;
  className?: string;
  fallbackClassName?: string;
  restAngleY?: number;
  restAngleYNarrow?: number;
  maxAngle?: number;
  scale?: number;
  glare?: boolean;
  perspective?: number;
  /** Allow device-orientation tilt on this instance where it needs no prompt
   *  (Android). Only for DECORATIVE children — the branch is pointer-events-none. */
  gyroscope?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const finePointer = useMediaQuery(FINE_POINTER);
  const coarsePointer = useMediaQuery(COARSE_POINTER);
  const twoColumns = useMediaQuery(LG_UP);
  // Only observed by the gyro branch; `useInView` is a no-op while the ref is
  // null (the other branches never attach it).
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef);

  if (reduceMotion || (!finePointer && !coarsePointer)) {
    return <div className={cn(className, fallbackClassName)}>{children}</div>;
  }

  const restAngle = twoColumns ? restAngleY : restAngleYNarrow;

  if (finePointer) {
    return (
      <Tilt
        // `relative`: the library appends its glare layer as an absolutely
        // positioned child of this wrapper.
        className={cn('relative', className, fallbackClassName)}
        tiltMaxAngleX={maxAngle}
        tiltMaxAngleY={maxAngle}
        tiltAngleYInitial={restAngle}
        perspective={perspective}
        scale={scale}
        transitionSpeed={600}
        transitionEasing={EASE_K_OUT}
        glareEnable={glare}
        // Glare = the primary-foreground white at 12%, the same "light on the
        // surface" treatment as k-sheen — no new colour.
        glareMaxOpacity={0.12}
        glareColor="#ffffff"
        glarePosition="all"
        glareBorderRadius="1rem"
        gyroscope={false}
      >
        {children}
      </Tilt>
    );
  }

  if (gyroscope && gyroscopeWithoutPrompt()) {
    return (
      <div ref={hostRef}>
        <Tilt
          key={inView ? 'gyro' : 'still'}
          className={cn(
            'relative pointer-events-none will-change-transform transition-transform duration-300 ease-k-out',
            className,
            fallbackClassName,
          )}
          tiltMaxAngleX={GYRO_MAX_ANGLE_X}
          tiltMaxAngleY={GYRO_MAX_ANGLE_Y}
          tiltAngleYInitial={restAngle}
          perspective={perspective}
          scale={1}
          transitionSpeed={TOUCH_TRANSITION_MS}
          transitionEasing={EASE_K_OUT}
          glareEnable={false}
          gyroscope={inView}
        >
          {children}
        </Tilt>
      </div>
    );
  }

  return (
    <Tilt
      className={cn('relative', className, fallbackClassName)}
      tiltMaxAngleX={TOUCH_MAX_ANGLE}
      tiltMaxAngleY={TOUCH_MAX_ANGLE}
      tiltAngleYInitial={restAngle}
      perspective={perspective}
      scale={1}
      transitionSpeed={TOUCH_TRANSITION_MS}
      transitionEasing={EASE_K_OUT}
      glareEnable={false}
      gyroscope={false}
    >
      {children}
    </Tilt>
  );
}
