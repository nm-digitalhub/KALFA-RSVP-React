import { describe, expect, it } from 'vitest';

import type { LedgerMoney, PaymentState } from '@/lib/payments/status';

import { campaignPaymentStatus, type HoldColumns } from './campaign-payment-status';

const NO_HOLD: HoldColumns = { captureStatus: null, chargeStatus: null, releaseStatus: null, finalChargeAmount: null };
const ledger = (status: PaymentState['status'], money: Partial<LedgerMoney> = {}) => ({
  state: { status, collected: 0, credit: 0, committed: 0 },
  money: { paid: 0, refunded: 0, inFlight: null, testMoney: false, ...money },
});
const hold = (over: Partial<HoldColumns>) => campaignPaymentStatus(null, { ...NO_HOLD, captureStatus: 'authorized', ...over });

describe('campaignPaymentStatus — one status per campaign', () => {
  it('nothing ever happened → null', () => expect(campaignPaymentStatus(null, NO_HOLD)).toBeNull());

  // The live package campaigns of 9.10.2026.
  it('a paid package → paid', () => expect(campaignPaymentStatus(ledger('collected', { paid: 200 }), NO_HOLD)).toBe('paid'));
  it('a package refunded in full (₪1 of ₪1) → refunded_full', () =>
    expect(campaignPaymentStatus(ledger('refunded', { paid: 1, refunded: 1 }), NO_HOLD)).toBe('refunded_full'));
  it('a package refunded in part → refunded_partial', () =>
    expect(campaignPaymentStatus(ledger('collected', { paid: 200, refunded: 50 }), NO_HOLD)).toBe('refunded_partial'));

  it('an unresolved ledger row wins over everything', () => {
    expect(campaignPaymentStatus(ledger('review', { paid: 200 }), NO_HOLD)).toBe('review');
    expect(campaignPaymentStatus(ledger('pending', { paid: 200 }), NO_HOLD)).toBe('pending');
  });
  it('a declined attempt with nothing paid → failed', () =>
    expect(campaignPaymentStatus(ledger('declined'), NO_HOLD)).toBe('failed'));

  describe('a campaign with a card hold (its own columns)', () => {
    it('held, campaign running → pending', () => expect(hold({})).toBe('pending'));
    it('captured by the final charge → paid', () => expect(hold({ chargeStatus: 'charged', finalChargeAmount: 120 })).toBe('paid'));
    it('final charge failed → failed', () => expect(hold({ chargeStatus: 'charge_failed' })).toBe('failed'));
    it('final charge in review → review', () => expect(hold({ chargeStatus: 'charge_review' })).toBe('review'));
    it('released in SUMIT → hold_released', () => expect(hold({ releaseStatus: 'released' })).toBe('hold_released'));
    it('closed at ₪0, release not seen yet → hold_awaiting_release', () =>
      expect(hold({ chargeStatus: 'nothing_to_charge' })).toBe('hold_awaiting_release'));
    it('closed at ₪0 and released → hold_released', () =>
      expect(hold({ chargeStatus: 'nothing_to_charge', releaseStatus: 'released' })).toBe('hold_released'));
    it('a capture beats a stray release mark', () =>
      expect(hold({ chargeStatus: 'charged', releaseStatus: 'released' })).toBe('paid'));
    it('a hold that never went through: its charge/release marks mean nothing', () =>
      expect(hold({ captureStatus: 'hold_failed', chargeStatus: 'charged', releaseStatus: 'released' })).toBe('failed'));
    it('a hold being placed → pending; a hold in review → review', () => {
      expect(hold({ captureStatus: 'pending' })).toBe('pending');
      expect(hold({ captureStatus: 'hold_review' })).toBe('review');
    });
    it('an unknown hold state → review, never a guess', () => expect(hold({ captureStatus: 'something_new' })).toBe('review'));
    it('a refund in the ledger of a charged hold: compared with the final charge', () => {
      const charged = { ...NO_HOLD, captureStatus: 'authorized', chargeStatus: 'charged', finalChargeAmount: 120 };
      expect(campaignPaymentStatus(ledger('none', { refunded: 20 }), charged)).toBe('refunded_partial');
      expect(campaignPaymentStatus(ledger('none', { refunded: 120 }), charged)).toBe('refunded_full');
    });
  });
});
