import { describe, expect, it } from 'vitest';

import {
  FLAG_EVENT_NAMES,
  LEAD_SOURCES,
  buildFlagCookieValue,
  buildPurchaseParams,
  isFlagEventName,
  parseFlagCookieValue,
} from './ga-event-contracts';

const EVENT_UUID = '659ae5e7-268b-4f04-abd8-fbb89fc3ebe4';
const CAMPAIGN_UUID = 'bac77347-91f5-4f4e-9a20-1c7ffcb0f6ab';

describe('isFlagEventName — the flag-cookie allowlist', () => {
  it('accepts exactly the phase-1 redirect events', () => {
    expect(FLAG_EVENT_NAMES).toEqual(['sign_up', 'agreement_signed']);
    for (const name of FLAG_EVENT_NAMES) expect(isFlagEventName(name)).toBe(true);
  });

  it('rejects anything else — a forged cookie cannot mint arbitrary events', () => {
    expect(isFlagEventName('purchase')).toBe(false);
    expect(isFlagEventName('login')).toBe(false);
    expect(isFlagEventName('')).toBe(false);
    expect(isFlagEventName(undefined)).toBe(false);
    expect(isFlagEventName(null)).toBe(false);
  });
});

describe('flag cookie value — build/parse round-trip', () => {
  it('name-only value round-trips without params (sign_up)', () => {
    expect(buildFlagCookieValue('sign_up')).toBe('sign_up');
    expect(parseFlagCookieValue('sign_up')).toEqual({ name: 'sign_up' });
  });

  it('carries event/campaign UUIDs as keyed segments and parses them back', () => {
    const value = buildFlagCookieValue('agreement_signed', {
      eventId: EVENT_UUID,
      campaignId: CAMPAIGN_UUID,
    });
    expect(value).toBe(`agreement_signed|e:${EVENT_UUID}|c:${CAMPAIGN_UUID}`);
    expect(parseFlagCookieValue(value)).toEqual({
      name: 'agreement_signed',
      params: { event_id: EVENT_UUID, campaign_id: CAMPAIGN_UUID },
    });
  });

  it('build drops non-UUID ids — free text cannot enter the cookie', () => {
    expect(
      buildFlagCookieValue('agreement_signed', { eventId: 'not-a-uuid', campaignId: '' }),
    ).toBe('agreement_signed');
  });

  it('parse rejects forged values: bad name → null; bad segments → dropped', () => {
    expect(parseFlagCookieValue('purchase|e:' + EVENT_UUID)).toBeNull();
    expect(parseFlagCookieValue('')).toBeNull();
    expect(parseFlagCookieValue(null)).toBeNull();
    expect(parseFlagCookieValue('agreement_signed|e:DROP TABLE|c:xss<script>')).toEqual({
      name: 'agreement_signed',
    });
    // unknown segment key with a valid UUID is ignored too
    expect(parseFlagCookieValue(`agreement_signed|z:${EVENT_UUID}`)).toEqual({
      name: 'agreement_signed',
    });
  });
});

describe('LEAD_SOURCES', () => {
  it('are the two stable official lead_source values', () => {
    expect(LEAD_SOURCES).toEqual({ contact: 'contact_form', callback: 'callback_request' });
  });
});

describe('buildPurchaseParams', () => {
  it('carries currency, value, the single service items line, and the real transaction id', () => {
    expect(buildPurchaseParams(84, 2068650995)).toEqual({
      currency: 'ILS',
      value: 84,
      transaction_id: '2068650995',
      items: [
        { item_id: 'rsvp_outreach', item_name: 'RSVP outreach service', price: 84, quantity: 1 },
      ],
    });
  });

  it('omits transaction_id when the provider returned none (null/undefined/blank)', () => {
    for (const missing of [null, undefined, '', '  '] as const) {
      const params = buildPurchaseParams(10, missing);
      expect(params).not.toHaveProperty('transaction_id');
      expect(params.value).toBe(10);
    }
  });

  it('carries the approved context params (ids + plan label) when provided', () => {
    const params = buildPurchaseParams(84, 777, {
      eventId: EVENT_UUID,
      campaignId: CAMPAIGN_UUID,
      billingModel: 'base_overage',
    });
    expect(params.event_id).toBe(EVENT_UUID);
    expect(params.campaign_id).toBe(CAMPAIGN_UUID);
    expect(params.billing_model).toBe('base_overage');
  });

  it('context omitted → no context keys (backwards compatible)', () => {
    const params = buildPurchaseParams(84, 777);
    expect(params).not.toHaveProperty('event_id');
    expect(params).not.toHaveProperty('campaign_id');
    expect(params).not.toHaveProperty('billing_model');
  });
});
