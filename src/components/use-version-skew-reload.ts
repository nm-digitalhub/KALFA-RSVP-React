'use client';

import { useEffect } from 'react';

import { shouldReloadForVersionSkew } from '@/lib/version-skew';
import { CALL_ACTIVE_STATES, getCallSnapshot } from '@/lib/voximplant/web-client';

// Single client-side recovery implementation for stale-deployment Server
// Action failures. Returns true when the error was a skew error AND a reload
// was triggered; false otherwise (not skew, loop-guard suppressed, storage
// unavailable, or a call is active) — the caller keeps its own failure UI
// for that case.
//
// Call gate: a full reload would silently drop a live WebRTC call — deferred
// from the softphone panel's stage 3 build precisely until call state
// existed (see web-client.ts's call layer). getCallSnapshot() is always
// 'idle' outside the admin console (this hook also backs the customer app's
// and the root global-error boundary — importing it is safe: web-client.ts's
// actual SDK import is dynamic/lazy inside connectAndLogin, never at module
// scope, so referencing this getter here does not pull the SDK into the
// global-error bundle). Checked BEFORE shouldReloadForVersionSkew so the
// loop-guard timestamp is never written while suppressed — the guard stays
// armed for a real reload once the call ends.
export function recoverFromVersionSkew(error: unknown): boolean {
  try {
    if (CALL_ACTIVE_STATES.includes(getCallSnapshot().state)) return false;
    if (shouldReloadForVersionSkew(error, window.sessionStorage, Date.now())) {
      window.location.reload();
      return true;
    }
  } catch {
    // Storage unavailable (privacy mode), or the call-snapshot getter itself
    // threw — either way, fall through to the caller's UI rather than crash
    // a last-resort error boundary.
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
