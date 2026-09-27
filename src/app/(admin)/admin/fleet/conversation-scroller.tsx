'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

// The conversation's own scroll container (plan D8). Priority on arrival:
//   1. ?focus=<id>          → centre that message, ring it, move focus to it
//   2. first bubble waiting on the owner → centre it
//   3. otherwise            → the bottom (the newest message)
// `edge` overrides 3 when an older/newer page was loaded, so the reader lands
// next to where they came from.
//
// A plain overflow-y-auto div, not ScrollArea (overflow-x risk inside flex),
// and NOT flex-col-reverse (it reverses DOM order for screen readers).
// Scrolling follows prefers-reduced-motion.
//
// On a later re-render (a reply arrived after revalidation) it sticks to the
// bottom only if the reader was already within 100px of it — scrolling up to
// read history is never yanked away.

const NEAR_BOTTOM_PX = 100;

function behavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

export function ConversationScroller({
  focusId,
  edge,
  version,
  children,
}: {
  focusId: string | null;
  edge: 'top' | 'bottom';
  /** Changes whenever the stream content changes (last event key + count). */
  version: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  const arrivedFor = useRef<string | null>(null);
  const lastVersion = useRef(version);

  // Arrival: runs when the focus target / page changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = `${focusId ?? ''}|${edge}`;
    if (arrivedFor.current === key) return;
    arrivedFor.current = key;

    const focused = focusId ? document.getElementById(`msg-${focusId}`) : null;
    if (focused) {
      // A focused request inside a folded "N expired" run: unfold it first.
      const folded = focused.closest('details');
      if (folded) folded.open = true;
      focused.scrollIntoView({ block: 'center', behavior: 'auto' });
      focused.focus({ preventScroll: true });
      return;
    }
    const waiting = el.querySelector<HTMLElement>('[data-waiting-owner="true"]');
    if (waiting) {
      waiting.scrollIntoView({ block: 'center', behavior: 'auto' });
      return;
    }
    el.scrollTop = edge === 'top' ? 0 : el.scrollHeight;
  }, [focusId, edge]);

  // Later updates: follow the bottom only if the reader was already there.
  useEffect(() => {
    // Not on mount — arrival (above) already chose the position.
    if (lastVersion.current === version) return;
    lastVersion.current = version;
    const el = ref.current;
    if (!el || !wasNearBottom.current || focusId) return;
    el.scrollTo({ top: el.scrollHeight, behavior: behavior() });
  }, [version, focusId]);

  return (
    <div
      ref={ref}
      role="log"
      aria-label="הודעות השיחה"
      aria-live="polite"
      aria-relevant="additions"
      onScroll={(e) => {
        const el = e.currentTarget;
        wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-4"
    >
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

// Phone only: opening a conversation replaces the list, so focus moves to the
// conversation heading (tabIndex=-1). On desktop both panes stay visible and
// focus does not move (plan D9).
export function FocusHeadingOnPhone({ headingId, role }: { headingId: string; role: string }) {
  useEffect(() => {
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    document.getElementById(headingId)?.focus({ preventScroll: true });
  }, [headingId, role]);
  return null;
}
