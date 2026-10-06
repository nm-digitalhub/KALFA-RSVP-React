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

import { recordStaffAccess } from './access-log';
import {
  listPaymentReviews,
  PaymentReviewError,
  probePaymentReview,
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
