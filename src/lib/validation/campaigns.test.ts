import { describe, expect, it } from 'vitest';

import {
  campaignTermsSchema,
  approveCampaignSchema,
  authorizeHoldSchema,
} from '@/lib/validation/campaigns';

const validTerms = {
  template_id: '11111111-1111-4111-8111-111111111111',
};

describe('campaignTermsSchema', () => {
  it('accepts a valid template id (the only required input)', () => {
    expect(campaignTermsSchema.safeParse(validTerms).success).toBe(true);
  });

  it('requires a valid template id', () => {
    expect(
      campaignTermsSchema.safeParse({ template_id: 'nope' }).success,
    ).toBe(false);
    expect(campaignTermsSchema.safeParse({}).success).toBe(false);
  });

  it('strips client-supplied price / channels / contact count (server-authoritative)', () => {
    const parsed = campaignTermsSchema.safeParse({
      ...validTerms,
      price_per_reached: 0.01,
      allowed_channels: ['whatsapp'],
      max_contacts: 1,
    });
    expect(parsed.success).toBe(true);
    const data = (parsed as { data?: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('price_per_reached');
    expect(data).not.toHaveProperty('allowed_channels');
    expect(data).not.toHaveProperty('max_contacts');
  });
});

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
