import type { PaymentState } from './status';

// What the payment page shows for a fixed-price package campaign. Pure on purpose: the page gathers the facts (the
// ledger, the campaign, the event, the gates) and this decides, so every rule below is a one-line test.
//
// The ledger comes first. Whatever the payment state says wins over the campaign's status, the event's date and the
// gates — a customer who paid must always see that they paid — and a payment that is still unresolved (pending, or
// waiting for a person) never offers the card form again, because the card may already have been charged.

export type PackagePaymentScreen =
  // `activation`: what the customer can do next — the campaign is already running, it can be started from here, or
  // it cannot be started (the event passed, or the campaign moved on). `testMoney`: what was paid is test money (a payment on the
  // no-money test terminal), which the screen says; present only when true.
  | { kind: 'paid'; amount: number; activation: 'active' | 'ready' | 'unavailable'; testMoney?: true }
  | { kind: 'in_progress' }
  | { kind: 'review' }
  // `testTerminal`: the form will take the payment on the no-money test terminal, which the screen says; present only when true.
  | { kind: 'form'; amount: number; testTerminal?: true }
  | { kind: 'unavailable'; reason: 'ledger' | 'bad_state' | 'past' | 'not_active' | 'disabled' };

export interface PackagePaymentScreenInput {
  // The campaign's own package_price.
  price: number;
  // The ledger-derived state; null when the ledger could not be read.
  payment: PaymentState | null;
  campaignStatus: string;
  eventPast: boolean;
  eventActive: boolean;
  // payments + the package model + the provider's public configuration are all on.
  gatesOpen: boolean;
  // A pending payment the BUYER can pick up again: a CardCom Open Fields session still open in a form (a reload, a second
  // tab). The form is shown and asks the server for the same session. A SUMIT charge in flight is never resumable — its
  // card may already have been charged — so it stays "in progress". Defaults to false.
  pendingIsResumable?: boolean;
  // The form would take the payment on CardCom's no-money test terminal (only someone who may configure the integration is ever
  // offered it). Defaults to false.
  testTerminal?: boolean;
}

function activationOf(i: PackagePaymentScreenInput): 'active' | 'ready' | 'unavailable' {
  if (i.campaignStatus === 'active') return 'active';
  if (!i.eventPast && ['approved', 'scheduled', 'paused'].includes(i.campaignStatus)) return 'ready';
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
