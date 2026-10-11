import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./campaigns', () => ({ listPackageOffers: vi.fn() }));

import { listPackageOffers } from './campaigns';
import { getPublicBusinessFacts } from './public-business-facts';

const offer = {
  id: 'p1',
  name: 'אישורי הגעה',
  price: 200,
  contact_quota: 200,
  description: 'תיאור',
  includes: ['שורה'],
  channels: ['whatsapp' as const, 'call' as const],
  outreach_schedule: [{ days_before: 10, channel: 'whatsapp' as const, message_key: 'invite' }],
};

// A block body: an arrow that RETURNS the mock would hand vitest a teardown function, and it would call the mock.
beforeEach(() => {
  vi.mocked(listPackageOffers).mockReset();
});

describe('getPublicBusinessFacts', () => {
  it('quotes the packages the purchase flow sells, and keeps only the cadence fields of each touchpoint', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([offer]);
    const facts = await getPublicBusinessFacts();
    expect(facts.available).toBe(true);
    expect(facts.packages).toEqual([
      {
        name: 'אישורי הגעה',
        price: 200,
        contact_quota: 200,
        channels: ['whatsapp', 'call'],
        description: 'תיאור',
        includes: ['שורה'],
        outreach_schedule: [{ days_before: 10, channel: 'whatsapp' }],
      },
    ]);
    expect(facts.summary_he).toContain('₪200');
  });

  it('nothing on sale (or the package switch off) → unavailable, never a guessed price', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([]);
    expect((await getPublicBusinessFacts()).available).toBe(false);
  });

  it('a read failure is unavailable, not an error on a public page', async () => {
    vi.mocked(listPackageOffers).mockRejectedValue(new Error('db down'));
    expect(await getPublicBusinessFacts()).toEqual({ available: false, reason: 'business facts read failed' });
  });
});
