import { describe, expect, it } from 'vitest';

import { validateWithdrawOwnership } from './withdraw';

describe('validateWithdrawOwnership', () => {
  it('accepts a row owned by the calling role (withdraws its own request)', () => {
    expect(validateWithdrawOwnership({ role: 'social-manager' }, 'social-manager')).toBeNull();
  });

  it('rejects a row owned by a different role', () => {
    const err = validateWithdrawOwnership({ role: 'social-manager' }, 'ops-monitor');
    expect(err).not.toBeNull();
    expect(err).toContain('social-manager');
    expect(err).toContain('ops-monitor');
  });

  it('does not flag a missing row — the existing not-found no-op path is unaffected', () => {
    expect(validateWithdrawOwnership(null, 'social-manager')).toBeNull();
    expect(validateWithdrawOwnership(undefined, 'social-manager')).toBeNull();
  });
});
