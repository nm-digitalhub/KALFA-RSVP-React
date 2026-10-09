import { describe, expect, it } from 'vitest';

import { cancellationListMoney } from './cancellation-list-money';

const base = { pending: true, hasCampaign: true, lastRefundOutcome: null, campaignStatus: null } as const;

describe('cancellationListMoney', () => {
  it('a pending request whose last refund failed says so first', () =>
    expect(cancellationListMoney({ ...base, lastRefundOutcome: 'failed', campaignStatus: 'paid' })).toBe('refund_failed'));
  it('a resolved request is not "refund failed", even if an attempt once failed', () =>
    expect(cancellationListMoney({ ...base, pending: false, lastRefundOutcome: 'failed', campaignStatus: 'refunded_full' })).toBe('refunded_full'));
  it('a later successful attempt wins', () =>
    expect(cancellationListMoney({ ...base, lastRefundOutcome: 'succeeded', campaignStatus: 'refunded_full' })).toBe('refunded_full'));
  it("otherwise the campaign's own status", () => expect(cancellationListMoney({ ...base, campaignStatus: 'paid' })).toBe('paid'));
  it('a live campaign with nothing paid', () => expect(cancellationListMoney(base)).toBe('unpaid'));
  it('no live campaign → nothing to say', () => expect(cancellationListMoney({ ...base, hasCampaign: false })).toBeNull());
});
