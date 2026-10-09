import { describe, expect, it } from 'vitest';

import { Constants } from '@/lib/supabase/types';

import { formatAmount } from '@/lib/format';

import { CUSTOMER_OUTCOMES, OPERATION_OUTCOME_LABELS, ledgerMoneyParts } from './operation-labels';

describe('operation outcome labels', () => {
  it('every outcome of the database enum has a Hebrew label', () => {
    for (const o of Constants.public.Enums.payment_operation_outcome) expect(OPERATION_OUTCOME_LABELS[o].label).not.toBe('');
  });

  it('a customer is shown every outcome except a failed attempt', () => {
    expect([...CUSTOMER_OUTCOMES].sort()).toEqual(['pending', 'review', 'succeeded']);
  });
});

describe('ledgerMoneyParts', () => {
  const none = { paid: 0, refunded: 0, inFlight: null, testMoney: false } as const;

  it('nothing recorded → nothing to say', () => expect(ledgerMoneyParts(none)).toEqual([]));
  it('paid and refunded, each on its own', () =>
    expect(ledgerMoneyParts({ ...none, paid: 105, refunded: 1 })).toEqual([`סכום ששולם ${formatAmount(105)}`, `סכום שהוחזר ${formatAmount(1)}`]));
  it('an unresolved row is named by its outcome', () =>
    expect(ledgerMoneyParts({ ...none, paid: 105, inFlight: 'review' })).toEqual([`סכום ששולם ${formatAmount(105)}`, 'בבדיקה']));
  it('test money says so, so nobody reads it as revenue', () =>
    expect(ledgerMoneyParts({ ...none, paid: 1, testMoney: true })).toEqual(['[בדיקה]', `סכום ששולם ${formatAmount(1)}`]));
});
