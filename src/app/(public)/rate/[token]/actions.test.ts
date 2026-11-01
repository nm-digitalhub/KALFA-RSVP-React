import { beforeEach, describe, expect, it, vi } from 'vitest';

// The public rating (/rate/[token]) keeps its order — rate limit keyed on the token's fingerprint → Zod →
// submitInquiryRating — and its one generic refusal for every token state.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { rateLimit, submitInquiryRating } = vi.hoisted(() => ({ rateLimit: vi.fn(), submitInquiryRating: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ getClientIp: () => '203.0.113.7', rateLimit }));
vi.mock('@/lib/data/inquiry-rating', () => ({ submitInquiryRating }));

import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { submitRatingAction } from './actions';

const TOKEN = 'rate-token-abc123';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true });
  submitInquiryRating.mockResolvedValue({ ok: true });
});

describe('submitRatingAction', () => {
  it('records the score for the bound token; an empty comment is stored as null', async () => {
    expect(await submitRatingAction(TOKEN, {}, fd({ score: '3', comment: '' }))).toEqual({
      data: { notice: 'תודה על הדירוג!' },
    });
    expect(submitInquiryRating).toHaveBeenCalledWith(TOKEN, 3, null);
  });

  it('the rate-limit key is the fingerprint of THIS bound token — one bucket per link and IP', async () => {
    await submitRatingAction(TOKEN, {}, fd({ score: '2' }));
    await submitRatingAction('another-token', {}, fd({ score: '2' }));

    expect(rateLimit.mock.calls.map(([key]) => key)).toEqual([
      `rating:submit:${tokenFingerprint(TOKEN)}:203.0.113.7`,
      `rating:submit:${tokenFingerprint('another-token')}:203.0.113.7`,
    ]);
  });

  it('rate limited → its line, keyed on the fingerprint and never the raw token, before the parse', async () => {
    rateLimit.mockResolvedValue({ allowed: false });

    expect(await submitRatingAction(TOKEN, {}, fd({ score: '9' }))).toEqual({
      serverError: 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.',
    });
    expect(rateLimit.mock.calls[0][0]).toMatch(/^rating:submit:[0-9a-f]{16}:203\.0\.113\.7$/);
    expect(submitInquiryRating).not.toHaveBeenCalled();
  });

  it('a score off the scale → the form line (and the field error), nothing written', async () => {
    expect(await submitRatingAction(TOKEN, {}, fd({ score: '4' }))).toEqual({
      validationErrors: { formErrors: ['נא לבחור דירוג תקין.'], fieldErrors: { score: ['דירוג לא תקין'] } },
    });
    expect(submitInquiryRating).not.toHaveBeenCalled();
  });

  it('an unknown, unrequested or failed token → one generic line', async () => {
    submitInquiryRating.mockResolvedValue({ ok: false });

    expect(await submitRatingAction(TOKEN, {}, fd({ score: '1' }))).toEqual({
      serverError: 'הקישור אינו תקף או שאינו זמין עוד.',
    });
  });

  it('the rate limit runs before the bound token is checked; an empty token is then refused, nothing written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await submitRatingAction('', {}, fd({ score: '3' }))).toEqual({ serverError: 'הפעולה נכשלה. נסו שוב.' });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(submitInquiryRating).not.toHaveBeenCalled();

    rateLimit.mockResolvedValue({ allowed: false });
    expect(await submitRatingAction('', {}, fd({ score: '3' }))).toEqual({
      serverError: 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.',
    });
  });
});
