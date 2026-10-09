import type { ProviderDocument, StoredOperation } from './ledger';

// The shapes a package refund shares across clearing companies (package-refund.ts for SUMIT, cardcom-refund.ts for CardCom).
// Their own file so that neither implementation has to import the other; package-refund.ts re-exports them, so existing
// importers are untouched.

export type PackageRefundInput = {
  campaignId: string;
  eventId: string;
  // What goes back to the card, in shekels and whole agorot. The caller decides it (the admin, from the cancellation
  // terms); this module only refuses what the ledger says cannot be refunded.
  amount: number;
  cancellationRequestId: string;
};

export type PackageRefundRefusal =
  | 'disabled' // a gate is closed (payments off, provider not configured)
  | 'invalid_amount'
  | 'no_payment' // the campaign has no succeeded package payment, or nothing left on it
  | 'exceeds_refundable'
  | 'no_customer' // SUMIT: the payer has no customer number: a credit must never open a second customer
  | 'no_card' // no saved card (SUMIT: card, expiry, holder id; CardCom: token, expiry, holder name): the admin refunds by hand
  | 'no_document' // CardCom: the payment's document type has no credit counterpart we can name: refund by hand
  | 'terminal_changed'; // CardCom: the payment was made on a terminal that is not the one the connection uses now, or on one never recorded (an old row)

export type PackageRefundResult =
  | { status: 'refunded'; amount: number; document: ProviderDocument | null; alreadyDone: boolean }
  | { status: 'declined' } // a clear refusal; nothing went back; may be tried again
  | { status: 'review' } // unclear; the money may have gone back; a person decides; never retried automatically
  | { status: 'in_progress' } // another attempt of the same request is running
  | { status: 'refused'; reason: PackageRefundRefusal } // checked BEFORE anything was written or sent
  | { status: 'error' }; // something failed BEFORE anything was sent

// What a screen and the cancellation resolution need to know about a package's money (packageRefundSummary, for either
// clearing company). `refundDocument` is the credit document of THIS request's confirmed refund, as the ledger recorded it
// (the request row itself keeps only a SUMIT document id and url, never a CardCom document number) — null when the
// request refunded nothing yet, or no request was named.
export type PackageRefundSummary = {
  refundable: number;
  refundedForRequest: number;
  hasCard: boolean;
  refundDocument: ProviderDocument | null;
};

// The two ledger facts a cancellation screen shows next to the money, for either clearing company: the document the
// package purchase issued (the receipt a CardCom refund cancels), and how this request's latest refund attempt ended —
// with the provider's own code and text, so a refused refund says WHY (9.10.2026: CardCom 9006, "no permission to refund").
export type PackageRefundAttempt = Pick<StoredOperation, 'outcome' | 'providerStatus' | 'providerStatusDescription' | 'recordedAt'>;
export type PackagePaymentRecord = {
  purchaseDocument: ProviderDocument | null;
  lastRefundAttempt: PackageRefundAttempt | null;
};
