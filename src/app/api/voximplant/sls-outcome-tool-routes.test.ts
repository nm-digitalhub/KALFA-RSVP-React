import { beforeEach, describe, expect, it, vi } from 'vitest';

// The two sales tools that CLAIM the call's outcome: log_outcome and send_signup_link. The token guard and every data
// function are mocked; this file pins the routes' gate (guard -> JSON -> schema, bodiless refusals) and, for
// log_outcome, the whole of its small contract.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/voximplant/agent-tool-guard', () => ({ guardSalesToolRequest: vi.fn() }));
vi.mock('@/lib/data/sales-call-attempts', () => ({
  claimSalesOutcome: vi.fn(),
  getSalesRequestForAttempt: vi.fn(),
  recordSalesLinkSent: vi.fn(),
}));
vi.mock('@/lib/data/callback-scheduling', () => ({ applyCallOutcome: vi.fn() }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/callbacks/signup-link-sms', () => ({ buildSignupLinkSmsText: vi.fn() }));
vi.mock('@/lib/data/whatsapp-template-send', () => ({ resolveWhatsAppSend: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppMarketingTemplate: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn() }));

import { applyCallOutcome } from '@/lib/data/callback-scheduling';
import { claimSalesOutcome, getSalesRequestForAttempt, recordSalesLinkSent } from '@/lib/data/sales-call-attempts';
import { getSmsSender } from '@/lib/sms/sender';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';

import { POST as logOutcome } from './sls/tool/log-outcome/[token]/route';
import { POST as signupLink } from './sls/tool/signup-link/[token]/route';

const TOKEN = '0123456789abcdef0123456789abcdef';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

type Handler = typeof logOutcome;

function call(handler: Handler, raw: string): Promise<Response> {
  vi.mocked(guardSalesToolRequest).mockResolvedValue({ ok: true, attemptId: ATTEMPT_ID, raw });
  return handler(new Request(`https://beta.kalfa.me/api/voximplant/sls/tool/x/${TOKEN}`, { method: 'POST' }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

async function expectBodiless(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(await res.text()).toBe('');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
}

beforeEach(() => {
  vi.resetAllMocks();
});

const ROUTES = [
  { name: 'log-outcome', handler: logOutcome, scope: 'vox-sls-log-outcome', valid: { outcome: 'closed' } },
  { name: 'signup-link', handler: signupLink, scope: 'vox-sls-signup-link', valid: { wa_consent: false } },
] as const;

describe.each(ROUTES)('sls $name tool route — the gate', (route) => {
  it('authorizes against the sales guard, with its own scope and a 2KB cap', async () => {
    await call(route.handler, JSON.stringify(route.valid));
    const [, token, opts] = vi.mocked(guardSalesToolRequest).mock.calls[0];
    expect(token).toBe(TOKEN);
    expect(opts).toEqual({ scope: route.scope, maxBodyBytes: 2 * 1024 });
  });

  it.each([404, 413, 429])('a guard refusal (%i) is bodiless and claims nothing', async (status) => {
    vi.mocked(guardSalesToolRequest).mockResolvedValue({ ok: false, status } as never);
    const res = await route.handler(new Request('https://beta.kalfa.me/x', { method: 'POST' }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    await expectBodiless(res, status);
    expect(claimSalesOutcome).not.toHaveBeenCalled();
    expect(getSalesRequestForAttempt).not.toHaveBeenCalled();
  });

  it('answers a bodiless 400 for a blank body, one that is not JSON, or one with an unknown field', async () => {
    for (const raw of ['', '{not json', JSON.stringify({ ...route.valid, smuggled: 1 })]) {
      await expectBodiless(await call(route.handler, raw), 400);
    }
    expect(claimSalesOutcome).not.toHaveBeenCalled();
    expect(getSalesRequestForAttempt).not.toHaveBeenCalled();
  });
});

describe('sls log-outcome tool route', () => {
  it.each([
    ['closed', 'closed'],
    ['needs_followup', 'needs_followup'],
    // The agent's own word for a hand-off; the request is stored as needing a follow-up.
    ['escalated_to_human', 'needs_followup'],
  ] as const)('claims the outcome once and records %s as %s', async (said, stored) => {
    vi.mocked(claimSalesOutcome).mockResolvedValue({ callbackRequestId: REQUEST_ID } as never);
    const res = await call(logOutcome, JSON.stringify({ outcome: said }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(claimSalesOutcome).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(applyCallOutcome).toHaveBeenCalledWith(REQUEST_ID, stored);
  });

  it('answers already_recorded, and writes nothing, when the outcome was claimed before', async () => {
    vi.mocked(claimSalesOutcome).mockResolvedValue(null as never);
    const res = await call(logOutcome, JSON.stringify({ outcome: 'closed' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, already_recorded: true });
    expect(applyCallOutcome).not.toHaveBeenCalled();
  });

  it('answers a bodiless 500 when the claim or the outcome write throws', async () => {
    vi.mocked(claimSalesOutcome).mockRejectedValue(new Error('boom'));
    await expectBodiless(await call(logOutcome, JSON.stringify({ outcome: 'closed' })), 500);
    expect(applyCallOutcome).not.toHaveBeenCalled();

    vi.mocked(claimSalesOutcome).mockResolvedValue({ callbackRequestId: REQUEST_ID } as never);
    vi.mocked(applyCallOutcome).mockRejectedValue(new Error('boom'));
    await expectBodiless(await call(logOutcome, JSON.stringify({ outcome: 'closed' })), 500);
  });
});

describe('sls signup-link tool route', () => {
  it('answers a bodiless 404, and sends nothing, when the attempt has no request behind it', async () => {
    vi.mocked(getSalesRequestForAttempt).mockResolvedValue(null as never);
    await expectBodiless(await call(signupLink, JSON.stringify({ wa_consent: true })), 404);
    expect(getSalesRequestForAttempt).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(getSmsSender).not.toHaveBeenCalled();
    expect(recordSalesLinkSent).not.toHaveBeenCalled();
    expect(claimSalesOutcome).not.toHaveBeenCalled();
  });
});
