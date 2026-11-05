import { beforeEach, describe, expect, it, vi } from 'vitest';

// The call-back intake (/cb/[token]) keeps its order — rate limit keyed on the token's fingerprint → honeypot → Zod →
// submit_callback_intake — and its one generic refusal for every token state.
vi.mock('server-only', () => ({}));
vi.mock('@/i18n.server', () => ({
  getT: async () => ({ t: (_key: string, defaultValue: string) => defaultValue }),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { rateLimit, submitCallbackIntake } = vi.hoisted(() => ({ rateLimit: vi.fn(), submitCallbackIntake: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ getClientIp: () => '203.0.113.7', rateLimit }));
vi.mock('@/lib/data/callback-intake', () => ({ submitCallbackIntake }));

import { tokenFingerprint } from '@/lib/security/token-fingerprint';
import { submitIntakeAction } from './actions';

const TOKEN = 'cb-token-abc123';
const UNAVAILABLE = 'הקישור הזה כבר לא פעיל. אפשר להשאיר פרטים מחדש בעמוד יצירת הקשר.';
const GENERIC = 'שליחת הפרטים נכשלה. אפשר לנסות שוב.';
const VALID = { full_name: 'דנה כהן', topic: 'תמיכה', note: '  ' };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true });
  submitCallbackIntake.mockResolvedValue({ ok: true, scheduleLocked: false });
});

describe('submitIntakeAction', () => {
  it('saves the answers for the bound token, with the preference defaulted and an empty note dropped', async () => {
    expect(await submitIntakeAction(TOKEN, {}, fd(VALID))).toEqual({
      data: { notice: 'הפרטים נשמרו, תודה. נחזור אליך בהקדם.' },
    });
    expect(submitCallbackIntake).toHaveBeenCalledWith(TOKEN, { full_name: 'דנה כהן', topic: 'תמיכה', preference: 'asap' });
  });

  it('the rate-limit key is the fingerprint of THIS bound token — one bucket per link and IP', async () => {
    await submitIntakeAction(TOKEN, {}, fd(VALID));
    await submitIntakeAction('another-token', {}, fd(VALID));

    expect(rateLimit.mock.calls.map(([key]) => key)).toEqual([
      `cb-intake:${tokenFingerprint(TOKEN)}:203.0.113.7`,
      `cb-intake:${tokenFingerprint('another-token')}:203.0.113.7`,
    ]);
  });

  it('a slot already fixed → the locked notice', async () => {
    submitCallbackIntake.mockResolvedValue({ ok: true, scheduleLocked: true });

    expect(await submitIntakeAction(TOKEN, {}, fd(VALID))).toEqual({
      data: { notice: 'הפרטים נשמרו, תודה. המועד שכבר נקבע לא השתנה — נחזור אליך אז.' },
    });
  });

  it('rate limited → its line, keyed on the fingerprint and never the raw token, before anything else', async () => {
    rateLimit.mockResolvedValue({ allowed: false });

    expect(await submitIntakeAction(TOKEN, {}, fd({ ...VALID, company: 'bot' }))).toEqual({
      serverError: 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.',
    });
    expect(rateLimit.mock.calls[0][0]).toMatch(/^cb-intake:[0-9a-f]{16}:203\.0\.113\.7$/);
    expect(rateLimit.mock.calls[0][0]).not.toContain(TOKEN);
    expect(submitCallbackIntake).not.toHaveBeenCalled();
  });

  it('a filled honeypot gets the success line, even with invalid fields, and writes nothing', async () => {
    expect(await submitIntakeAction(TOKEN, {}, fd({ company: 'bot', full_name: '' }))).toEqual({
      data: { notice: 'הפרטים נשמרו. נחזור אליך בהקדם.' },
    });
    expect(submitCallbackIntake).not.toHaveBeenCalled();
  });

  it('invalid fields → the form line plus the field errors', async () => {
    expect(await submitIntakeAction(TOKEN, {}, fd({ full_name: 'א', topic: 'לא נושא' }))).toEqual({
      validationErrors: {
        formErrors: ['נא לבדוק את הפרטים שמולאו.'],
        fieldErrors: { full_name: ['נא למלא שם'], topic: ['נא לבחור נושא'] },
      },
    });
    expect(submitCallbackIntake).not.toHaveBeenCalled();
  });

  it('every token state is the same refusal: unavailable → one line, anything else → the generic one', async () => {
    submitCallbackIntake.mockResolvedValueOnce({ ok: false, reason: 'unavailable' });
    expect(await submitIntakeAction(TOKEN, {}, fd(VALID))).toEqual({ serverError: UNAVAILABLE });

    submitCallbackIntake.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    expect(await submitIntakeAction(TOKEN, {}, fd(VALID))).toEqual({ serverError: GENERIC });
  });

  it('a throw from the data layer → the generic line, never its text, and nothing logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    submitCallbackIntake.mockRejectedValue(new Error('שליחת הפרטים נכשלה'));

    expect(await submitIntakeAction(TOKEN, {}, fd(VALID))).toEqual({ serverError: GENERIC });
    expect(log).not.toHaveBeenCalled();
  });

  it('the rate limit runs before the bound token is checked; an empty token is then refused, nothing written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await submitIntakeAction('', {}, fd(VALID))).toEqual({ serverError: 'הפעולה נכשלה. נסו שוב.' });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(submitCallbackIntake).not.toHaveBeenCalled();

    rateLimit.mockResolvedValue({ allowed: false });
    expect(await submitIntakeAction('', {}, fd(VALID))).toEqual({
      serverError: 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.',
    });
  });
});
