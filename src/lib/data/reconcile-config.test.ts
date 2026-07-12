import { afterEach, describe, expect, it } from 'vitest';
import { isReconcileEnabled } from '@/lib/data/reconcile-config';

// P0-1 (A6) kill-switch. The reconcile wiring must be INERT unless the env var
// is exactly 'true', so the default build never changes billing/outreach behavior.
describe('isReconcileEnabled', () => {
  const original = process.env.RECONCILE_AUTHORIZED_SET_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.RECONCILE_AUTHORIZED_SET_ENABLED;
    else process.env.RECONCILE_AUTHORIZED_SET_ENABLED = original;
  });

  it('is false when the env var is unset (default → wiring inert)', () => {
    delete process.env.RECONCILE_AUTHORIZED_SET_ENABLED;
    expect(isReconcileEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    process.env.RECONCILE_AUTHORIZED_SET_ENABLED = 'true';
    expect(isReconcileEnabled()).toBe(true);
  });

  it('is false for any other truthy-looking value', () => {
    for (const v of ['1', 'TRUE', 'yes', 'on', 'false', '']) {
      process.env.RECONCILE_AUTHORIZED_SET_ENABLED = v;
      expect(isReconcileEnabled()).toBe(false);
    }
  });
});
