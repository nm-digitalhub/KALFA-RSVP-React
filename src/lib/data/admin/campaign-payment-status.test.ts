import { describe, expect, it } from 'vitest';

import type { LedgerMoney, PaymentState } from '@/lib/payments/status';

import { campaignPaymentStatus } from './campaign-payment-status';

const ledger = (status: PaymentState['status'], money: Partial<LedgerMoney> = {}, released = false) => ({
  state: { status, collected: 0, credit: 0, committed: 0 },
  money: { paid: 0, refunded: 0, inFlight: null, testMoney: false, ...money },
  released,
});

describe('campaignPaymentStatus — one status per campaign, from the ledger', () => {
  it('nothing ever happened → null', () => expect(campaignPaymentStatus(null)).toBeNull());

  // The live package campaigns of 9.10.2026.
  it('a paid package → paid', () => expect(campaignPaymentStatus(ledger('collected', { paid: 200 }))).toBe('paid'));
  it('a package refunded in full (₪1 of ₪1) → refunded_full', () =>
    expect(campaignPaymentStatus(ledger('refunded', { paid: 1, refunded: 1 }))).toBe('refunded_full'));
  it('a package refunded in part → refunded_partial', () =>
    expect(campaignPaymentStatus(ledger('collected', { paid: 200, refunded: 50 }))).toBe('refunded_partial'));

  it('an unresolved ledger row wins over everything', () => {
    expect(campaignPaymentStatus(ledger('review', { paid: 200 }))).toBe('review');
    expect(campaignPaymentStatus(ledger('pending', { paid: 200 }))).toBe('pending');
  });
  it('a declined attempt with nothing paid → failed', () => expect(campaignPaymentStatus(ledger('declined'))).toBe('failed'));

  // The two pay-per-result campaigns (history): authorize, release, and a ₪0 charge with credit in the ledger. The ₪0
  // charge makes the derived state "collected"; the release row is what says the hold ended with nothing paid.
  it('a pay-per-result hold settled at ₪0 and released → hold_released', () =>
    expect(campaignPaymentStatus(ledger('collected', { paid: 0 }, true))).toBe('hold_released'));
  it('a released guarantee and no charge → hold_released', () =>
    expect(campaignPaymentStatus(ledger('released'))).toBe('hold_released'));
  it('a hold still committed → pending', () => expect(campaignPaymentStatus(ledger('committed'))).toBe('pending'));
  it('money paid beats a release row', () =>
    expect(campaignPaymentStatus(ledger('collected', { paid: 120 }, true))).toBe('paid'));
});
