import type { ProviderDocument } from './ledger';

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
  | 'no_card' // SUMIT: no saved card / expiry / holder id: the admin refunds by hand
  | 'no_document' // CardCom: the payment has no document that can be cancelled (number, or a type we can name): refund by hand
  | 'partial_unsupported'; // CardCom: only a FULL refund is built (a partial one waits for plan item U9)

export type PackageRefundResult =
  | { status: 'refunded'; amount: number; document: ProviderDocument | null; alreadyDone: boolean }
  | { status: 'declined' } // a clear refusal; nothing went back; may be tried again
  | { status: 'review' } // unclear; the money may have gone back; a person decides; never retried automatically
  | { status: 'in_progress' } // another attempt of the same request is running
  | { status: 'refused'; reason: PackageRefundRefusal } // checked BEFORE anything was written or sent
  | { status: 'error' }; // something failed BEFORE anything was sent

