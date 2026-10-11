import { describe, expect, it } from 'vitest';

import { cancellationListMoney } from './cancellation-list-money';

const base = {
  pending: true,
  resolution: null,
  hasCampaign: true,
  lastRefundOutcome: null,
  refundSucceeded: false,
  campaignStatus: null,
} as const;

describe('cancellationListMoney', () => {
  it('a pending request whose last refund failed says so first', () =>
    expect(cancellationListMoney({ ...base, lastRefundOutcome: 'failed', campaignStatus: 'paid' })).toBe('refund_failed'));
  it('a resolved request is not "refund failed", even if an attempt once failed', () =>
    expect(
      cancellationListMoney({
        ...base,
        pending: false,
        resolution: 'full_cancellation',
        lastRefundOutcome: 'failed',
        refundSucceeded: true,
        campaignStatus: 'refunded_full',
      }),
    ).toBe('refunded_full'));
  // 9.10.2026: two requests of one event; the duplicate was declined while the other one's refund went through.
  it('a declined request says "declined", even when the campaign was refunded through another request', () =>
    expect(
      cancellationListMoney({
        ...base,
        pending: false,
        resolution: 'declined',
        lastRefundOutcome: 'failed',
        campaignStatus: 'refunded_full',
      }),
    ).toBe('declined'));
  it('a resolved partial charge with its own refund reads refunded in part', () =>
    expect(
      cancellationListMoney({
        ...base,
        pending: false,
        resolution: 'partial_charge',
        refundSucceeded: true,
        campaignStatus: 'refunded_partial',
      }),
    ).toBe('refunded_partial'));
  it("a resolved request with no refund of its own falls back to the campaign's status (a released hold)", () =>
    expect(
      cancellationListMoney({ ...base, pending: false, resolution: 'full_cancellation', campaignStatus: 'hold_released' }),
    ).toBe('hold_released'));
  it('a later successful attempt wins', () =>
    expect(cancellationListMoney({ ...base, lastRefundOutcome: 'succeeded', campaignStatus: 'refunded_full' })).toBe('refunded_full'));
  it("otherwise the campaign's own status", () => expect(cancellationListMoney({ ...base, campaignStatus: 'paid' })).toBe('paid'));
  it('a live campaign with nothing paid', () => expect(cancellationListMoney(base)).toBe('unpaid'));
  it('no live campaign → nothing to say', () => expect(cancellationListMoney({ ...base, hasCampaign: false })).toBeNull());
});
