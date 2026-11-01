import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// The public RSVP submit keeps its order — rate limit keyed on the token's fingerprint (before anything is parsed) →
// custom answers rebuilt from the flat `answer_<q_key>` fields → Zod → submit_rsvp → headcount mirror — and its
// exact Hebrew: the form line next to the field errors, and one line per submit_rsvp reason.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { rateLimit, submitRsvp, mirrorEq } = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  submitRsvp: vi.fn(),
  mirrorEq: vi.fn(),
}));
vi.mock('@/lib/security/rate-limit', () => ({ getClientIp: () => '203.0.113.7', rateLimit }));
vi.mock('@/lib/data/rsvp', () => ({ submitRsvp }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ update: () => ({ eq: mirrorEq }) }) }),
}));

import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { rsvpSubmitSchema } from '@/lib/validation/rsvp';
import { submitRsvpAction } from './actions';

const TOKEN = 'rsvp-token-abc123';
const CHECK_FIELDS = 'נא לבדוק את הפרטים שמולאו.';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true });
  submitRsvp.mockResolvedValue({ ok: true, status: 'attending', unchanged: false });
  mirrorEq.mockResolvedValue({ error: null });
});

describe('submitRsvpAction', () => {
  it('records the answer for the bound token, with the custom answers kept flat (a q_key may hold "." or "[")', async () => {
    const form = fd({ status: 'attending', adults: '2', kids: '1', meal_pref: ' צמחוני ', note: '', show_in_guest_list: 'on' });
    form.set('answer_diet.pref', ' ללא גלוטן ');
    form.set('answer_seat[1]', 'ליד הבמה');
    form.set('answer_empty', '   ');

    expect(await submitRsvpAction(TOKEN, {}, form)).toEqual({ data: { notice: 'אישור ההגעה נשמר בהצלחה. תודה!' } });
    expect(submitRsvp).toHaveBeenCalledWith(TOKEN, {
      status: 'attending',
      adults: 2,
      kids: 1,
      meal_pref: 'צמחוני',
      answers: { 'diet.pref': 'ללא גלוטן', 'seat[1]': 'ליד הבמה' },
      show_in_guest_list: true,
    });
    expect(mirrorEq).toHaveBeenCalledWith('rsvp_token', TOKEN);
  });

  it('the rate-limit key is the fingerprint of THIS bound token — one bucket per guest link and IP', async () => {
    await submitRsvpAction(TOKEN, {}, fd({ status: 'declined' }));
    await submitRsvpAction('another-token', {}, fd({ status: 'declined' }));

    expect(rateLimit.mock.calls.map(([key]) => key)).toEqual([
      `rsvp:submit:${tokenFingerprint(TOKEN)}:203.0.113.7`,
      `rsvp:submit:${tokenFingerprint('another-token')}:203.0.113.7`,
    ]);
  });

  it('an answer already on record → its own notice', async () => {
    submitRsvp.mockResolvedValue({ ok: true, status: 'declined', unchanged: true });

    expect(await submitRsvpAction(TOKEN, {}, fd({ status: 'declined' }))).toEqual({
      data: { notice: 'התשובה שלך כבר נשמרה אצלנו. תודה!' },
    });
    expect(mirrorEq).not.toHaveBeenCalled();
  });

  it('rate limited → its line, keyed on the fingerprint and never the raw token, before anything is parsed', async () => {
    rateLimit.mockResolvedValue({ allowed: false });

    expect(await submitRsvpAction('', {}, fd({ status: 'bogus' }))).toEqual({
      serverError: 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.',
    });
    expect(rateLimit.mock.calls[0][0]).toMatch(/^rsvp:submit:[0-9a-f]{16}:203\.0\.113\.7$/);
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('invalid fields → the form line plus exactly the field errors as before, nothing submitted', async () => {
    const fields = { status: 'attending', adults: '0', kids: '0' };

    const result = await submitRsvpAction(TOKEN, {}, fd(fields));

    expect(result).toEqual({
      validationErrors: { formErrors: [CHECK_FIELDS], fieldErrors: { adults: ['נא לציין לפחות אורח אחד'] } },
    });
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('a nested answer error still lands under `answers`, grouped as z.flattenError grouped it', async () => {
    const form = fd({ status: 'maybe' });
    form.set('answer_q1', 'א'.repeat(501));

    const result = await submitRsvpAction(TOKEN, {}, form);

    const old = rsvpSubmitSchema.safeParse({
      status: 'maybe', adults: 0, kids: 0, answers: { q1: 'א'.repeat(501) }, show_in_guest_list: false,
    });
    expect(result).toEqual({
      validationErrors: { formErrors: [CHECK_FIELDS], fieldErrors: z.flattenError(old.error!).fieldErrors },
    });
    expect(result.validationErrors?.fieldErrors).toEqual({ answers: ['התשובה ארוכה מדי'] });
  });

  it.each([
    ['not_found', 'קישור אישור ההגעה אינו תקף או בוטל.'],
    ['closed', 'האירוע אינו פתוח כעת לאישורי הגעה.'],
    ['deadline_passed', 'המועד האחרון לאישור הגעה חלף.'],
    ['invalid_count', 'מספר האורחים אינו תקין.'],
  ])('submit_rsvp reason %s → its line, no headcount mirror', async (reason, line) => {
    submitRsvp.mockResolvedValue({ ok: false, reason });

    expect(await submitRsvpAction(TOKEN, {}, fd({ status: 'attending', adults: '1' }))).toEqual({ serverError: line });
    expect(mirrorEq).not.toHaveBeenCalled();
  });

  it('a failed headcount mirror never fails a recorded RSVP', async () => {
    mirrorEq.mockRejectedValue(new Error('mirror down'));

    expect(await submitRsvpAction(TOKEN, {}, fd({ status: 'attending', adults: '1' }))).toEqual({
      data: { notice: 'אישור ההגעה נשמר בהצלחה. תודה!' },
    });
  });

  it('an empty bound token is refused after the rate limit, before submit_rsvp', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await submitRsvpAction('', {}, fd({ status: 'attending', adults: '1' }))).toEqual({
      serverError: 'הפעולה נכשלה. נסו שוב.',
    });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(submitRsvp).not.toHaveBeenCalled();
  });
});

describe('submitRsvpAction — a failed submit_rsvp', () => {
  it('shows the guest only the fixed line; the database cause stays in the server log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    submitRsvp.mockRejectedValueOnce(
      new Error('שליחת אישור ההגעה נכשלה', {
        cause: { code: '57014', message: 'canceling statement due to statement timeout' },
      }),
    );
    const form = new FormData();
    form.set('status', 'attending');
    form.set('adults', '1');
    form.set('kids', '0');

    const result = await submitRsvpAction(TOKEN, {}, form);

    expect(result).toEqual({ serverError: 'שליחת אישור ההגעה נכשלה' });
    expect(JSON.stringify(result)).not.toMatch(/57014|canceling statement/);
    expect(log).toHaveBeenCalledWith(
      '[action] Error: שליחת אישור ההגעה נכשלה — [57014] canceling statement due to statement timeout',
    );
    log.mockRestore();
  });
});
