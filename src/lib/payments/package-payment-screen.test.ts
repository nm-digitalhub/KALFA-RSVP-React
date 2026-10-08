import { describe, expect, it } from 'vitest';

import { packagePaymentScreen, type PackagePaymentScreenInput } from './package-payment-screen';
import type { PaymentState } from './status';

// What the payment page shows for a package campaign is decided from the LEDGER, not from a query string and not from
// the campaign's old hold columns. The properties defended here: a payment that exists is always shown as such; a
// payment nobody can classify never offers the card form again; and the form appears only when a purchase is both
// possible and allowed.

const none: PaymentState = { status: 'none', collected: 0, credit: 0, committed: 0 };
const open: PackagePaymentScreenInput = {
  price: 120,
  payment: none,
  campaignStatus: 'approved',
  eventPast: false,
  eventActive: true,
  gatesOpen: true,
};
const screen = (over: Partial<PackagePaymentScreenInput>) => packagePaymentScreen({ ...open, ...over });

describe('packagePaymentScreen — the ledger decides', () => {
  it('collected → the paid screen, with the amount the ledger recorded', () => {
    expect(screen({ payment: { status: 'collected', collected: 120, credit: 0, committed: 0 } })).toEqual({ kind: 'paid', amount: 120, activation: 'ready' });
  });

  it('a payment that exists is shown even when everything around it has moved on', () => {
    expect(
      screen({
        payment: { status: 'collected', collected: 120, credit: 0, committed: 0 },
        campaignStatus: 'active',
        eventPast: true,
        eventActive: false,
        gatesOpen: false,
      }),
    ).toEqual({ kind: 'paid', amount: 120, activation: 'active' });
  });

  it('pending → in progress; review → review. Neither offers the card form', () => {
    expect(screen({ payment: { status: 'pending', collected: 0, credit: 0, committed: 0 } })).toEqual({ kind: 'in_progress' });
    expect(screen({ payment: { status: 'review', collected: 0, credit: 0, committed: 0 } })).toEqual({ kind: 'review' });
  });

  it('a pending payment the buyer can pick up again (an open CardCom form) shows the form, not "in progress"', () => {
    const pending: PaymentState = { status: 'pending', collected: 0, credit: 0, committed: 0 };
    expect(screen({ payment: pending, pendingIsResumable: true })).toEqual({ kind: 'form', amount: 120 });
    // ...but only when a purchase is otherwise allowed: resuming never gets around a closed gate or a past event.
    expect(screen({ payment: pending, pendingIsResumable: true, gatesOpen: false })).toEqual({ kind: 'unavailable', reason: 'disabled' });
    expect(screen({ payment: pending, pendingIsResumable: true, eventPast: true })).toEqual({ kind: 'unavailable', reason: 'past' });
    expect(screen({ payment: pending, pendingIsResumable: false })).toEqual({ kind: 'in_progress' });
  });

  it('a review payment is never resumable, whatever the flag says', () => {
    expect(screen({ payment: { status: 'review', collected: 0, credit: 0, committed: 0 }, pendingIsResumable: true })).toEqual({ kind: 'review' });
  });

  it('an unreadable ledger is "unavailable", never an empty form', () => {
    expect(screen({ payment: null })).toEqual({ kind: 'unavailable', reason: 'ledger' });
  });

  it.each(['refunded', 'released', 'committed'] as const)('a ledger state of %s on a package campaign is not purchasable', (status) => {
    expect(screen({ payment: { status, collected: 0, credit: 0, committed: 0 } })).toEqual({ kind: 'unavailable', reason: 'bad_state' });
  });
});

describe('packagePaymentScreen — when the form appears', () => {
  it('nothing paid yet, an approved campaign, an open event and open gates → the form for the campaign price', () => {
    expect(screen({})).toEqual({ kind: 'form', amount: 120 });
  });

  it('an earlier DECLINED attempt shows the form again', () => {
    expect(screen({ payment: { status: 'declined', collected: 0, credit: 0, committed: 0 } })).toEqual({ kind: 'form', amount: 120 });
  });

  it.each(['draft', 'pending_approval', 'active', 'closed', 'cancelled'])('a %s campaign has no form', (campaignStatus) => {
    expect(screen({ campaignStatus })).toEqual({ kind: 'unavailable', reason: 'bad_state' });
  });

  it('a past event, an unconfirmed event, and a closed gate each say why', () => {
    expect(screen({ eventPast: true })).toEqual({ kind: 'unavailable', reason: 'past' });
    expect(screen({ eventActive: false })).toEqual({ kind: 'unavailable', reason: 'not_active' });
    expect(screen({ gatesOpen: false })).toEqual({ kind: 'unavailable', reason: 'disabled' });
  });

  it.each([0, -1, Number.NaN])('a price of %s has no form', (price) => {
    expect(screen({ price })).toEqual({ kind: 'unavailable', reason: 'bad_state' });
  });
});

describe('packagePaymentScreen — paid: what the customer can do next', () => {
  const paid = { payment: { status: 'collected', collected: 120, credit: 0, committed: 0 } satisfies PaymentState };

  it.each([
    ['active', 'active'],
    ['approved', 'ready'],
    ['scheduled', 'ready'],
    ['paused', 'ready'],
    ['closed', 'unavailable'],
    ['cancelled', 'unavailable'],
  ])('a %s campaign: activation is %s', (campaignStatus, activation) => {
    expect(screen({ ...paid, campaignStatus })).toEqual({ kind: 'paid', amount: 120, activation });
  });

  it('a past event cannot be started, but the customer still sees that they paid', () => {
    expect(screen({ ...paid, campaignStatus: 'approved', eventPast: true })).toEqual({ kind: 'paid', amount: 120, activation: 'unavailable' });
  });
});

