import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/payment-review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/admin/payment-review')>();
  return { ...actual, probePaymentReview: vi.fn(), resolvePaymentReview: vi.fn() };
});

import { revalidatePath } from 'next/cache';

import {
  PaymentReviewError,
  probePaymentReview,
  resolvePaymentReview,
} from '@/lib/data/admin/payment-review';

import { probePaymentReviewAction, resolvePaymentReviewAction } from './actions';

const OP = '11111111-1111-4111-8111-111111111111';
const NOTE = 'נבדק ב-SUMIT: החיוב בוצע, קבלה 40106';

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('probePaymentReviewAction', () => {
  it('asks about the operation named in the form and returns what the lookup says', async () => {
    vi.mocked(probePaymentReview).mockResolvedValue({ kind: 'not_found' });
    const state = await probePaymentReviewAction(null, form({ operationId: OP }));
    expect(probePaymentReview).toHaveBeenCalledWith(OP);
    expect(state).toEqual({ probe: { kind: 'not_found' } });
  });

  it('a malformed id never reaches the data layer', async () => {
    const state = await probePaymentReviewAction(null, form({ operationId: 'nope' }));
    expect(probePaymentReview).not.toHaveBeenCalled();
    expect(state?.error).toBeTruthy();
  });

  it('shows an expected refusal as written, and anything unexpected only as a generic line', async () => {
    vi.mocked(probePaymentReview).mockRejectedValueOnce(new PaymentReviewError('הפעולה אינה ממתינה להכרעה'));
    expect((await probePaymentReviewAction(null, form({ operationId: OP })))?.error).toBe('הפעולה אינה ממתינה להכרעה');

    vi.mocked(probePaymentReview).mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.1:5432 password=secret'));
    const generic = await probePaymentReviewAction(null, form({ operationId: OP }));
    expect(generic?.error).toBe('הבדיקה נכשלה. נסו שוב.');
    expect(JSON.stringify(generic)).not.toContain('secret');
  });

  it("lets Next's own redirect / forbidden signals through instead of swallowing them", async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin;307;' });
    vi.mocked(probePaymentReview).mockRejectedValueOnce(redirect);
    await expect(probePaymentReviewAction(null, form({ operationId: OP }))).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('resolvePaymentReviewAction', () => {
  it('turns the form text into numbers, resolves, refreshes the page and says what happened', async () => {
    vi.mocked(resolvePaymentReview).mockResolvedValue({ outcome: 'succeeded' });
    const state = await resolvePaymentReviewAction(
      null,
      form({ operationId: OP, outcome: 'succeeded', documentNumber: '40106', amount: '100', note: NOTE }),
    );
    expect(resolvePaymentReview).toHaveBeenCalledWith({
      operationId: OP,
      outcome: 'succeeded',
      documentNumber: 40106,
      amount: 100,
      note: NOTE,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/payments');
    expect(state?.notice).toContain('אושרה');
  });

  it('blank optional numbers are "not given", not zero', async () => {
    vi.mocked(resolvePaymentReview).mockResolvedValue({ outcome: 'failed' });
    await resolvePaymentReviewAction(null, form({ operationId: OP, outcome: 'failed', documentNumber: ' ', amount: '', note: NOTE }));
    expect(resolvePaymentReview).toHaveBeenCalledWith({ operationId: OP, outcome: 'failed', note: NOTE });
  });

  it('a decision without a real reason, or a confirmation without a receipt number, comes back as field errors and writes nothing', async () => {
    const shortNote = await resolvePaymentReviewAction(null, form({ operationId: OP, outcome: 'failed', note: 'קצר' }));
    expect(shortNote?.fieldErrors?.note?.length).toBeGreaterThan(0);

    const noDoc = await resolvePaymentReviewAction(null, form({ operationId: OP, outcome: 'succeeded', note: NOTE }));
    expect(noDoc?.fieldErrors?.documentNumber?.length).toBeGreaterThan(0);

    const letters = await resolvePaymentReviewAction(
      null,
      form({ operationId: OP, outcome: 'succeeded', documentNumber: 'abc', note: NOTE }),
    );
    expect(letters?.fieldErrors?.documentNumber?.length).toBeGreaterThan(0);

    expect(resolvePaymentReview).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a lost race is reported in the words the data layer chose; an unexpected failure is generic', async () => {
    vi.mocked(resolvePaymentReview).mockRejectedValueOnce(new PaymentReviewError('הפעולה כבר הוכרעה על ידי מישהו אחר'));
    expect((await resolvePaymentReviewAction(null, form({ operationId: OP, outcome: 'failed', note: NOTE })))?.error).toBe(
      'הפעולה כבר הוכרעה על ידי מישהו אחר',
    );

    vi.mocked(resolvePaymentReview).mockRejectedValueOnce(new TypeError('x is undefined'));
    expect((await resolvePaymentReviewAction(null, form({ operationId: OP, outcome: 'failed', note: NOTE })))?.error).toBe(
      'ההכרעה נכשלה. נסו שוב.',
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
