import { describe, expect, it } from 'vitest';

import { packageCancellationState, packageRefundMessage, planPackageRefund } from './package-cancellation';

// What goes back to the customer of a fixed-price package when the admin resolves a cancellation request. The same
// meaning the existing post-charge branch already gives the two resolutions, so the admin screen needs no new rules:
//   ביטול מלא   → everything the card paid goes back;
//   ביטול עם דמי ביטול (partial_charge) → the amount typed (or the percentage turned into an amount) STAYS with us, the rest goes back.

describe('planPackageRefund', () => {
  it('full cancellation: all of it goes back, nothing is kept', () => {
    expect(planPackageRefund({ paid: 120, resolution: 'full_cancellation' })).toEqual({ kept: 0, refund: 120 });
  });

  it('partial: the amount stays, the rest goes back', () => {
    expect(planPackageRefund({ paid: 120, resolution: 'partial_charge', resolutionAmount: 15 })).toEqual({ kept: 15, refund: 105 });
  });

  it('partial that keeps everything: nothing goes back', () => {
    expect(planPackageRefund({ paid: 120, resolution: 'partial_charge', resolutionAmount: 120 })).toEqual({ kept: 120, refund: 0 });
  });

  it('whole agorot, no floating-point crumbs: 100.10 − 0.30', () => {
    expect(planPackageRefund({ paid: 100.1, resolution: 'partial_charge', resolutionAmount: 0.3 })).toEqual({ kept: 0.3, refund: 99.8 });
  });

  it('keeping more than was paid is refused in plain words', () => {
    expect(() => planPackageRefund({ paid: 120, resolution: 'partial_charge', resolutionAmount: 120.01 })).toThrow('גדול ממה ששולם');
  });

  it('a partial resolution without an amount is refused', () => {
    expect(() => planPackageRefund({ paid: 120, resolution: 'partial_charge' })).toThrow();
  });

  it('nothing paid, nothing to plan: a full cancellation refunds 0', () => {
    expect(planPackageRefund({ paid: 0, resolution: 'full_cancellation' })).toEqual({ kept: 0, refund: 0 });
  });
});

describe('packageRefundMessage — what the admin is told when the refund did not go through', () => {
  it('every message is a fixed Hebrew sentence: no provider text, no ids, no amounts typed by anyone', () => {
    const results = [
      { status: 'declined' },
      { status: 'review' },
      { status: 'in_progress' },
      { status: 'error' },
      { status: 'refused', reason: 'disabled' },
      { status: 'refused', reason: 'invalid_amount' },
      { status: 'refused', reason: 'no_payment' },
      { status: 'refused', reason: 'exceeds_refundable' },
      { status: 'refused', reason: 'no_customer' },
      { status: 'refused', reason: 'no_card' },
      { status: 'refused', reason: 'no_document' },
      { status: 'refused', reason: 'terminal_changed' },
    ] as const;
    const messages = results.map((r) => packageRefundMessage(r));
    for (const m of messages) expect(m).toMatch(/[א-ת]/);
    expect(new Set(messages).size).toBe(messages.length); // each situation says its own thing
  });

  it('"review" tells the admin the money may already be back and not to try again', () => {
    expect(packageRefundMessage({ status: 'review' })).toContain('אל תנסו שוב');
  });

  it('no card / no customer / no document / a payment from another terminal send the admin to refund by hand', () => {
    for (const reason of ['no_card', 'no_customer', 'no_document', 'terminal_changed'] as const) {
      expect(packageRefundMessage({ status: 'refused', reason })).toContain('ידנית');
    }
  });

  it('names no clearing company: the same sentences serve every provider', () => {
    const reasons = ['disabled', 'invalid_amount', 'no_payment', 'exceeds_refundable', 'no_customer', 'no_card', 'no_document', 'terminal_changed'] as const;
    const all = [
      ...reasons.map((reason) => packageRefundMessage({ status: 'refused', reason })),
      ...(['declined', 'review', 'in_progress', 'error'] as const).map((status) => packageRefundMessage({ status })),
    ];
    for (const m of all) expect(m).not.toMatch(/sumit|cardcom|סאמיט|קארדקום/i);
  });
});

// What the admin screen says about a package BEFORE anything is approved. Four states, decided from three facts the server
// read (was the ledger readable, how much did the card pay, is there a card to send it back to), so a screen never claims
// "will be refunded" for a package that cannot be, nor "will fail" for one that has nothing to refund.
describe('packageCancellationState', () => {
  it('something was paid and there is a card: the refund goes back by itself', () => {
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: true })).toBe('refund');
  });

  it('something was paid but there is no card: an approval that has money to return is refused', () => {
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: false })).toBe('no_card');
  });

  it('nothing was paid (or it all went back already): approving moves no money, card or no card', () => {
    expect(packageCancellationState({ unreadable: false, paid: 0, hasCard: true })).toBe('nothing_to_refund');
    expect(packageCancellationState({ unreadable: false, paid: 0, hasCard: false })).toBe('nothing_to_refund');
  });

  it('the ledger could not be read: nothing is claimed about the money, even if a number is at hand', () => {
    expect(packageCancellationState({ unreadable: true, paid: null, hasCard: true })).toBe('unreadable');
    expect(packageCancellationState({ unreadable: true, paid: 120, hasCard: true })).toBe('unreadable');
  });

  it('a refund this request already made: it is being RESUMED, whatever the card or the amounts say', () => {
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: true, refundedForRequest: 105 })).toBe('resume');
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: false, refundedForRequest: 105 })).toBe('resume');
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: true, refundedForRequest: 120 })).toBe('resume');
  });

  it('an unreadable ledger still wins over a refund count that may be stale', () => {
    expect(packageCancellationState({ unreadable: true, paid: 120, hasCard: true, refundedForRequest: 105 })).toBe('unreadable');
  });

  it('no earlier refund (0 or not given) changes nothing', () => {
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: true, refundedForRequest: 0 })).toBe('refund');
    expect(packageCancellationState({ unreadable: false, paid: 120, hasCard: true, refundedForRequest: null })).toBe('refund');
  });

  it('a missing or non-numeric amount is "unreadable", never "nothing paid"', () => {
    expect(packageCancellationState({ unreadable: false, paid: null, hasCard: true })).toBe('unreadable');
    expect(packageCancellationState({ unreadable: false, paid: Number.NaN, hasCard: true })).toBe('unreadable');
  });
});

// The same sentences serve a refund through either clearing company, so none of them may name one — and every refusal a
// refund can give has a sentence (a missing one would show the admin an empty banner).
describe('packageRefundMessage: every refusal has a provider-neutral sentence', () => {
  const REASONS = ['disabled', 'invalid_amount', 'no_payment', 'exceeds_refundable', 'no_customer', 'no_card', 'no_document', 'terminal_changed'] as const;

  it.each(REASONS)('%s says what happened, that nothing was done, and names no company', (reason) => {
    const message = packageRefundMessage({ status: 'refused', reason });
    expect(message.length).toBeGreaterThan(10);
    expect(message).toContain('לא בוצעה פעולה');
    expect(message).not.toMatch(/sumit|cardcom|סאמיט|קארדקום/i);
  });

  it('a payment made on another terminal than the connection uses now says it cannot be refunded automatically and to refund by hand', () => {
    const message = packageRefundMessage({ status: 'refused', reason: 'terminal_changed' });
    expect(message).toContain('מסוף');
    expect(message).toContain('ידנית');
  });

  it.each(['declined', 'review', 'in_progress', 'error'] as const)('the %s answer names no company either', (status) => {
    expect(packageRefundMessage({ status })).not.toMatch(/sumit|cardcom|סאמיט|קארדקום/i);
  });
});
