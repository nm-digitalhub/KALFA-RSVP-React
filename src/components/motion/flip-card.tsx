'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LazyMotion, MotionConfig, domAnimation, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { ArrowLeft, RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';

import { autoFlipDelay, frontImageState } from './auto-flip';

// Two-faced 3D card (motion 13 spring on `rotateY`). Used by the gift landing
// page: FRONT = the invitation image + greeting + the essentials, BACK = the
// extras (navigation, calendar). Both faces are server-rendered children; the
// island owns only the flip state.
//
// PROGRESSIVE ENHANCEMENT CONTRACT (security review 2026-09-08, MEDIUM):
//   - Nothing a guest must be able to do lives inside the card. The page's
//     payment CTA is rendered by the server OUTSIDE this component, so it is
//     clickable and focusable with zero JavaScript, before hydration, and if
//     hydration ever fails (WhatsApp in-app browsers on slow networks are the
//     real case). The front face carries the essentials for the same reason.
//   - `inert` / `aria-hidden` on the hidden face are applied ONLY after
//     hydration (`useHydrated`, a useSyncExternalStore with a `false` server
//     snapshot): the server HTML never contains an inert subtree, so a
//     renderToStaticMarkup of this component has no `inert` and no
//     `aria-hidden="true"` (guarded by flip-card.test.ts).
//
// Reveal choreography: the card opens on the invitation and flips to the back
// by itself after `autoFlipMs`, unless the guest has already interacted with
// the card (pointer or keyboard) or focus is inside it — an auto-flip must
// never yank focus. With `autoFlipAwaitsFrontImage` the timer is replaced by
// the rule in auto-flip.ts: wait for the front face's <img> to load, then
// dwell `autoFlipDwellMs` on it (owner's 4G recording 2026-09-08: the card
// turned before the invitation had painted); a failed image falls back to
// `autoFlipMs` from mount, a pending one is never flipped away. Either face can
// be re-shown with its toggle; a
// user-initiated flip moves focus to the newly shown face's toggle so keyboard
// users are never left on a hidden element.
//
// Reduced motion (`MotionConfig reducedMotion="user"` + useReducedMotion): no
// auto-flip and no rotation — the toggles swap faces instantly.
//
// Layout: both faces sit in the same grid cell, so the card's height is the
// taller face and nothing shifts when it flips; `backface-hidden` +
// `transform-3d` + `perspective-distant` are Tailwind's 3D utilities. The
// back face is therefore usually TALLER than its content (the front carries
// the invitation image): its content is centred and `backClassName` lets the
// caller paint the whole face (the gift page passes its event-type wash), so
// the spare height reads as designed surface, not as a blank card.

const FACE_CLASS =
  'col-start-1 row-start-1 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm backface-hidden';

const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function FlipCard({
  front,
  back,
  frontToggleLabel,
  backToggleLabel,
  autoFlipMs = 1400,
  autoFlipAwaitsFrontImage = false,
  autoFlipDwellMs = 2500,
  className,
  backClassName,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  /** Button on the FRONT face that flips to the back. */
  frontToggleLabel: string;
  /** Text button on the BACK face that flips to the front. */
  backToggleLabel: string;
  /** 0 disables the automatic flip. */
  autoFlipMs?: number;
  /** The front face carries an <img>: flip only once it has loaded, then after `autoFlipDwellMs`. */
  autoFlipAwaitsFrontImage?: boolean;
  /** Minimum time the loaded front image stays on screen before the auto-flip. */
  autoFlipDwellMs?: number;
  className?: string;
  /** Extra classes for the BACK face (e.g. a full-face background wash). */
  backClassName?: string;
}) {
  const hydrated = useHydrated();
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const frontFaceRef = useRef<HTMLDivElement>(null);
  const frontToggleRef = useRef<HTMLButtonElement>(null);
  const backToggleRef = useRef<HTMLButtonElement>(null);
  const interacted = useRef(false);
  const pendingFocus = useRef<'front' | 'back' | null>(null);

  // Auto-flip — cancelled by any interaction with the card, and skipped when
  // focus is inside it at the moment it would fire. Scheduling rule (when to
  // fire, and whether to wait for the front image first): auto-flip.ts.
  useEffect(() => {
    if (reduceMotion || autoFlipMs <= 0) return;
    const card = cardRef.current;
    const markInteracted = () => {
      interacted.current = true;
    };
    card?.addEventListener('pointerdown', markInteracted);
    card?.addEventListener('keydown', markInteracted);

    const mountedAt = performance.now();
    const timing = { autoFlipMs, dwellMs: autoFlipDwellMs };
    let timer: number | undefined;
    const fire = () => {
      const focusInside =
        card !== null && document.activeElement !== null && card.contains(document.activeElement);
      if (!interacted.current && !focusInside) setFlipped(true);
    };
    const schedule = (delay: number | null) => {
      if (delay === null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, delay);
    };

    const img = autoFlipAwaitsFrontImage
      ? (frontFaceRef.current?.querySelector('img') ?? null)
      : null;
    schedule(autoFlipDelay(frontImageState(img), 0, timing));
    // A pending image schedules nothing above; its own events do.
    const onLoad = () => schedule(autoFlipDelay('loaded', 0, timing));
    const onError = () =>
      schedule(autoFlipDelay('failed', performance.now() - mountedAt, timing));
    img?.addEventListener('load', onLoad);
    img?.addEventListener('error', onError);

    return () => {
      window.clearTimeout(timer);
      img?.removeEventListener('load', onLoad);
      img?.removeEventListener('error', onError);
      card?.removeEventListener('pointerdown', markInteracted);
      card?.removeEventListener('keydown', markInteracted);
    };
  }, [reduceMotion, autoFlipMs, autoFlipAwaitsFrontImage, autoFlipDwellMs]);

  // After a user-initiated flip, land focus on the newly visible face.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const target = pendingFocus.current === 'back' ? backToggleRef.current : frontToggleRef.current;
    pendingFocus.current = null;
    target?.focus({ preventScroll: true });
  }, [flipped]);

  const toggle = (next: boolean) => {
    interacted.current = true;
    pendingFocus.current = next ? 'back' : 'front';
    setFlipped(next);
  };

  // Hidden-face isolation only once the client owns the state.
  const frontHidden = hydrated && flipped;
  const backHidden = hydrated && !flipped;

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div ref={cardRef} className={cn('perspective-distant', className)}>
          <m.div
            className="grid transform-3d"
            initial={false}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 110, damping: 16, mass: 0.9 }}
          >
            <div
              ref={frontFaceRef}
              className={FACE_CLASS}
              inert={frontHidden}
              aria-hidden={frontHidden || undefined}
            >
              <div className="flex-1">{front}</div>
              <div className="border-t border-border p-4">
                <button
                  ref={frontToggleRef}
                  type="button"
                  onClick={() => toggle(true)}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition duration-300 ease-k-out hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:active:scale-[0.98]"
                >
                  {frontToggleLabel}
                  <ArrowLeft aria-hidden className="size-4" />
                </button>
              </div>
            </div>
            <div
              className={cn(FACE_CLASS, 'rotate-y-180', backClassName)}
              inert={backHidden}
              aria-hidden={backHidden || undefined}
            >
              <div className="flex flex-1 flex-col justify-center">{back}</div>
              <div className="border-t border-border p-2 text-center">
                <button
                  ref={backToggleRef}
                  type="button"
                  onClick={() => toggle(false)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <RotateCcw aria-hidden className="size-4" />
                  {backToggleLabel}
                </button>
              </div>
            </div>
          </m.div>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
