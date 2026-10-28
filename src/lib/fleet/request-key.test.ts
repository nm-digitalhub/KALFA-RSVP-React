import { describe, expect, it } from 'vitest';

import { deriveRequestKey } from './request-key';

describe('deriveRequestKey', () => {
  const base = {
    role: 'ops-monitor',
    kind: 'question',
    title: 'תור pg-boss תקוע',
    body: 'התור outreach-arm לא התקדם 30 דקות',
    date: new Date('2026-07-23T10:00:00Z'),
  };

  it('is deterministic for the same logical ask on the same day', () => {
    expect(deriveRequestKey(base)).toBe(deriveRequestKey({ ...base }));
  });

  it('scopes dedup to a calendar day', () => {
    const nextWeek = deriveRequestKey({ ...base, date: new Date('2026-07-30T10:00:00Z') });
    expect(nextWeek).not.toBe(deriveRequestKey(base));
  });

  it('changes when any content component changes', () => {
    expect(deriveRequestKey({ ...base, role: 'qa-runner' })).not.toBe(deriveRequestKey(base));
    expect(deriveRequestKey({ ...base, kind: 'approval' })).not.toBe(deriveRequestKey(base));
    expect(deriveRequestKey({ ...base, title: 'אחר' })).not.toBe(deriveRequestKey(base));
    expect(deriveRequestKey({ ...base, body: 'אחר' })).not.toBe(deriveRequestKey(base));
  });

  // The day turns over at Israel midnight, like public.fleet_owner_request's owner keys — not at UTC midnight (02:00/03:00 here).
  it.each([
    ['winter, 00:30 Israel', '2026-12-01T00:30:00+02:00', '2026-12-01'],
    ['summer, 02:30 Israel', '2026-07-01T02:30:00+03:00', '2026-07-01'],
    ['winter, 23:30 Israel', '2026-11-30T23:30:00+02:00', '2026-11-30'],
  ])('dates the key by the Israel calendar day (%s)', (_label, at, day) => {
    expect(deriveRequestKey({ ...base, date: new Date(at) }).split(':')[1]).toBe(day);
  });

  it('fits the DB length constraint (<=200 chars) for the longest allowed role', () => {
    const key = deriveRequestKey({ ...base, role: 'x'.repeat(64) });
    expect(key.length).toBeLessThanOrEqual(200);
  });
});
