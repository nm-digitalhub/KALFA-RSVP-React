import { unstable_isUnrecognizedActionError } from 'next/navigation';

// Deployment version skew: a tab loaded before a deploy holds Server Action
// ids from the previous build. Clicking any action button then fails with
// Next's UnrecognizedActionError (server responds 404 +
// `x-nextjs-action-not-found`), which surfaces as a dead/stuck button. The
// recovery is a one-time full reload — the fresh page carries the new build's
// action ids. `deploymentId` (next.config.ts) already hard-reloads stale tabs
// on NAVIGATION; this handles the remaining case of a direct action click.

// Render-time check for the boundaries: lets them show a calm "updating…"
// message instead of the generic failure UI while the auto-reload kicks in.
export function isVersionSkewError(error: unknown): boolean {
  return unstable_isUnrecognizedActionError(error);
}

const SKEW_RELOAD_KEY = 'kalfa-skew-reload-at';

// Re-arm window: a second skew error within this period does NOT reload again,
// so a broken deploy can never put the browser in a reload loop.
const SKEW_RELOAD_MIN_INTERVAL_MS = 30_000;

/**
 * True when `error` is a version-skew action failure that should be recovered
 * by reloading the page now. Persists the attempt time in `storage` so at most
 * one reload happens per interval (loop guard that self-re-arms, letting a
 * later deploy recover again in the same tab).
 */
export function shouldReloadForVersionSkew(
  error: unknown,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number,
): boolean {
  if (!unstable_isUnrecognizedActionError(error)) return false;
  const lastAttempt = Number(storage.getItem(SKEW_RELOAD_KEY) ?? 0);
  if (Number.isFinite(lastAttempt) && now - lastAttempt < SKEW_RELOAD_MIN_INTERVAL_MS) {
    return false;
  }
  storage.setItem(SKEW_RELOAD_KEY, String(now));
  return true;
}
