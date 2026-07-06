'use client';

import { useEffect } from 'react';

import { shouldReloadForVersionSkew } from '@/lib/version-skew';

// Single client-side recovery implementation for stale-deployment Server
// Action failures. Returns true when the error was a skew error AND a reload
// was triggered; false otherwise (not skew, loop-guard suppressed, or storage
// unavailable) — the caller keeps its own failure UI for that case.
export function recoverFromVersionSkew(error: unknown): boolean {
  try {
    if (shouldReloadForVersionSkew(error, window.sessionStorage, Date.now())) {
      window.location.reload();
      return true;
    }
  } catch {
    // Storage unavailable (privacy mode) — fall through to the caller's UI.
  }
  return false;
}

// Used by the error boundaries: when the caught error is a stale-deployment
// Server Action failure, reload once so the tab picks up the new build instead
// of showing a generic failure for a button that will never work again.
export function useVersionSkewReload(error: unknown): void {
  useEffect(() => {
    recoverFromVersionSkew(error);
  }, [error]);
}
