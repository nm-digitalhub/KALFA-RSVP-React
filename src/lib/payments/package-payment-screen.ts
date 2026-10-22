import type { PaymentState } from './status';

// Paid, not running yet: the package-activation job is starting it (design D23). Said by the payment page and the setup
// flow alike; never a button, never "not started".
export const SERVICE_STARTING = 'השירות מופעל. הפניות לאורחים יישלחו לפי לוח הזמנים.';

// What the payment page shows for a fixed-price package campaign. Pure on purpose: the page gathers the facts (the
// ledger, the campaign, the event, the gates) and this decides, so every rule below is a one-line test.
//
// The ledger comes first. Whatever the payment state says wins over the campaign's status, the event's date and the
// gates — a customer who paid must always see that they paid — and a payment that is still unresolved (pending, or
// waiting for a person) never offers the card form again, because the card may already have been charged.

export type PackagePaymentScreen =
  // `activation`: the service is running, it is being started (paid and approved: the package-activation job starts it,
  // design D23), or neither (the event passed, staff paused it, or the campaign moved on). Nothing here is a control. `testMoney`: what was paid is test money (a payment on the
  // no-money test terminal), which the screen says; present only when true.
  | { kind: 'paid'; amount: number; activation: 'active' | 'starting' | 'unavailable'; testMoney?: true }
  | { kind: 'in_progress' }
  | { kind: 'review' }
  // `testTerminal`: the form will take the payment on the no-money test terminal, which the screen says; present only when true.
  | { kind: 'form'; amount: number; testTerminal?: true }
  | { kind: 'unavailable'; reason: 'ledger' | 'bad_state' | 'past' | 'not_active' | 'disabled' };

export interface PackagePaymentScreenInput {
  // The campaign's current pricing round's final price (the pricing module).
  price: number;
  // The ledger-derived state; null when the ledger could not be read.
  payment: PaymentState | null;
  campaignStatus: string;
  eventPast: boolean;
  eventActive: boolean;
  // payments + the package model + the provider's public configuration are all on.
  gatesOpen: boolean;
  // A pending payment the BUYER can open again: a CardCom Open Fields session still open in a form (a reload, a second
  // tab). The form is shown, and opening it settles the old session and replaces it with a new one (CardCom: a new LowProfile for
  // each submission of the form). A SUMIT charge in flight is never resumable — its
  // card may already have been charged — so it stays "in progress". Defaults to false.
  pendingIsResumable?: boolean;
  // The form would take the payment on CardCom's no-money test terminal (only someone who may configure the integration is ever
  // offered it). Defaults to false.
  testTerminal?: boolean;
}

// Only `approved` is being started: the job moves `approved → active` only. A paused service was stopped by staff and is
// not restarted by anyone on the customer's side; `scheduled` has no writer.
function activationOf(i: PackagePaymentScreenInput): 'active' | 'starting' | 'unavailable' {
  if (i.campaignStatus === 'active') return 'active';
  if (!i.eventPast && i.campaignStatus === 'approved') return 'starting';
  return 'unavailable';
}

export function packagePaymentScreen(i: PackagePaymentScreenInput): PackagePaymentScreen {
  if (i.payment === null) return { kind: 'unavailable', reason: 'ledger' };

  switch (i.payment.status) {
    case 'collected':
      return { kind: 'paid', amount: i.payment.collected, activation: activationOf(i), ...(i.payment.testMoney ? { testMoney: true as const } : {}) };
    case 'pending':
      if (!i.pendingIsResumable) return { kind: 'in_progress' };
      break;
    case 'review':
      return { kind: 'review' };
    case 'none':
    case 'declined':
      break;
    default:
      // refunded / released / committed: a package campaign that carries any of these is not purchasable here.
      return { kind: 'unavailable', reason: 'bad_state' };
  }

  if (i.campaignStatus !== 'approved' || !Number.isFinite(i.price) || i.price <= 0) {
    return { kind: 'unavailable', reason: 'bad_state' };
  }
  if (i.eventPast) return { kind: 'unavailable', reason: 'past' };
  if (!i.eventActive) return { kind: 'unavailable', reason: 'not_active' };
  if (!i.gatesOpen) return { kind: 'unavailable', reason: 'disabled' };
  return { kind: 'form', amount: i.price, ...(i.testTerminal ? { testTerminal: true as const } : {}) };
}
