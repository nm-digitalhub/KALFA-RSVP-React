'use client';

import { useSyncExternalStore } from 'react';

// SSR-safe media-query hook for the motion islands. The server snapshot is
// `false`, and React re-renders once the real value is read after hydration,
// so the server HTML and the first client render always agree (no hydration
// mismatch) and a phone never briefly mounts a pointer-only effect.
function subscribe(query: string, onChange: () => void): () => void {
  const mq = window.matchMedia(query);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A real hover-capable pointer (mouse / trackpad) — never true on touch-only devices. */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)';
/** The primary pointer is a finger (phones, tablets). A touch-screen laptop with a
 *  trackpad reports `pointer: fine` and takes the FINE_POINTER path instead. */
export const COARSE_POINTER = '(pointer: coarse)';
/** Tailwind `lg` — the breakpoint where the homepage hero becomes two columns. */
export const LG_UP = '(min-width: 64rem)';
