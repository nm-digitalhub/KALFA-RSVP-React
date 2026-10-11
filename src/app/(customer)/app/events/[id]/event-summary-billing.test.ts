import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@/lib/format';

import { summaryBillingRows } from './event-summary';

// The closed event's billing summary shows a row only when the record holds it: what the ledger recorded, and the quota.
describe('summaryBillingRows', () => {
  it('a package: what the ledger recorded and the quota, never ₪0 fees or "בעיבוד"', () => {
    const rows = summaryBillingRows({ paid: 1, refunded: 1, inFlight: null, testMoney: false }, false, { quota: 1, used: 1 });
    expect(rows).toEqual([
      { label: 'שולם', value: formatCurrency(1) },
      { label: 'הוחזר', value: formatCurrency(1) },
      { label: 'מכסת אנשי קשר', value: '1 מתוך 1' },
    ]);
  });

  it('an unresolved payment is named by its outcome', () => {
    const rows = summaryBillingRows({ paid: 200, refunded: 0, inFlight: 'review', testMoney: false }, false, null);
    expect(rows).toContainEqual({ label: 'תשלום פתוח', value: 'בבדיקה' });
  });

  it('an unreadable ledger says so', () => {
    expect(summaryBillingRows(null, true, null)).toEqual([{ label: 'תשלומים', value: 'לא ניתן לטעון כרגע' }]);
  });

  it('nothing recorded → no rows, so the section is not shown', () => {
    expect(summaryBillingRows({ paid: 0, refunded: 0, inFlight: null, testMoney: false }, false, null)).toEqual([]);
  });
});
