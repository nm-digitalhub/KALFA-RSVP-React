import { createInstance } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';

const { rateLimit, send, createAdminClient, getT } = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  send: vi.fn(),
  createAdminClient: vi.fn(),
  getT: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/security/rate-limit', () => ({ getClientIp: () => '203.0.113.7', rateLimit }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));
// No real SMS: the sender is the one thing here that reaches the outside.
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: async () => ({ send }) }));
vi.mock('@/i18n.server', () => ({ getT }));

import { POST } from './route';

const PHONE = '050-123-4567';
const E164 = '+972501234567';
const FLOOD_RATE = { limit: 10, windowMs: 60_000 };

// The real i18next, with the same options as src/i18n.config.ts: Hebrew has no resources and comes from the default in code.
const i18n = createInstance();
void i18n.init({
  lng: 'he',
  fallbackLng: 'he',
  ns: ['public'],
  defaultNS: 'public',
  initAsync: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  resources: { en: { public: { site: { callMe: { smsCode: 'Your KALFA code: {{code}}' } } } } },
});

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://beta.kalfa.me/api/call-me-now/request-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

const postJson = (body: unknown) => POST(post(JSON.stringify(body)));

// One awaited chain per entry: the count of recent codes, then the insert.
function wireQueries(...results: Parameters<typeof createMockSupabase>[0][]) {
  const { client } = createMockSupabase({ data: null, error: null });
  for (const result of results) client.from.mockReturnValueOnce(createMockSupabase(result).builder);
  createAdminClient.mockReturnValue(client);
}

const wireFreshPhone = () => wireQueries({ data: null, error: null, count: 0 }, { data: null, error: null });
const sentText = () => (send.mock.calls[0]?.[0] as { text: string }).text;

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true });
  send.mockResolvedValue({ id: 'sms1' });
  getT.mockImplementation(async (ns: string, options: { lng: string }) => ({
    t: i18n.getFixedT(options.lng, ns),
  }));
});

describe('POST /api/call-me-now/request-code: the language of the SMS', () => {
  it('sends Hebrew when the field is missing, character for character', async () => {
    wireFreshPhone();

    const res = await postJson({ phone: PHONE });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getT).toHaveBeenCalledWith('public', { lng: 'he' });
    expect(sentText()).toMatch(/^קוד האימות שלך ל-KALFA: \d{6}$/);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: E164 });
  });

  it('sends Hebrew for language he', async () => {
    wireFreshPhone();

    await postJson({ phone: PHONE, language: 'he' });

    expect(sentText()).toMatch(/^קוד האימות שלך ל-KALFA: \d{6}$/);
  });

  it('sends the English wording for language en', async () => {
    wireFreshPhone();

    await postJson({ phone: PHONE, language: 'en' });

    expect(getT).toHaveBeenCalledWith('public', { lng: 'en' });
    expect(sentText()).toMatch(/^Your KALFA code: \d{6}$/);
  });

  it('falls back to the Hebrew wording while a language has no translation yet', async () => {
    wireFreshPhone();

    await postJson({ phone: PHONE, language: 'fr' });

    expect(sentText()).toMatch(/^קוד האימות שלך ל-KALFA: \d{6}$/);
  });

  it.each([['de'], [''], [7], [null]])('rejects language %j like any bad body, with nothing sent', async (language) => {
    const res = await postJson({ phone: PHONE, language });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid_phone' });
    expect(getT).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /api/call-me-now/request-code: checks and statuses', () => {
  it('runs the per-IP guard first, with the same key and limit', async () => {
    rateLimit.mockResolvedValue({ allowed: false });

    const res = await POST(post('not json'));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: 'rate_limited' });
    expect(rateLimit).toHaveBeenCalledWith('call-me-now-request-code:203.0.113.7', FLOOD_RATE);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 413 for a declared length over the limit', async () => {
    const res = await POST(post('{}', { 'content-length': '513' }));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, reason: 'body_too_large' });
  });

  it('answers 413 for a real body over the limit', async () => {
    const res = await POST(post(JSON.stringify({ phone: 'x'.repeat(600) })));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, reason: 'body_too_large' });
  });

  it('answers 400 bad_body for a body that is not JSON', async () => {
    const res = await POST(post('not json'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'bad_body' });
  });

  it('answers 400 invalid_phone for a missing phone', async () => {
    const res = await postJson({});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid_phone' });
  });

  it('answers 400 invalid_phone for an unknown field', async () => {
    const res = await postJson({ phone: PHONE, extra: true });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid_phone' });
  });

  it('answers 200 invalid_phone for a number requestOtp cannot normalize', async () => {
    const res = await postJson({ phone: 'abc' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid_phone' });
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 200 too_many_codes at the per-phone limit, distinct from the per-IP guard', async () => {
    wireQueries({ data: null, error: null, count: 5 });

    const res = await postJson({ phone: PHONE });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'too_many_codes' });
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 200 otp_create_failed when the code cannot be stored', async () => {
    wireQueries({ data: null, error: null, count: 0 }, { data: null, error: { message: 'insert failed' } });

    const res = await postJson({ phone: PHONE });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'otp_create_failed' });
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 200 send_failed when the provider refuses', async () => {
    wireFreshPhone();
    send.mockRejectedValue(new Error('gateway down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postJson({ phone: PHONE });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'send_failed' });
    log.mockRestore();
  });
});
