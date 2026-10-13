import { describe, expect, it } from 'vitest';

import {
  approveCampaignSchema,
  purchasePackageSchema,
  choosePackageSchema,
  rescheduleEventSchema,
  thankyouScheduleSchema,
} from '@/lib/validation/campaigns';

describe('approveCampaignSchema', () => {
  const base = {
    campaign_id: '11111111-1111-4111-8111-111111111111',
    tos_version: 'v1',
    terms_accepted: true,
    privacy_accepted: true,
  };

  it('accepts both consents + a ToS version', () => {
    expect(approveCampaignSchema.safeParse(base).success).toBe(true);
  });

  it('rejects when any consent is missing/false', () => {
    expect(
      approveCampaignSchema.safeParse({ ...base, privacy_accepted: false }).success,
    ).toBe(false);
    expect(
      approveCampaignSchema.safeParse({ ...base, terms_accepted: false }).success,
    ).toBe(false);
  });

  it('rejects an invalid campaign id', () => {
    expect(
      approveCampaignSchema.safeParse({ ...base, campaign_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

// The package purchase takes the same one field as the hold: the amount is the campaign's own package_price, read on the
// server, so a price (or anything else) smuggled into the form must never reach the charge.
describe('purchasePackageSchema', () => {
  it('accepts a non-empty single-use card token', () => {
    expect(purchasePackageSchema.safeParse({ 'og-token': 'og_abc123' }).success).toBe(true);
  });

  it('rejects a missing or blank token (no card → no purchase)', () => {
    expect(purchasePackageSchema.safeParse({}).success).toBe(false);
    expect(purchasePackageSchema.safeParse({ 'og-token': '' }).success).toBe(false);
    expect(purchasePackageSchema.safeParse({ 'og-token': '   ' }).success).toBe(false);
  });

  it('drops every other submitted field — a client-sent amount cannot ride along', () => {
    const r = purchasePackageSchema.safeParse({ 'og-token': 'og_abc123', amount: '0.01', package_price: '1' });
    expect(r.success).toBe(true);
    expect(r.success && Object.keys(r.data)).toEqual(['og-token']);
  });
});

describe('choosePackageSchema', () => {
  it('accepts a package id', () => {
    expect(choosePackageSchema.safeParse({ package_id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
  });

  it.each([undefined, '', 'abc', '11111111'])('rejects %j with a Hebrew message', (package_id) => {
    const r = choosePackageSchema.safeParse({ package_id });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/[\u05D0-\u05EA]/);
  });

  it('drops every other submitted field — a price or a quota cannot ride along with the choice', () => {
    const r = choosePackageSchema.safeParse({
      package_id: '11111111-1111-4111-8111-111111111111',
      price: '1',
      contact_quota: '9999',
    });
    expect(r.success && Object.keys(r.data)).toEqual(['package_id']);
  });
});

// Both schemas feed ilWallTimeToIso, which fails on a wall clock that cannot be read or does not exist.
describe('thankyouScheduleSchema — the Israel wall-clock date and time', () => {
  const ok = { auto_enabled: true, send_date: '2026-10-25', send_time: '00:30' };

  it('accepts a real date with a real time, and both empty (clears the schedule)', () => {
    expect(thankyouScheduleSchema.safeParse(ok).success).toBe(true);
    expect(thankyouScheduleSchema.safeParse({ ...ok, send_date: '', send_time: '' }).success).toBe(true);
  });

  it('rejects a date that is not a real calendar date, and a time that is not 00:00–23:59', () => {
    for (const send_date of ['2026-02-30', '2026-13-01', 'abc', '25/10/2026']) {
      expect(thankyouScheduleSchema.safeParse({ ...ok, send_date }).success, send_date).toBe(false);
    }
    for (const send_time of ['24:00', '25:00', '12:60', '9:00', 'noon', '10:00:30']) {
      expect(thankyouScheduleSchema.safeParse({ ...ok, send_time }).success, send_time).toBe(false);
    }
  });

  it('still refuses a half-filled pair', () => {
    expect(thankyouScheduleSchema.safeParse({ ...ok, send_time: '' }).success).toBe(false);
    expect(thankyouScheduleSchema.safeParse({ ...ok, send_date: '' }).success).toBe(false);
  });
});

describe('rescheduleEventSchema — the Israel wall-clock date and time', () => {
  const ok = { event_date: '2026-03-27', event_time: '01:00', reason: 'הלקוח ביקש להקדים את האירוע' };

  it('accepts a real date and time', () => {
    expect(rescheduleEventSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects an impossible date or time instead of letting ilWallTimeToIso throw', () => {
    for (const event_date of ['2026-02-30', '2026-13-01', 'abc', '']) {
      expect(rescheduleEventSchema.safeParse({ ...ok, event_date }).success, event_date).toBe(false);
    }
    for (const event_time of ['24:00', '25:00', '12:60', '1:00', '']) {
      expect(rescheduleEventSchema.safeParse({ ...ok, event_time }).success, event_time).toBe(false);
    }
  });
});
