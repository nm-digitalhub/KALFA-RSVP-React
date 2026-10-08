import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/payments/cardcom-settle', () => ({ settleCardcomSession: vi.fn() }));
vi.mock('@/lib/security/rate-limit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/security/rate-limit')>()), rateLimit: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { rateLimit } from '@/lib/security/rate-limit';

import { POST } from './route';

// CardCom's webhook is server-to-server and UNAUTHENTICATED: anyone who knows the URL can post to it, so the post
// itself proves nothing. All it does is name a session; whether money moved is decided by CardCom's own answer to
// GetLpResult (settleCardcomSession). That is why an unknown id, a repeated post and a forged post are all harmless — and
// why the route answers 200 to everything CardCom should NOT retry and a 5xx only when CardCom should.

const LP = 'f47b241e-1861-4cf8-a9a2-bf0c05f9f36d';
const SENTINEL = 'SENTINEL-PERSONAL-DATA-0501234567';

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://kalfa.test/api/cardcom/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}
const post = (body: unknown, headers?: Record<string, string>) => POST(request(body, headers));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 100, resetAt: 0 });
  vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
});

describe('POST /api/cardcom/webhook', () => {
  it('names the session to settle, and settles it as a finished payment (the post comes after a submit)', async () => {
    const res = await post({ ResponseCode: 0, Description: 'ok', TerminalNumber: 1000, LowProfileId: LP, Operation: 'ChargeOnly' });
    expect(res.status).toBe(200);
    expect(settleCardcomSession).toHaveBeenCalledWith(LP, { finalizeUnpaid: true });
  });

  it('ignores everything but the LowProfileId: the body is not believed, whatever it claims', async () => {
    await post({ LowProfileId: LP, ResponseCode: 0, Amount: 1, TranzactionId: 999, Extra: { a: 1 } });
    expect(settleCardcomSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(settleCardcomSession).mock.calls[0]).toEqual([LP, { finalizeUnpaid: true }]);
  });

  it('answers 200 for every outcome CardCom should not retry: paid, declined, already done, in review', async () => {
    for (const outcome of ['succeeded', 'failed', 'review'] as const) {
      for (const alreadyDone of [true, false]) {
        vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome, alreadyDone });
        expect((await post({ LowProfileId: LP })).status).toBe(200);
      }
    }
  });

  it('answers 200 to an id it does not know, and raises a high-importance alert (the guide asks for it)', async () => {
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'not_found' });
    const res = await post({ LowProfileId: 'unknown-id' });
    expect(res.status).toBe(200);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', fields: expect.objectContaining({ low_profile_id: 'unknown-id' }) }));
  });

  it('answers 500 when CardCom could not be asked, so that CardCom posts again', async () => {
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'error' });
    expect((await post({ LowProfileId: LP })).status).toBe(500);
  });

  it('answers 500 when settling throws, and never echoes the error', async () => {
    vi.mocked(settleCardcomSession).mockRejectedValue(new Error('db password is hunter2'));
    const res = await post({ LowProfileId: LP });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('hunter2');
  });

  it.each([
    ['not JSON', 'not json at all'],
    ['an array', '[1,2]'],
    ['a body with no LowProfileId', '{"ResponseCode":0}'],
    ['a LowProfileId that is not text', '{"LowProfileId":12345}'],
    ['an empty LowProfileId', '{"LowProfileId":""}'],
    ['a LowProfileId that is far too long', JSON.stringify({ LowProfileId: 'x'.repeat(200) })],
  ])('answers 400 to %s, and settles nothing', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('answers 413 to a body that is far larger than anything CardCom sends', async () => {
    const res = await post(JSON.stringify({ LowProfileId: LP, pad: 'x'.repeat(50_000) }));
    expect(res.status).toBe(413);
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('answers 429 when one address floods it, before doing any work', async () => {
    vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });
    expect((await post({ LowProfileId: LP })).status).toBe(429);
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('limits per client address', async () => {
    await post({ LowProfileId: LP }, { 'x-forwarded-for': '198.51.100.7' });
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toContain('198.51.100.7');
  });

  it('never writes the request body (personal data) to the log, in any outcome', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(settleCardcomSession).mockRejectedValue(new Error('boom'));
    await post({ LowProfileId: LP, UIValues: { CardOwnerPhone: SENTINEL } });
    await post(`{"LowProfileId":${SENTINEL}`);
    for (const spy of [logs, info, warn]) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
    logs.mockRestore(); info.mockRestore(); warn.mockRestore();
  });
});
