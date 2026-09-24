import { describe, expect, it } from 'vitest';

import { HOLD_RELEASED_BADGE, holdBadge } from './campaign-hold-badge';

describe('holdBadge', () => {
  it('a released hold says שוחרר, not תפוס, whatever capture_status says', () => {
    expect(holdBadge({ captureStatus: 'authorized', releaseStatus: 'released' })).toBe(HOLD_RELEASED_BADGE);
  });

  it('an authorized hold with no release mark is still תפוס', () => {
    expect(holdBadge({ captureStatus: 'authorized', releaseStatus: null })).toMatchObject({
      label: 'תפוס',
      variant: 'success',
    });
  });

  it('release_status is only meaningful for an authorized hold', () => {
    // A hold that never went through cannot be "released"; the stuck state wins.
    expect(holdBadge({ captureStatus: 'hold_failed', releaseStatus: 'released' })).toMatchObject({
      label: 'תפיסה נדחתה',
    });
  });

  it('no hold at all → null (the cell shows —)', () => {
    expect(holdBadge({ captureStatus: null, releaseStatus: null })).toBeNull();
  });

  it('an unknown capture_status is shown raw, neutral', () => {
    expect(holdBadge({ captureStatus: 'something_new', releaseStatus: null })).toEqual({
      label: 'something_new',
      variant: 'neutral',
    });
  });
});
