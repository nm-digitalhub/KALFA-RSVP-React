import { describe, expect, it } from 'vitest';
import { deriveStatus, ledgerMoney, paymentBadge, refundableAmount, refundableCents, type OperationRow, type PaymentState } from './status';

const op = (kind: string, effect: OperationRow['effect'], outcome: OperationRow['outcome'], amount = 0, t = '2026-09-01T00:00:00Z', r = t, credit = 0): OperationRow =>
  ({ kind, effect, outcome, amount, credit, occurredAt: t, recordedAt: r });
const AUTH = op('authorize', 'commit', 'succeeded', 200);

describe('deriveStatus — the ledger decides, no stored state', () => {
  it('no operations → none', () => expect(deriveStatus([]).status).toBe('none'));
  it('authorize succeeded → committed 200', () =>
    expect(deriveStatus([AUTH])).toEqual({ status: 'committed', collected: 0, credit: 0, committed: 200 }));
  it('authorize → charge succeeded → collected 120 (the charge is independent of the hold)', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 120, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 120, credit: 0 }));
  it('authorize → release → released; committed stays 200', () =>
    expect(deriveStatus([AUTH, op('release', 'void', 'succeeded', 0, '2026-09-02T00:00:00Z')])).toEqual({ status: 'released', collected: 0, credit: 0, committed: 200 }));
  it('authorize → charge → release → STILL collected: releasing the guarantee returns no money', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 120, '2026-09-02T00:00:00Z'), op('release', 'void', 'succeeded', 0, '2026-09-03T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 120 }));
  it('charge failed then succeeded → collected once', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'failed', 120, '2026-09-02T00:00:00Z'), op('charge', 'collect', 'succeeded', 120, '2026-09-03T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 120 }));
  it('closed at zero with a credit: charge succeeded amount 0 → collected, collected=0 (finding 2 of the audit)', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 0, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 0 }));
  it('charge pending → pending (money in flight beats committed)', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'pending', 120, '2026-09-02T00:00:00Z')]).status).toBe('pending'));
  it('an unresolved review is NOT hidden by a later release', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'review', 120, '2026-09-02T00:00:00Z'), op('release', 'void', 'succeeded', 0, '2026-09-03T00:00:00Z')]).status).toBe('review'));
  it('review beats pending when both exist', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'review', 120, '2026-09-02T00:00:00Z'), op('release', 'void', 'pending', 0, '2026-09-03T00:00:00Z')]).status).toBe('review'));
  it('charge review → review', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'review', 120, '2026-09-02T00:00:00Z')]).status).toBe('review'));
  it('only informational rows (effect none) → none, not declined', () =>
    expect(deriveStatus([op('note', 'none', 'succeeded', 0)]).status).toBe('none'));
  it('only a failed authorize → declined', () =>
    expect(deriveStatus([op('authorize', 'commit', 'failed', 200)]).status).toBe('declined'));
  it('authorize → charge FAILED → declined, not "approved awaiting collection"; committed kept', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'failed', 120, '2026-09-02T00:00:00Z')])).toEqual({ status: 'declined', collected: 0, credit: 0, committed: 200 }));
  it('a brand-new kind with effect=collect works without code changes', () =>
    expect(deriveStatus([op('immediate_charge', 'collect', 'succeeded', 200)])).toMatchObject({ status: 'collected', collected: 200 }));
  it('charge then refund → refunded; collected nets to 0', () =>
    expect(deriveStatus([op('charge', 'collect', 'succeeded', 200), op('refund', 'return', 'succeeded', 200, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'refunded', collected: 0 }));
  it('partial refund → still collected, collected nets to 150', () =>
    expect(deriveStatus([op('charge', 'collect', 'succeeded', 200), op('refund', 'return', 'succeeded', 50, '2026-09-02T00:00:00Z')])).toMatchObject({ status: 'collected', collected: 150 }));
  it('order is by occurredAt, not array order', () =>
    expect(deriveStatus([op('release', 'void', 'succeeded', 0, '2026-09-03T00:00:00Z'), op('authorize', 'commit', 'succeeded', 200, '2026-09-01T00:00:00Z')]).status).toBe('released'));
  it('EQUAL occurredAt → recordedAt breaks the tie', () =>
    expect(deriveStatus([op('release', 'void', 'succeeded', 0, '2026-07-21T16:38:52Z', '2026-09-25T00:00:01Z'), op('authorize', 'commit', 'succeeded', 4, '2026-07-21T16:38:52Z', '2026-09-25T00:00:00Z')]).status).toBe('released'));
  it('the real closed-campaign sequence: authorize → release(+1s) → charge(0, credit) by time → collected 0', () =>
    expect(deriveStatus([op('authorize', 'commit', 'succeeded', 4, '2026-07-21T16:38:52Z'), op('release', 'void', 'succeeded', 0, '2026-07-21T16:38:53Z'), op('charge', 'collect', 'succeeded', 0, '2026-07-27T08:53:58Z')])).toEqual({ status: 'collected', collected: 0, credit: 0, committed: 4 }));
  it('authorize → charge succeeded → committed stays; a charge settled by credit alone → collected 0, credit 84', () =>
    expect(deriveStatus([AUTH, op('charge', 'collect', 'succeeded', 0, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', 84)]))
      .toEqual({ status: 'collected', collected: 0, credit: 84, committed: 200 }));
  it('a mixed charge: 150 collected and 50 by credit → both are counted', () =>
    expect(deriveStatus([op('charge', 'collect', 'succeeded', 150, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', 50)]))
      .toMatchObject({ status: 'collected', collected: 150, credit: 50 }));
  it('credit of two successful collects adds up (purchase + upgrade)', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 100, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', 20),
      op('package_upgrade', 'collect', 'succeeded', 60, '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z', 10),
    ])).toMatchObject({ collected: 160, credit: 30 }));
  it('a FAILED collect never counts its credit', () =>
    expect(deriveStatus([op('charge', 'collect', 'failed', 150, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', 50)]))
      .toMatchObject({ status: 'declined', collected: 0, credit: 0 }));
  it('a refund lowers collected and leaves the credit alone (credit is not money that came back to the card)', () =>
    expect(deriveStatus([
      op('charge', 'collect', 'succeeded', 150, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', 50),
      op('refund', 'return', 'succeeded', 150, '2026-09-03T00:00:00Z'),
    ])).toMatchObject({ status: 'refunded', collected: 0, credit: 50 }));
  it('an in-flight collect keeps its credit out of the settled total until it succeeds', () =>
    expect(deriveStatus([op('charge', 'collect', 'pending', 150, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z', 50)]))
      .toMatchObject({ status: 'pending', credit: 0 }));
  // The fixed-price package (docs/superpowers/plans/2026-10-04-package-payment-plan.md Task 4): two kinds that are plain
  // 'collect' rows, so no code change is needed — which is the point of a registry.
  it('package purchase succeeded → collected for the package price', () =>
    expect(deriveStatus([op('package_purchase', 'collect', 'succeeded', 120)])).toMatchObject({ status: 'collected', collected: 120 }));
  it('purchase then a successful upgrade → collected sums both', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('package_upgrade', 'collect', 'succeeded', 80, '2026-09-02T00:00:00Z'),
    ])).toMatchObject({ status: 'collected', collected: 200 }));
  it('a FAILED upgrade changes nothing: still collected at the purchase amount', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('package_upgrade', 'collect', 'failed', 80, '2026-09-02T00:00:00Z'),
    ])).toMatchObject({ status: 'collected', collected: 120 }));
  it('an upgrade in flight beats the settled state (money may be moving)', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('package_upgrade', 'collect', 'pending', 80, '2026-09-02T00:00:00Z'),
    ]).status).toBe('pending'));
  it('purchase fully refunded → refunded; collected nets to 0', () =>
    expect(deriveStatus([
      op('package_purchase', 'collect', 'succeeded', 120),
      op('refund', 'return', 'succeeded', 120, '2026-09-02T00:00:00Z'),
    ])).toMatchObject({ status: 'refunded', collected: 0 }));
});

// How much can still go back to the card: what the card actually paid (the credit part never reached it) minus every
// return that has not failed — a refund still pending or in review may already have moved the money.
describe('refundableAmount', () => {
  it('nothing recorded → nothing to refund', () => {
    expect(refundableAmount([])).toBe(0);
  });
  it('a paid package is refundable for what reached the card', () => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 120)])).toBe(120);
  });
  it('the credit part is not refundable to the card: only `amount` counts', () => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 70, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 30)])).toBe(70);
  });
  it('a purchase and an upgrade add up', () => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 120), op('package_upgrade', 'collect', 'succeeded', 80, '2026-09-02T00:00:00Z')])).toBe(200);
  });
  it('a collect that failed, is pending or is in review is not money on the card yet', () => {
    expect(refundableAmount([op('c', 'collect', 'failed', 120)])).toBe(0);
    expect(refundableAmount([op('c', 'collect', 'pending', 120)])).toBe(0);
    expect(refundableAmount([op('c', 'collect', 'review', 120)])).toBe(0);
  });
  it('a succeeded return is taken off', () => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 120), op('refund', 'return', 'succeeded', 50, '2026-09-02T00:00:00Z')])).toBe(70);
  });
  it.each(['pending', 'review'] as const)('a return that is %s is taken off too — it may already have moved the money', (outcome) => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 120), op('refund', 'return', outcome, 50, '2026-09-02T00:00:00Z')])).toBe(70);
  });
  it('a return that failed is not taken off', () => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 120), op('refund', 'return', 'failed', 50, '2026-09-02T00:00:00Z')])).toBe(120);
  });
  it('never negative, and rounded to whole agorot', () => {
    expect(refundableAmount([op('package_purchase', 'collect', 'succeeded', 10), op('refund', 'return', 'succeeded', 25, '2026-09-02T00:00:00Z')])).toBe(0);
    expect(refundableAmount([op('c', 'collect', 'succeeded', 0.3), op('r', 'return', 'succeeded', 0.1, '2026-09-02T00:00:00Z')])).toBe(0.2);
  });
  it('refundableCents is the same sum in agorot, NOT floored: more returned than collected is negative', () => {
    expect(refundableCents([op('package_purchase', 'collect', 'succeeded', 120), op('refund', 'return', 'pending', 100, '2026-09-02T00:00:00Z'), op('refund', 'return', 'succeeded', 100, '2026-09-03T00:00:00Z')])).toBe(-8000);
    expect(refundableCents([op('package_purchase', 'collect', 'succeeded', 120)])).toBe(12000);
  });
  it('holds, releases and informational rows move no card money', () => {
    expect(refundableAmount([AUTH, op('release', 'void', 'succeeded', 0, '2026-09-02T00:00:00Z'), op('note', 'none', 'succeeded', 5)])).toBe(0);
  });
});

// Test money (a payment opened on a no-money terminal) is a property of the SETTLED money, decided by the database when each row is
// born. It is only ever added to a state when true, so every state of real money keeps exactly the shape the rest of the code and its
// tests were written against.
describe('deriveStatus — testMoney', () => {
  const t = (kind: string, effect: OperationRow['effect'], outcome: OperationRow['outcome'], amount: number, at: string, isTest?: boolean): OperationRow =>
    ({ ...op(kind, effect, outcome, amount, at), ...(isTest === undefined ? {} : { isTest }) });
  const D1 = '2026-10-01T00:00:00Z';
  const D2 = '2026-10-02T00:00:00Z';

  it('rows that say nothing about their class are real money: no testMoney key at all', () => {
    const state = deriveStatus([op('package_purchase', 'collect', 'succeeded', 100)]);
    expect(state).toEqual({ status: 'collected', collected: 100, credit: 0, committed: 0 });
    expect('testMoney' in state).toBe(false);
  });
  it('rows explicitly marked real (isTest false) keep the same shape', () => {
    expect('testMoney' in deriveStatus([t('package_purchase', 'collect', 'succeeded', 100, D1, false)])).toBe(false);
  });
  it('a succeeded test collect is test money', () => {
    expect(deriveStatus([t('package_purchase', 'collect', 'succeeded', 100, D1, true)])).toEqual({ status: 'collected', collected: 100, credit: 0, committed: 0, testMoney: true });
  });
  it('a test collect and its test refund are still test money (status refunded)', () => {
    expect(deriveStatus([t('package_purchase', 'collect', 'succeeded', 100, D1, true), t('refund', 'return', 'succeeded', 100, D2, true)])).toEqual({ status: 'refunded', collected: 0, credit: 0, committed: 0, testMoney: true });
  });
  it('one real succeeded collect among test ones makes the whole thing real', () => {
    const state = deriveStatus([t('package_purchase', 'collect', 'succeeded', 100, D1, true), t('package_upgrade', 'collect', 'succeeded', 50, D2, false)]);
    expect(state.status).toBe('collected');
    expect('testMoney' in state).toBe(false);
  });
  it('a real collect that was refunded is not test money', () => {
    expect('testMoney' in deriveStatus([t('package_purchase', 'collect', 'succeeded', 100, D1), t('refund', 'return', 'succeeded', 100, D2)])).toBe(false);
  });
  it('a test row that has not settled (pending, review, failed) is no settled money at all', () => {
    for (const outcome of ['pending', 'review', 'failed'] as const) {
      expect('testMoney' in deriveStatus([t('package_purchase', 'collect', outcome, 100, D1, true)])).toBe(false);
    }
  });
  it('a hold (commit) and informational rows do not count as money, test or not', () => {
    expect('testMoney' in deriveStatus([t('authorize', 'commit', 'succeeded', 200, D1, true), t('note', 'none', 'succeeded', 0, D2, true)])).toBe(false);
  });
  it('a test purchase followed by an unresolved row keeps the in-flight status and still says the settled money was test', () => {
    expect(deriveStatus([t('package_purchase', 'collect', 'succeeded', 100, D1, true), t('refund', 'return', 'pending', 100, D2, true)])).toMatchObject({ status: 'pending', testMoney: true });
  });
});

describe('paymentBadge — never the word תפוס', () => {
  const st = (status: PaymentState['status'], collected = 0, credit = 0): PaymentState => ({ status, collected, credit, committed: 0 });
  it.each([
    ['none', 0, 0, null],
    ['pending', 0, 0, 'בתהליך'],
    ['review', 0, 0, 'נדרשת בדיקה ידנית'],
    ['declined', 0, 0, 'נדחה'],
    ['committed', 0, 0, 'אושר — ממתין לגבייה'],
    ['collected', 120, 0, 'נגבה'],
    ['collected', 150, 50, 'נגבה'],
    ['collected', 0, 0, 'נסגר ללא חיוב'],
    ['collected', 0, 84, 'שולם מיתרת זיכוי'],
    ['released', 0, 0, 'שוחרר ללא גבייה'],
    ['refunded', 0, 0, 'הוחזר'],
  ] as const)('%s / collected %s / credit %s → %s', (status, collected, credit, label) => {
    const b = paymentBadge(st(status, collected, credit));
    expect(b?.label ?? null).toBe(label);
    if (b) expect(b.label).not.toContain('תפוס');
  });
});

describe('ledgerMoney — paid and refunded, each from succeeded rows, by effect', () => {
  const T2 = '2026-09-02T00:00:00Z';
  it('no rows → nothing paid, nothing refunded, nothing in flight', () =>
    expect(ledgerMoney([])).toEqual({ paid: 0, refunded: 0, inFlight: null, testMoney: false }));
  it('a hold (commit) is not a payment, and a release returns nothing', () =>
    expect(ledgerMoney([AUTH, op('release', 'void', 'succeeded', 0, T2)])).toEqual({ paid: 0, refunded: 0, inFlight: null, testMoney: false }));
  it('a package purchase and a partial refund: both shown, never netted', () =>
    expect(ledgerMoney([op('package_purchase', 'collect', 'succeeded', 105), op('refund', 'return', 'succeeded', 1, T2)])).toMatchObject({ paid: 105, refunded: 1 }));
  it('a kind the code never named is counted by its effect', () =>
    expect(ledgerMoney([op('some_future_kind', 'collect', 'succeeded', 40)]).paid).toBe(40));
  it('failed rows count for nothing', () =>
    expect(ledgerMoney([op('package_purchase', 'collect', 'failed', 105), op('refund', 'return', 'failed', 5, T2)])).toEqual({ paid: 0, refunded: 0, inFlight: null, testMoney: false }));
  it.each(['pending', 'review'] as const)('a %s row is in flight and not counted yet', (outcome) =>
    expect(ledgerMoney([op('package_purchase', 'collect', 'succeeded', 105), op('refund', 'return', outcome, 5, T2)])).toEqual({ paid: 105, refunded: 0, inFlight: outcome, testMoney: false }));
  it('review beats pending', () =>
    expect(ledgerMoney([op('charge', 'collect', 'pending', 5), op('refund', 'return', 'review', 5, T2)]).inFlight).toBe('review'));
  it('sums in whole agorot', () =>
    expect(ledgerMoney([0.1, 0.1, 0.1].map((a) => op('charge', 'collect', 'succeeded', a))).paid).toBe(0.3));
  it('test money: only when every settled collect/return is a test row', () => {
    const test = { ...op('package_purchase', 'collect', 'succeeded', 1), isTest: true };
    expect(ledgerMoney([test]).testMoney).toBe(true);
    expect(ledgerMoney([test, op('charge', 'collect', 'succeeded', 5, T2)]).testMoney).toBe(false);
  });
});
