import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'route-test-secret';

vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantCallbackSecret: vi.fn(async () => SECRET),
}));
vi.mock('@/lib/data/call-attempts', () => ({ getCallContextById: vi.fn() }));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn(async () => {}) }));

import { GET } from './ctx/[token]/route';
import { POST } from './cb/[token]/route';
import { getCallContextById } from '@/lib/data/call-attempts';
import { insertWebhookEvents } from '@/lib/data/webhooks';
import { signCallToken } from '@/lib/voximplant/call-token';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

const AID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nowSec = () => Math.floor(Date.now() / 1000);
const ctxToken = (opts: Partial<{ aid: string; purpose: 'ctx' | 'cb'; exp: number }> = {}) =>
  signCallToken(SECRET, {
    callAttemptId: opts.aid ?? AID,
    purpose: opts.purpose ?? 'ctx',
    expiresAtSec: opts.exp ?? nowSec() + 3600,
  });

function ctxReq(token: string, ip = '9.9.9.9') {
  return new Request(`https://beta.kalfa.me/api/voximplant/ctx/${token}`, {
    method: 'GET',
    headers: { 'x-real-ip': ip },
  });
}
function cbReq(token: string, body: string, ip = '8.8.8.8', headers: Record<string, string> = {}) {
  return new Request(`https://beta.kalfa.me/api/voximplant/cb/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...headers },
    body,
  });
}
const ctxCall = (token: string, ip?: string) =>
  GET(ctxReq(token, ip), { params: Promise.resolve({ token }) });
const cbCall = (token: string, body: string, ip?: string, headers?: Record<string, string>) =>
  POST(cbReq(token, body, ip, headers), { params: Promise.resolve({ token }) });

const CTX = {
  attempt: { id: AID, status: 'dialing', token_expires_at: '', guest_id: 'g1', event_id: 'ev1', contact_id: 'ct1' },
  event: { status: 'active', name: 'חתונה', event_date: '2026-07-14T15:00:00Z', venue_name: 'אולם הגן' },
  guestFullName: 'ישראל ישראלי',
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitStateForTests();
  vi.mocked(getCallContextById).mockResolvedValue(CTX as never);
});

describe('ctx GET', () => {
  it('valid → 200 with ONLY the four allowlisted fields (first name, no PII)', async () => {
    const res = await ctxCall(ctxToken());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(['event_date', 'event_name', 'event_venue', 'guest_name']);
    expect(json.guest_name).toBe('ישראל'); // first name only
    expect(json.event_name).toBe('חתונה');
    expect(json.event_venue).toBe('אולם הגן');
    expect(JSON.stringify(json)).not.toContain('rsvp_token');
    expect(JSON.stringify(json)).not.toMatch(/phone|contact_id|ct1|g1/);
  });

  it('missing token → 404', async () => {
    expect((await ctxCall('')).status).toBe(404);
  });
  it('bad signature → 404', async () => {
    const t = ctxToken();
    const forged = `${t.split('.')[0]}.AAAA`;
    expect((await ctxCall(forged)).status).toBe(404);
  });
  it('expired token → 404', async () => {
    expect((await ctxCall(ctxToken({ exp: nowSec() - 1 }))).status).toBe(404);
  });
  it('cb-purpose token used at ctx → 404', async () => {
    expect((await ctxCall(ctxToken({ purpose: 'cb' }))).status).toBe(404);
  });
  it('attempt not found → 404', async () => {
    vi.mocked(getCallContextById).mockResolvedValue(null);
    expect((await ctxCall(ctxToken())).status).toBe(404);
  });
  it('event not active → 404', async () => {
    vi.mocked(getCallContextById).mockResolvedValue({ ...CTX, event: { ...CTX.event, status: 'closed' } } as never);
    expect((await ctxCall(ctxToken())).status).toBe(404);
  });
  it('rate limit trips → 429', async () => {
    const t = ctxToken();
    let last = 200;
    for (let i = 0; i < 15; i++) last = (await ctxCall(t, '5.5.5.5')).status;
    expect(last).toBe(429);
  });
});

describe('cb POST', () => {
  const validBody = JSON.stringify({ call_status: 'completed', rsvp_digit: '1', rsvp_method: 'dtmf' });

  it('valid → 200 and persists idempotently with the right dedupe_key + message_id', async () => {
    const res = await cbCall(ctxToken({ purpose: 'cb' }), validBody);
    expect(res.status).toBe(200);
    expect(insertWebhookEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'voximplant',
        event_kind: 'call_result',
        dedupe_key: `vox-cb:${AID}:completed`,
        message_id: AID,
      }),
    ]);
  });

  it('invalid JSON → 400 (no persist)', async () => {
    expect((await cbCall(ctxToken({ purpose: 'cb' }), '{not json')).status).toBe(400);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('invalid payload (bad status) → 400', async () => {
    expect((await cbCall(ctxToken({ purpose: 'cb' }), JSON.stringify({ call_status: 'nope' }))).status).toBe(400);
  });
  it('unknown extra field → 400 (strictObject)', async () => {
    const b = JSON.stringify({ call_status: 'no_answer', injected: 'x' });
    expect((await cbCall(ctxToken({ purpose: 'cb' }), b)).status).toBe(400);
  });
  it('completed without rsvp_digit → 400 (refine)', async () => {
    expect((await cbCall(ctxToken({ purpose: 'cb' }), JSON.stringify({ call_status: 'completed' }))).status).toBe(400);
  });
  it('oversized body → 413 (no persist)', async () => {
    const huge = 'x'.repeat(260 * 1024);
    expect((await cbCall(ctxToken({ purpose: 'cb' }), huge)).status).toBe(413);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('invitation_id not matching the token → 400', async () => {
    const b = JSON.stringify({ call_status: 'completed', rsvp_digit: '1', invitation_id: 'other' });
    expect((await cbCall(ctxToken({ purpose: 'cb' }), b)).status).toBe(400);
  });
  it('ctx-purpose token used at cb → 404', async () => {
    expect((await cbCall(ctxToken({ purpose: 'ctx' }), validBody)).status).toBe(404);
  });
  it('rate limit trips → 429 (fail-closed)', async () => {
    const t = ctxToken({ purpose: 'cb' });
    let last = 200;
    for (let i = 0; i < 33; i++) last = (await cbCall(t, validBody, '6.6.6.6')).status;
    expect(last).toBe(429);
  });
});
