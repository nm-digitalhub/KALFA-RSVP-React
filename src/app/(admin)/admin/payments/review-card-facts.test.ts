import { describe, expect, it } from 'vitest';

import type { PaymentReviewItem } from '@/lib/data/admin/payment-review';

import { cardcomReviewFacts } from './review-card-facts';

// What the review card says about a CardCom payment, as text. A number the payment does not have is said out loud ("not recorded",
// "not reported") - never shown as an empty cell or a zero - and a SUMIT row gets nothing at all.

const item = (over: Partial<PaymentReviewItem> = {}): PaymentReviewItem => ({
  operationId: 'op1', campaignId: 'c1', eventId: 'e1', eventName: 'החתונה של דנה', kind: 'package_purchase', kindLabel: 'רכישת חבילה',
  amount: 149, recordedAt: '2026-10-07T10:00:00Z', note: null,
  provider: 'cardcom', isTest: false, terminalOpenedOn: 1001, terminalReported: 1001, documentNumber: 77, authRef: '0123456', paymentId: 555,
  ...over,
});

describe('cardcomReviewFacts', () => {
  it('says nothing for a SUMIT row: its card is the one it always was', () => {
    expect(cardcomReviewFacts(item({ provider: 'sumit' }))).toBeUndefined();
  });

  it('writes every fact of a CardCom payment as text', () => {
    expect(cardcomReviewFacts(item())).toEqual({
      isTest: false, terminalOpenedOn: '1001', terminalReported: '1001', reportedConflicts: false,
      documentNumber: '77', authRef: '0123456', paymentId: '555',
    });
  });

  it('says "not recorded" and "not reported" out loud, and leaves a reference it does not have empty', () => {
    expect(cardcomReviewFacts(item({ terminalOpenedOn: null, terminalReported: null, documentNumber: null, authRef: null, paymentId: null }))).toEqual({
      isTest: false, terminalOpenedOn: 'לא נרשם', terminalReported: 'לא דווח', reportedConflicts: false,
      documentNumber: null, authRef: null, paymentId: null,
    });
  });

  it('marks a conflict only when both terminals are known and different', () => {
    expect(cardcomReviewFacts(item({ terminalOpenedOn: 1000, terminalReported: 1001 }))?.reportedConflicts).toBe(true);
    expect(cardcomReviewFacts(item({ terminalOpenedOn: 1000, terminalReported: null }))?.reportedConflicts).toBe(false);
    expect(cardcomReviewFacts(item({ terminalOpenedOn: null, terminalReported: 1001 }))?.reportedConflicts).toBe(false);
  });

  it('passes the test class on', () => {
    expect(cardcomReviewFacts(item({ isTest: true, terminalOpenedOn: 1000, terminalReported: 1000 }))?.isTest).toBe(true);
  });
});
