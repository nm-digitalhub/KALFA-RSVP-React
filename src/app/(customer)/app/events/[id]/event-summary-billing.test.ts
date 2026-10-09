import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@/lib/format';

import { summaryBillingRows } from './event-summary';

// The closed event's billing summary shows a row only when the campaign's own record holds it. The two shapes are the
// live campaigns of 9.10.2026: a ₪1 package that was refunded (c94ae98e) and a base + per-reached campaign that closed
// with nothing to charge (39334087).
const PACKAGE = {
  chargesPerReached: false,
  basePrice: 0,
  includedReached: 0,
  pricePerReached: 0,
  finalChargeAmount: null,
  creditApplied: 0,
  chargeStatus: null,
};
const PER_REACHED = {
  chargesPerReached: true,
  basePrice: 200,
  includedReached: 200,
  pricePerReached: 4,
  finalChargeAmount: 0,
  creditApplied: 200,
  chargeStatus: 'nothing_to_charge',
};

describe('summaryBillingRows', () => {
  it('a package: what the ledger recorded and the quota, never ₪0 fees or "בעיבוד"', () => {
    const rows = summaryBillingRows(PACKAGE, { paid: 1, refunded: 1, inFlight: null, testMoney: false }, false, { quota: 1, used: 1 });
    expect(rows).toEqual([
      { label: 'שולם', value: formatCurrency(1) },
      { label: 'הוחזר', value: formatCurrency(1) },
      { label: 'מכסת אנשי קשר', value: '1 מתוך 1' },
    ]);
  });

  it('a per-reached campaign keeps its terms and its settled ₪0 final charge, which is a real fact', () => {
    const labels = summaryBillingRows(PER_REACHED, { paid: 0, refunded: 0, inFlight: null, testMoney: false }, false, null).map((r) => r.label);
    expect(labels).toEqual(['דמי הפעלה', 'מכסה כלולה', 'עלות לכל מענה נוסף', 'חיוב סופי', 'זיכוי שקוזז', 'מצב החיוב הסופי']);
  });

  it('an unresolved payment is named by its outcome', () => {
    const rows = summaryBillingRows(PACKAGE, { paid: 200, refunded: 0, inFlight: 'review', testMoney: false }, false, null);
    expect(rows).toContainEqual({ label: 'תשלום פתוח', value: 'בבדיקה' });
  });

  it('an unreadable ledger says so', () => {
    expect(summaryBillingRows(PACKAGE, null, true, null)).toEqual([{ label: 'תשלומים', value: 'לא ניתן לטעון כרגע' }]);
  });

  it('nothing recorded → no rows, so the section is not shown', () => {
    expect(summaryBillingRows(PACKAGE, { paid: 0, refunded: 0, inFlight: null, testMoney: false }, false, null)).toEqual([]);
  });
});
