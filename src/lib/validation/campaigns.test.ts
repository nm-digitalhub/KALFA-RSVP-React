import { describe, expect, it } from 'vitest';

import {
  approveCampaignSchema,
  authorizeHoldSchema,
  purchasePackageSchema,
  choosePackageSchema,
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

describe('authorizeHoldSchema', () => {
  it('accepts a non-empty single-use card token', () => {
    const r = authorizeHoldSchema.safeParse({ 'og-token': 'og_abc123' });
    expect(r.success).toBe(true);
  });

  it('rejects a missing or empty og-token (no card → no hold)', () => {
    expect(authorizeHoldSchema.safeParse({}).success).toBe(false);
    expect(authorizeHoldSchema.safeParse({ 'og-token': '' }).success).toBe(false);
    expect(authorizeHoldSchema.safeParse({ 'og-token': '   ' }).success).toBe(
      false,
    );
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
