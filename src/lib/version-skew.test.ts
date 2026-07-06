import { describe, expect, it } from 'vitest';
// Test-only deep import: the class Next throws on stale action ids. The public
// surface only exposes the type guard (unstable_isUnrecognizedActionError), so
// constructing the real instance requires the internal module — same module
// instance the guard checks against, so `instanceof` holds.
import { UnrecognizedActionError } from 'next/dist/client/components/unrecognized-action-error';

import { shouldReloadForVersionSkew } from './version-skew';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('shouldReloadForVersionSkew', () => {
  const skewError = new UnrecognizedActionError('Server Action "x" was not found');

  it('reloads on a fresh version-skew action error', () => {
    const storage = memoryStorage();
    expect(shouldReloadForVersionSkew(skewError, storage, 1_000_000)).toBe(true);
  });

  it('ignores ordinary errors', () => {
    const storage = memoryStorage();
    expect(shouldReloadForVersionSkew(new Error('boom'), storage, 1_000_000)).toBe(false);
    expect(shouldReloadForVersionSkew(undefined, storage, 1_000_000)).toBe(false);
    expect(shouldReloadForVersionSkew('Failed to find Server Action', storage, 1_000_000)).toBe(
      false,
    );
  });

  it('does not loop: a second skew error within the interval is suppressed', () => {
    const storage = memoryStorage();
    expect(shouldReloadForVersionSkew(skewError, storage, 1_000_000)).toBe(true);
    expect(shouldReloadForVersionSkew(skewError, storage, 1_000_000 + 5_000)).toBe(false);
  });

  it('re-arms after the interval so a later deploy can recover again', () => {
    const storage = memoryStorage();
    expect(shouldReloadForVersionSkew(skewError, storage, 1_000_000)).toBe(true);
    expect(shouldReloadForVersionSkew(skewError, storage, 1_000_000 + 31_000)).toBe(true);
  });

  it('treats corrupt storage values as no prior attempt', () => {
    const storage = memoryStorage({ 'kalfa-skew-reload-at': 'not-a-number' });
    expect(shouldReloadForVersionSkew(skewError, storage, 1_000_000)).toBe(true);
  });
});
