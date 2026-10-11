import { describe, expect, it } from 'vitest';

import { PACKAGE_AGREEMENT_VERSION, isPackageAgreementVersion } from '@/lib/agreements/template';

// The package contract (v6) is the only contract offered. Its version string is what approval binds to, so the
// predicate must match exactly that version and its draft form — never an earlier pay-per-result version.
describe('isPackageAgreementVersion', () => {
  it('matches the approved version and its draft form', () => {
    expect(isPackageAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(true);
    expect(isPackageAgreementVersion(`draft-${PACKAGE_AGREEMENT_VERSION}`)).toBe(true);
  });

  it.each([null, undefined, '', '2026-07-v4', '2026-09-v5', 'draft-2026-06-v2', 'draft-2026-07-v3', '2026-10-v7'])(
    'does not match %s',
    (v) => {
      expect(isPackageAgreementVersion(v)).toBe(false);
    },
  );
});
