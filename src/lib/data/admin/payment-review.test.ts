import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('./access-log', () => ({ recordStaffAccess: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/data/sumit-customers', () => ({ getSumitCustomerId: vi.fn() }));
vi.mock('@/lib/sumit/probe', () => ({ probeSumitCharge: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getSumitServerConfig } from '@/lib/data/payments';
import { getSumitCustomerId } from '@/lib/data/sumit-customers';
import { createAdminClient } from '@/lib/supabase/admin';
import { probeSumitCharge, type ProbeResult } from '@/lib/sumit/probe';
import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';

import { TERMINAL_CONFLICT_NOTICE } from '@/lib/payments/terminal-conflict-copy';

import { recordStaffAccess } from './access-log';
import {
  listPaymentReviews,
  PaymentReviewError,
  probePaymentReview,
  reportedTerminalConflicts,
  resolvePaymentReview,
  resolvePaymentReviewSchema,
} from './payment-review';

// A payment operation in `review` means "SUMIT may or may not have charged": the process died mid-call, or SUMIT's
// answer was unclear. Nothing retries it. Only a staff member who has checked SUMIT closes it — and only from `review`.

const STAFF = { id: 'staff-1' };
const OP = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const OWNER = '44444444-4444-4444-8444-444444444444';

const reviewRow = (over: TableRow = {}): TableRow => ({
  id: OP,
  campaign_id: CAMPAIGN,
  event_id: EVENT,
  kind: 'package_purchase',
  outcome: 'review',
  amount: 120,
  recorded_at: '2026-10-05T10:00:00Z',
  note: 'orphaned: process died mid-flight (sweep 2026-10-05T10:20:00.000Z)',
  meta: { payerUserId: 'payer-1' },
  payment_operation_kinds: { label_he: 'רכישת חבילה', effect: 'collect' },
  events: { name: 'החתונה של דנה', owner_id: OWNER },
  ...over,
});

function wire(rows: TableRow[], lines: TableRow[] = []) {
  const db = createFakeTableClient({ payment_operations: rows, payment_operation_lines: lines });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
  return db;
}

beforeEach(() => {
  // reset, not clear: a rejection armed by one test ("audit down") must not leak into the next.
  vi.resetAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(STAFF as never);
  vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 7, apiKey: 'k' } as never);
  vi.mocked(getSumitCustomerId).mockResolvedValue(2127277236);
  vi.mocked(probeSumitCharge).mockResolvedValue({ kind: 'not_found' });
});

describe('listPaymentReviews', () => {
  it('needs billing authority', async () => {
    wire([]);
    await listPaymentReviews();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
  });

  it('lists only operations in review, oldest first, with the kind label and the event name', async () => {
    wire([
      reviewRow({ id: 'late', recorded_at: '2026-10-05T12:00:00Z' }),
      reviewRow({ id: 'ok', outcome: 'succeeded' }),
      reviewRow({ id: 'pend', outcome: 'pending' }),
      reviewRow({ id: 'early', recorded_at: '2026-10-05T09:00:00Z' }),
    ]);
    const items = await listPaymentReviews();
    expect(items.map((i) => i.operationId)).toEqual(['early', 'late']);
    expect(items[0]).toMatchObject({
      campaignId: CAMPAIGN,
      eventId: EVENT,
      eventName: 'החתונה של דנה',
      kindLabel: 'רכישת חבילה',
      amount: 120,
    });
  });

  it('a read failure is thrown, never shown as "nothing to review"', async () => {
    const db = wire([]);
    db.fail('payment_operations', '57014', 'select');
    await expect(listPaymentReviews()).rejects.toThrow();
  });
});

describe('probePaymentReview', () => {
  it('records the staff access BEFORE it asks the provider anything', async () => {
    wire([reviewRow()]);
    const order: string[] = [];
    vi.mocked(recordStaffAccess).mockImplementation(async () => {
      order.push('audit');
    });
    vi.mocked(probeSumitCharge).mockImplementation(async () => {
      order.push('probe');
      return { kind: 'not_found' };
    });
    await probePaymentReview(OP);
    expect(order).toEqual(['audit', 'probe']);
    expect(recordStaffAccess).toHaveBeenCalledWith({
      staffId: 'staff-1',
      permission: 'manage_billing',
      subjectType: 'campaign',
      subjectId: CAMPAIGN,
      ownerId: OWNER,
      eventId: EVENT,
    });
  });

  it("asks about the operation's amount and time, under the customer number of whoever paid", async () => {
    wire([reviewRow()]);
    await probePaymentReview(OP);
    expect(getSumitCustomerId).toHaveBeenCalledWith('payer-1');
    expect(probeSumitCharge).toHaveBeenCalledWith({
      companyId: 7,
      apiKey: 'k',
      recordedAt: '2026-10-05T10:00:00Z',
      amount: 120,
      customerId: 2127277236,
    });
  });

  it('returns what the provider answered', async () => {
    wire([reviewRow()]);
    const answer: ProbeResult = { kind: 'found', matches: [{ paymentId: 1, date: null, amount: 120, authNumber: '0759469', customerId: 2127277236 }] };
    vi.mocked(probeSumitCharge).mockResolvedValue(answer);
    expect(await probePaymentReview(OP)).toEqual(answer);
  });

  it('an operation that is not waiting for a decision is refused — nothing is asked, nothing is audited', async () => {
    wire([reviewRow({ outcome: 'succeeded' })]);
    await expect(probePaymentReview(OP)).rejects.toThrow('הפעולה אינה ממתינה להכרעה');
    expect(probeSumitCharge).not.toHaveBeenCalled();
  });

  it('only a payment that TAKES money can be looked up in the provider list', async () => {
    wire([reviewRow({ payment_operation_kinds: { label_he: 'החזר', effect: 'return' } })]);
    expect(await probePaymentReview(OP)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(probeSumitCharge).not.toHaveBeenCalled();
  });

  it('without provider configuration the answer is "unavailable", not "no payment"', async () => {
    wire([reviewRow()]);
    vi.mocked(getSumitServerConfig).mockResolvedValue(null);
    expect(await probePaymentReview(OP)).toEqual({ kind: 'unavailable', reason: 'credentials' });
  });

  it('a failed audit write cancels the lookup (fail closed)', async () => {
    wire([reviewRow()]);
    vi.mocked(recordStaffAccess).mockRejectedValue(new Error('audit down'));
    await expect(probePaymentReview(OP)).rejects.toThrow('audit down');
    expect(probeSumitCharge).not.toHaveBeenCalled();
  });
});

describe('resolvePaymentReview', () => {
  const NOTE = 'נבדק ב-SUMIT: החיוב בוצע, קבלה 40106';

  it('confirms a charge: closes the row from REVIEW with the receipt number, keeps the earlier note, audits, alerts', async () => {
    const db = wire([reviewRow()]);

    const result = await resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 40106, note: NOTE });

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(db.rows('payment_operations')[0]).toMatchObject({
      outcome: 'succeeded',
      amount: 120,
      provider_document_id: null,
      provider_document_number: 40106,
    });
    const note = String(db.rows('payment_operations')[0].note);
    expect(note).toContain('orphaned');
    expect(note).toContain(NOTE);
    expect(recordStaffAccess).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith({
      eventId: EVENT,
      action: 'payment.review_resolved',
      meta: { operationId: OP, campaignId: CAMPAIGN, outcome: 'succeeded' },
    });
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
  });

  it('the amount actually charged can differ from the one we intended, and wins', async () => {
    const db = wire([reviewRow()]);
    await resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 40106, amount: 100, note: NOTE });
    expect(db.rows('payment_operations')[0].amount).toBe(100);
  });

  describe('an operation that has lines (the price is itemised and the lines cannot change)', () => {
    const LINES = [{ operation_id: OP, line_no: 1, description: 'חבילה', quantity: 1, unit_price: 120 }];

    it('an amount different from the lines is refused in plain words — nothing is written, the row stays in review', async () => {
      const db = wire([reviewRow()], LINES);
      const attempt = resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 40106, amount: 100, note: NOTE });
      await expect(attempt).rejects.toBeInstanceOf(PaymentReviewError);
      await expect(attempt).rejects.toThrow('הסכום שהוזן שונה מפירוט הפעולה');
      expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'review', amount: 120 });
    });

    it('confirming with no amount, or with the amount the lines already say, is accepted', async () => {
      const blank = wire([reviewRow()], LINES);
      await resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 40106, note: NOTE });
      expect(blank.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', amount: 120 });
      const same = wire([reviewRow()], LINES);
      await resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 40106, amount: 120, note: NOTE });
      expect(same.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', amount: 120 });
    });

    it('marking it failed is never held up by its lines', async () => {
      const db = wire([reviewRow()], LINES);
      await resolvePaymentReview({ operationId: OP, outcome: 'failed', note: 'נבדק ב-SUMIT: לא נמצא חיוב' });
      expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'failed' });
    });

    it('a failure to look the lines up stops the decision instead of guessing', async () => {
      const db = wire([reviewRow()], LINES);
      db.fail('payment_operation_lines', '57P01', 'select');
      await expect(resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 40106, amount: 100, note: NOTE })).rejects.toBeInstanceOf(PaymentReviewError);
      expect(db.rows('payment_operations')[0].outcome).toBe('review');
    });
  });

  it('marks a payment as failed without needing a receipt, and leaves the amount alone', async () => {
    const db = wire([reviewRow()]);
    await resolvePaymentReview({ operationId: OP, outcome: 'failed', note: 'נבדק ב-SUMIT: לא נמצא חיוב' });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'failed', amount: 120 });
  });

  it('confirming a charge without a receipt number is refused before anything is written', async () => {
    const db = wire([reviewRow()]);
    await expect(resolvePaymentReview({ operationId: OP, outcome: 'succeeded', note: NOTE })).rejects.toThrow();
    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(recordStaffAccess).not.toHaveBeenCalled();
  });

  it('a decision needs a real reason', async () => {
    wire([reviewRow()]);
    await expect(resolvePaymentReview({ operationId: OP, outcome: 'failed', note: 'בסדר' })).rejects.toThrow();
  });

  it('a row that is still pending — or already decided — cannot be closed by an admin', async () => {
    for (const outcome of ['pending', 'succeeded', 'failed']) {
      const db = wire([reviewRow({ outcome })]);
      await expect(resolvePaymentReview({ operationId: OP, outcome: 'failed', note: NOTE })).rejects.toThrow('הפעולה אינה ממתינה להכרעה');
      expect(db.rows('payment_operations')[0].outcome).toBe(outcome);
    }
  });

  it('an unknown operation is a clear error', async () => {
    wire([]);
    await expect(resolvePaymentReview({ operationId: OP, outcome: 'failed', note: NOTE })).rejects.toThrow('פעולת התשלום לא נמצאה');
  });

  it('a failed audit write means NO write to the ledger (fail closed)', async () => {
    const db = wire([reviewRow()]);
    vi.mocked(recordStaffAccess).mockRejectedValue(new Error('audit down'));
    await expect(resolvePaymentReview({ operationId: OP, outcome: 'failed', note: NOTE })).rejects.toThrow('audit down');
    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('losing the race to another admin is reported in plain words, not as a database error', async () => {
    const db = wire([reviewRow()]);
    // Between our read and our update, someone else decides.
    const real = db.client.from;
    let reads = 0;
    db.client.from = (table: string) => {
      const builder = real(table);
      reads += 1;
      if (reads === 1) return builder; // the read
      db.rows('payment_operations')[0].outcome = 'failed'; // the other admin gets there first
      return builder;
    };
    await expect(resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 1, note: NOTE })).rejects.toThrow(
      'הפעולה כבר הוכרעה',
    );
  });

  it('the staff member needs billing authority', async () => {
    wire([reviewRow()]);
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('NEXT_FORBIDDEN'));
    await expect(resolvePaymentReview({ operationId: OP, outcome: 'failed', note: NOTE })).rejects.toThrow('NEXT_FORBIDDEN');
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
  });
});

describe('messages that are safe to show to the staff member', () => {
  it('the expected refusals and the generic load failure are PaymentReviewError: fixed Hebrew sentences with no details', async () => {
    wire([]);
    const notFound = await resolvePaymentReview({ operationId: OP, outcome: 'failed', note: 'נבדק ב-SUMIT: לא נמצא חיוב' }).catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(PaymentReviewError);

    wire([reviewRow({ outcome: 'succeeded' })]);
    const notInReview = await probePaymentReview(OP).catch((e: unknown) => e);
    expect(notInReview).toBeInstanceOf(PaymentReviewError);

    const db = wire([reviewRow()]);
    db.fail('payment_operations', '57014', 'select');
    const loadFailed = await listPaymentReviews().catch((e: unknown) => e);
    expect(loadFailed).toBeInstanceOf(PaymentReviewError);
  });

  it('every validation message is in Hebrew — none of Zod\'s English defaults reaches the screen', () => {
    const bad = [
      { operationId: 'not-a-uuid', outcome: 'failed', note: 'נבדק ב-SUMIT: לא נמצא חיוב' },
      { operationId: OP, outcome: 'maybe', note: 'נבדק ב-SUMIT: לא נמצא חיוב' },
      { operationId: OP, outcome: 'succeeded', documentNumber: -3, note: 'נבדק ב-SUMIT: חויב' },
      { operationId: OP, outcome: 'succeeded', documentNumber: 1.5, note: 'נבדק ב-SUMIT: חויב' },
      { operationId: OP, outcome: 'succeeded', documentNumber: Number.NaN, note: 'נבדק ב-SUMIT: חויב' },
      { operationId: OP, outcome: 'failed', amount: -1, note: 'נבדק ב-SUMIT: לא נמצא חיוב' },
      { operationId: OP, outcome: 'failed', amount: Number.NaN, note: 'נבדק ב-SUMIT: לא נמצא חיוב' },
      { operationId: OP, outcome: 'failed', note: 'קצר' },
      { operationId: OP, outcome: 'failed' },
      { operationId: OP, outcome: 'succeeded', note: 'נבדק ב-SUMIT: חויב' },
    ];
    for (const input of bad) {
      const result = resolvePaymentReviewSchema.safeParse(input);
      expect(result.success, JSON.stringify(input)).toBe(false);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        expect(issue.message, `${issue.path.join('.')}: ${issue.message}`).toMatch(/[\u0590-\u05FF]/);
      }
    }
  });
});

// A CardCom payment in review is checked in CardCom's own panel, never in SUMIT's list: "not found" in SUMIT would read as "no
// payment" about money that lives elsewhere. The queue shows where the payment was opened and where CardCom says it went, and the
// server refuses to approve a payment CardCom places on another terminal than the one it was opened on.
describe('CardCom rows in the review queue', () => {
  const cardcomRow = (over: TableRow = {}): TableRow =>
    reviewRow({
      provider: 'cardcom', provider_terminal: 1001, provider_terminal_echo: null, is_test: false,
      provider_document_id: 9001, provider_document_number: 77, provider_document_url: 'https://cardcom.example/doc/77',
      provider_auth_ref: '0123456', provider_payment_id: 555,
      meta: { provider: 'cardcom', payerUserId: 'payer-1' },
      ...over,
    });

  it('lists the provider, the class, both terminals and the references a person finds the payment by', async () => {
    wire([cardcomRow({ provider_terminal: 1000, provider_terminal_echo: 1001, is_test: true })]);
    const [item] = await listPaymentReviews();
    expect(item).toMatchObject({
      provider: 'cardcom', isTest: true, terminalOpenedOn: 1000, terminalReported: 1001,
      documentNumber: 77, authRef: '0123456', paymentId: 555,
    });
  });

  it('says "not reported" as null, never as a made-up number', async () => {
    wire([cardcomRow({ provider_terminal_echo: null, provider_document_number: null, provider_auth_ref: null, provider_payment_id: null })]);
    const [item] = await listPaymentReviews();
    expect(item).toMatchObject({ terminalReported: null, documentNumber: null, authRef: null, paymentId: null });
  });

  it('a CardCom payment recorded before the provider column was set is recognised by its meta', async () => {
    wire([reviewRow({ provider: 'sumit', meta: { provider: 'cardcom', payerUserId: 'payer-1' } })]);
    const [item] = await listPaymentReviews();
    expect(item.provider).toBe('cardcom');
  });

  it('a SUMIT row stays SUMIT, with no terminal and no reference it does not have', async () => {
    wire([reviewRow()]);
    const [item] = await listPaymentReviews();
    expect(item).toMatchObject({ provider: 'sumit', isTest: false, terminalOpenedOn: null, terminalReported: null, documentNumber: null, authRef: null, paymentId: null });
  });

  it('is never looked up in SUMIT: the answer is "unsupported", SUMIT is not asked, and the access is still audited first', async () => {
    wire([cardcomRow()]);
    expect(await probePaymentReview(OP)).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    expect(probeSumitCharge).not.toHaveBeenCalled();
    expect(getSumitServerConfig).not.toHaveBeenCalled();
    expect(recordStaffAccess).toHaveBeenCalledTimes(1);
  });

  describe('approving it as a collection', () => {
    const approve = () => resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 77, note: 'נבדק בלוח של CardCom: החיוב בוצע, מסמך 77' });

    it('is refused when CardCom reports ANOTHER terminal than the one it was opened on: nothing is written, nothing is audited as decided', async () => {
      const db = wire([cardcomRow({ provider_terminal: 1000, provider_terminal_echo: 1001 })]);
      const attempt = approve();
      await expect(attempt).rejects.toBeInstanceOf(PaymentReviewError);
      await expect(attempt).rejects.toThrow('המסוף ש-CardCom דיווחה שונה');
      expect(db.rows('payment_operations')[0].outcome).toBe('review');
      expect(logActivity).not.toHaveBeenCalled();
      expect(sendSlackAlert).not.toHaveBeenCalled();
    });

    it('the refusal is the one shared notice - the same words the card shows - including what to do with money that was really taken', async () => {
      wire([cardcomRow({ provider_terminal: 1000, provider_terminal_echo: 1001 })]);
      await expect(approve()).rejects.toThrow(TERMINAL_CONFLICT_NOTICE);
      // Return a charge in CardCom BEFORE marking failed: after "failed" the customer can pay again and the system cannot refund that row.
      expect(TERMINAL_CONFLICT_NOTICE.indexOf('להחזיר אותו ידנית בלוח של CardCom')).toBeGreaterThan(-1);
      expect(TERMINAL_CONFLICT_NOTICE.indexOf('להחזיר אותו ידנית בלוח של CardCom')).toBeLessThan(TERMINAL_CONFLICT_NOTICE.indexOf('סמנו ככושלת'));
    });

    it('is allowed when CardCom reports the same terminal', async () => {
      const db = wire([cardcomRow({ provider_terminal_echo: 1001 })]);
      await expect(approve()).resolves.toEqual({ outcome: 'succeeded' });
      expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'succeeded', provider_document_number: 77 });
    });

    it('is allowed when CardCom reported none (a person checks the panel and says what they found)', async () => {
      wire([cardcomRow({ provider_terminal_echo: null })]);
      await expect(approve()).resolves.toEqual({ outcome: 'succeeded' });
    });

    it('is allowed for a row with no recorded terminal: there is nothing to conflict with', async () => {
      // From before the stamp existed: provider 'sumit' (the default) with the CardCom marker in the meta.
      wire([cardcomRow({ provider: 'sumit', provider_terminal: null, provider_terminal_echo: 1000 })]);
      await expect(approve()).resolves.toEqual({ outcome: 'succeeded' });
    });

    // The row already holds the document CardCom gave (id, number and the link). Confirming the SAME number must not wipe the link or
    // the id; a completed row is frozen, so whatever is written here can never be put back.
    it('confirming the document number the row already holds keeps its id and its link exactly as they are', async () => {
      const db = wire([cardcomRow()]);
      await approve();
      expect(db.rows('payment_operations')[0]).toMatchObject({
        outcome: 'succeeded', provider_document_id: 9001, provider_document_number: 77, provider_document_url: 'https://cardcom.example/doc/77',
      });
    });

    it('a DIFFERENT document number replaces the document - and the old link, which belongs to the old document, goes with it', async () => {
      const db = wire([cardcomRow()]);
      await resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 78, note: 'נבדק בלוח של CardCom: המסמך הנכון הוא 78' });
      expect(db.rows('payment_operations')[0]).toMatchObject({
        outcome: 'succeeded', provider_document_id: null, provider_document_number: 78, provider_document_url: null,
      });
    });

    it('a row that holds no document yet gets the number a person read off the panel', async () => {
      const db = wire([cardcomRow({ provider_document_id: null, provider_document_number: null, provider_document_url: null })]);
      await approve();
      expect(db.rows('payment_operations')[0]).toMatchObject({
        outcome: 'succeeded', provider_document_id: null, provider_document_number: 77, provider_document_url: null,
      });
    });
  });

  // A test payment is a test at every place staff read it: the alert title, and the audit row.
  describe('a payment on the test terminal', () => {
    const decide = () => resolvePaymentReview({ operationId: OP, outcome: 'succeeded', documentNumber: 77, note: 'נבדק בלוח של CardCom: החיוב בוצע, מסמך 77' });

    it('is labelled in the Slack alert and in the audit row', async () => {
      wire([cardcomRow({ provider_terminal: 1000, provider_terminal_echo: 1000, is_test: true })]);
      await decide();
      expect(vi.mocked(sendSlackAlert).mock.calls[0][0].title).toMatch(/^\[בדיקה\] /);
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ operationId: OP, outcome: 'succeeded', testMoney: true }) }));
    });

    it('a real payment is labelled nowhere: no prefix, no testMoney key', async () => {
      wire([cardcomRow({ provider_terminal_echo: 1001 })]);
      await decide();
      expect(vi.mocked(sendSlackAlert).mock.calls[0][0].title).not.toContain('[בדיקה]');
      expect(vi.mocked(logActivity).mock.calls[0][0].meta).not.toHaveProperty('testMoney');
    });

    it('marking it failed is labelled the same way', async () => {
      wire([cardcomRow({ provider_terminal: 1000, provider_terminal_echo: 1000, is_test: true })]);
      await resolvePaymentReview({ operationId: OP, outcome: 'failed', note: 'נבדק בלוח של CardCom: לא נגבה' });
      expect(vi.mocked(sendSlackAlert).mock.calls[0][0].title).toMatch(/^\[בדיקה\] .*ככושלת/);
    });
  });

  it('marking a payment failed is never held up by a terminal conflict: that is exactly the decision such a row needs', async () => {
    const db = wire([cardcomRow({ provider_terminal: 1000, provider_terminal_echo: 1001 })]);
    await resolvePaymentReview({ operationId: OP, outcome: 'failed', note: 'נבדק בלוח של CardCom: הכסף הגיע למסוף אחר' });
    expect(db.rows('payment_operations')[0].outcome).toBe('failed');
  });

  it('reportedTerminalConflicts: only a CardCom row with both terminals known and different', () => {
    const base = { provider: 'cardcom' as const, terminalOpenedOn: 1000, terminalReported: 1001 };
    expect(reportedTerminalConflicts(base)).toBe(true);
    expect(reportedTerminalConflicts({ ...base, terminalReported: 1000 })).toBe(false);
    expect(reportedTerminalConflicts({ ...base, terminalReported: null })).toBe(false);
    expect(reportedTerminalConflicts({ ...base, terminalOpenedOn: null })).toBe(false);
    expect(reportedTerminalConflicts({ ...base, provider: 'sumit' as never })).toBe(false);
  });
});
