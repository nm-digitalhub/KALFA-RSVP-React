import type { PaymentReviewItem } from '@/lib/data/admin/payment-review';
import { terminalsConflict } from '@/lib/payments/cardcom-terminal-echo';

import type { CardcomReviewFacts } from './review-card';

// What the review card says about a CardCom payment, as text. Pure: the page hands it a review item and gets back the strings (a
// number the payment does not have is said out loud - "not recorded", "not reported" - never shown as an empty cell or a zero).
// SUMIT rows get nothing: their card is the one it always was.
const NOT_RECORDED = 'לא נרשם';
const NOT_REPORTED = 'לא דווח';
const text = (value: number | null): string | null => (value === null ? null : String(value));

export function cardcomReviewFacts(item: PaymentReviewItem): CardcomReviewFacts | undefined {
  if (item.provider !== 'cardcom') return undefined;
  return {
    isTest: item.isTest,
    terminalOpenedOn: text(item.terminalOpenedOn) ?? NOT_RECORDED,
    terminalReported: text(item.terminalReported) ?? NOT_REPORTED,
    reportedConflicts: terminalsConflict(item.terminalOpenedOn, item.terminalReported),
    documentNumber: text(item.documentNumber),
    authRef: item.authRef,
    paymentId: text(item.paymentId),
  };
}
