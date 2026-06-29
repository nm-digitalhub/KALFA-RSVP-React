import { describe, expect, it } from 'vitest';

import {
  approveCampaignSchema,
  authorizeHoldSchema,
} from '@/lib/validation/campaigns';

describe('approveCampaignSchema', () => {
  const base = {
    campaign_id: '11111111-1111-4111-8111-111111111111',
    tos_version: 'v1',
    terms_accepted: true,
    privacy_accepted: true,
    authorization_accepted: true,
  };

  it('accepts all three consents + a ToS version', () => {
    expect(approveCampaignSchema.safeParse(base).success).toBe(true);
  });

  it('rejects when any consent is missing/false', () => {
    expect(
      approveCampaignSchema.safeParse({ ...base, authorization_accepted: false }).success,
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
