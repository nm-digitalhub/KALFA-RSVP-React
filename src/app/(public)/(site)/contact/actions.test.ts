import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// The public inquiry actions keep their order — IP rate limit (before the form is parsed) → honeypot → Zod → write —
// and their exact Hebrew:
// the form-level line next to the field errors, the generic refusals, and the honeypot's fake success.
vi.mock('server-only', () => ({}));
vi.mock('@/i18n.server', () => ({
  getT: async () => ({ t: (_key: string, defaultValue: string) => defaultValue }),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.7' })) }));

const { rateLimit, getUser, createContactMessage, createCallbackRequest } = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  getUser: vi.fn(),
  createContactMessage: vi.fn(),
  createCallbackRequest: vi.fn(),
}));
vi.mock('@/lib/security/rate-limit', () => ({ getClientIp: () => '203.0.113.7', rateLimit }));
vi.mock('@/lib/auth/dal', () => ({ getUser }));
vi.mock('@/lib/data/inquiries', () => ({ createContactMessage, createCallbackRequest }));

import { getT } from '@/lib/i18n';
import { callbackRequestSchema, contactMessageSchema } from '@/lib/validation/inquiries';
import { submitCallbackAction, submitContactAction } from './actions';

const RATE_ERROR = 'נשלחו יותר מדי בקשות. נא לנסות שוב בעוד רגע.';
const GENERIC_ERROR = 'שליחת הפנייה נכשלה. נסו שוב בעוד רגע.';
const CONTACT_SUCCESS = 'הפנייה נשלחה. נחזור אליכם בהקדם!';
const CALLBACK_SUCCESS = 'הבקשה נשלחה. נתקשר אליכם בהקדם!';
const CHECK_FIELDS = 'נא לבדוק את הפרטים שמולאו.';

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true });
  getUser.mockResolvedValue(null);
  createContactMessage.mockResolvedValue({ ok: true });
  createCallbackRequest.mockResolvedValue({ ok: true });
});

describe('submitContactAction', () => {
  const VALID = { name: 'דנה כהן', email: 'dana@example.com', phone: '', topic: 'תמיכה', message: 'שאלה על האירוע' };

  it('a real submission is written once and carries the lead source', async () => {
    getUser.mockResolvedValue({ id: 'u1' });

    expect(await submitContactAction({}, fd(VALID))).toEqual({
      data: { notice: CONTACT_SUCCESS, leadSource: 'contact_form' },
    });
    expect(rateLimit).toHaveBeenCalledWith('inquiry:contact:203.0.113.7', expect.anything());
    expect(createContactMessage).toHaveBeenCalledWith(
      { name: 'דנה כהן', email: 'dana@example.com', topic: 'תמיכה', message: 'שאלה על האירוע' },
      'u1',
    );
  });

  it('rate limited → the rate line, before the honeypot and before any parse or write', async () => {
    rateLimit.mockResolvedValue({ allowed: false });

    expect(await submitContactAction({}, fd({ company: 'bot inc' }))).toEqual({ serverError: RATE_ERROR });
    expect(createContactMessage).not.toHaveBeenCalled();
  });

  it('a filled honeypot gets the same success with no lead source, even with invalid fields, and writes nothing', async () => {
    expect(await submitContactAction({}, fd({ company: 'bot inc', name: '' }))).toEqual({
      data: { notice: CONTACT_SUCCESS },
    });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(createContactMessage).not.toHaveBeenCalled();
  });

  it('invalid fields → the form line plus exactly the field errors the schema gives, after the rate limit', async () => {
    const fields = { name: 'א', email: '', phone: '', topic: 'תמיכה', message: 'קצר' };

    const result = await submitContactAction({}, fd(fields));

    const old = contactMessageSchema(getT('public')).safeParse({ ...fields, email: undefined, phone: undefined });
    expect(result).toEqual({
      validationErrors: { formErrors: [CHECK_FIELDS], fieldErrors: z.flattenError(old.error!).fieldErrors },
    });
    expect(result.validationErrors?.fieldErrors.name).toEqual(['נא למלא שם']);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(createContactMessage).not.toHaveBeenCalled();
  });

  it('a failed write → the generic line', async () => {
    createContactMessage.mockResolvedValue({ ok: false });

    expect(await submitContactAction({}, fd(VALID))).toEqual({ serverError: GENERIC_ERROR });
  });
});

describe('submitCallbackAction', () => {
  const VALID = { full_name: 'דנה כהן', phone: '0501234567', topic: 'מכירות', note: '' };

  it('a real submission defaults the time preference to asap and carries the lead source', async () => {
    expect(await submitCallbackAction({}, fd(VALID))).toEqual({
      data: { notice: CALLBACK_SUCCESS, leadSource: 'callback_request' },
    });
    expect(rateLimit).toHaveBeenCalledWith('inquiry:callback:203.0.113.7', expect.anything());
    expect(createCallbackRequest).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'דנה כהן', topic: 'מכירות', preference: 'asap' }),
      null,
    );
  });

  it('rate limited → the rate line; a filled honeypot → the same success, nothing written', async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false });
    expect(await submitCallbackAction({}, fd(VALID))).toEqual({ serverError: RATE_ERROR });

    expect(await submitCallbackAction({}, fd({ ...VALID, company: 'x' }))).toEqual({ data: { notice: CALLBACK_SUCCESS } });
    expect(createCallbackRequest).not.toHaveBeenCalled();
  });

  it('invalid fields → the form line plus the schema’s field errors', async () => {
    const fields = { full_name: '', phone: '12', topic: 'תמיכה' };

    const result = await submitCallbackAction({}, fd(fields));

    const old = callbackRequestSchema(getT('public')).safeParse(fields);
    expect(result).toEqual({
      validationErrors: { formErrors: [CHECK_FIELDS], fieldErrors: z.flattenError(old.error!).fieldErrors },
    });
    expect(result.validationErrors?.fieldErrors.phone).toEqual(['מספר הטלפון אינו תקין']);
    expect(createCallbackRequest).not.toHaveBeenCalled();
  });

  it('a failed write → the generic line', async () => {
    createCallbackRequest.mockResolvedValue({ ok: false });

    expect(await submitCallbackAction({}, fd(VALID))).toEqual({ serverError: GENERIC_ERROR });
  });
});
