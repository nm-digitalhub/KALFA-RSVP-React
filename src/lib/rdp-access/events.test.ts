import { describe, expect, it } from 'vitest';

import { outcomeExplains, RDP_EVENT_KINDS } from './events';

describe('outcomeExplains', () => {
  it('is true only for the kinds whose outcome says why something failed or was refused', () => {
    const explaining = RDP_EVENT_KINDS.filter((kind) => outcomeExplains(kind));
    expect(explaining.sort()).toEqual(['disconnect_failed', 'file_failed', 'file_refused', 'tunnel_closed']);
  });

  it('keeps the outcome of a kind it does not know, rather than hiding it', () => {
    expect(outcomeExplains('brand_new_kind')).toBe(true);
  });
});
