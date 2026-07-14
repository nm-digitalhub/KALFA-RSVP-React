import { beforeEach, describe, expect, it, vi } from 'vitest';

// Branch B: the ctx/cb routes authenticate by the row's opaque per-call
// access_token (looked up server-side) — NOT a signed/purpose token. The ctx
// response also carries the Groq key (moved out of the scenario payload). These
// tests mock the token→row lookups + the key getter directly.

vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantGroqKey: vi.fn(async () => 'gsk_test_key'),
}));
vi.mock('@/lib/data/call-attempts', () => ({
  getCallContextByAccessToken: vi.fn(),
  getCallAttemptByAccessToken: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn(async () => {}) }));

import { GET } from './ctx/[token]/route';
import { POST } from './cb/[token]/route';
import {
  getCallContextByAccessToken,
  getCallAttemptByAccessToken,
} from '@/lib/data/call-attempts';
import { getVoximplantGroqKey } from '@/lib/data/voximplant-config';
import { insertWebhookEvents } from '@/lib/data/webhooks';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

const AID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOK = '0123456789abcdef0123456789abcdef';
const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();
const PAST = () => new Date(Date.now() - 1000).toISOString();

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
  attempt: { id: AID, status: 'dialing', token_expires_at: FUTURE(), guest_id: 'g1', event_id: 'ev1', contact_id: 'ct1' },
  event: { status: 'active', name: 'חתונה', event_date: '2026-07-14T15:00:00Z', venue_name: 'אולם הגן' },
  guestFullName: 'ישראל ישראלי',
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitStateForTests();
  vi.mocked(getCallContextByAccessToken).mockResolvedValue({
    ...CTX,
    attempt: { ...CTX.attempt, token_expires_at: FUTURE() },
  } as never);
  vi.mocked(getVoximplantGroqKey).mockResolvedValue('gsk_test_key');
  vi.mocked(getCallAttemptByAccessToken).mockResolvedValue({
    id: AID,
    token_expires_at: FUTURE(),
  } as never);
});

describe('ctx GET', () => {
  it('valid → 200 with the invitation fields + Groq key, no PII', async () => {
    const res = await ctxCall(TOK);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual([
      'event_date',
      'event_name',
      'event_venue',
      'groq_key',
      'guest_name',
    ]);
    expect(json.guest_name).toBe('ישראל'); // first name only
    expect(json.event_name).toBe('חתונה');
    expect(json.event_venue).toBe('אולם הגן');
    expect(json.groq_key).toBe('gsk_test_key');
    expect(JSON.stringify(json)).not.toContain('rsvp_token');
    expect(JSON.stringify(json)).not.toMatch(/phone|contact_id|ct1|g1/);
  });

  it('missing token → 404', async () => {
    expect((await ctxCall('')).status).toBe(404);
  });
  it('expired token → 404', async () => {
    vi.mocked(getCallContextByAccessToken).mockResolvedValue({
      ...CTX,
      attempt: { ...CTX.attempt, token_expires_at: PAST() },
    } as never);
    expect((await ctxCall(TOK)).status).toBe(404);
  });
  it('unknown token → 404', async () => {
    vi.mocked(getCallContextByAccessToken).mockResolvedValue(null);
    expect((await ctxCall(TOK)).status).toBe(404);
  });
  it('event not active → 404', async () => {
    vi.mocked(getCallContextByAccessToken).mockResolvedValue({ ...CTX, event: { ...CTX.event, status: 'closed' } } as never);
    expect((await ctxCall(TOK)).status).toBe(404);
  });
  it('terminal attempt status → 404', async () => {
    vi.mocked(getCallContextByAccessToken).mockResolvedValue({ ...CTX, attempt: { ...CTX.attempt, status: 'completed' } } as never);
    expect((await ctxCall(TOK)).status).toBe(404);
  });
  it('missing Groq key → 404', async () => {
    vi.mocked(getVoximplantGroqKey).mockResolvedValue(null);
    expect((await ctxCall(TOK)).status).toBe(404);
  });
  it('rate limit trips → 429', async () => {
    let last = 200;
    for (let i = 0; i < 15; i++) last = (await ctxCall(TOK, '5.5.5.5')).status;
    expect(last).toBe(429);
  });
});

describe('cb POST', () => {
  const validBody = JSON.stringify({ call_status: 'completed', rsvp_digit: '1', rsvp_method: 'dtmf' });

  it('valid → 200 and persists idempotently with the right dedupe_key + message_id', async () => {
    const res = await cbCall(TOK, validBody);
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

  it('unknown token → 404 (no persist)', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue(null);
    expect((await cbCall(TOK, validBody)).status).toBe(404);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('expired token → 404 (no persist)', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue({ id: AID, token_expires_at: PAST() } as never);
    expect((await cbCall(TOK, validBody)).status).toBe(404);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('invalid JSON → 400 (no persist)', async () => {
    expect((await cbCall(TOK, '{not json')).status).toBe(400);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('invalid payload (bad status) → 400', async () => {
    expect((await cbCall(TOK, JSON.stringify({ call_status: 'nope' }))).status).toBe(400);
  });
  it('unknown extra field → 400 (strictObject)', async () => {
    const b = JSON.stringify({ call_status: 'no_answer', injected: 'x' });
    expect((await cbCall(TOK, b)).status).toBe(400);
  });
  it('completed without rsvp_digit → 400 (refine)', async () => {
    expect((await cbCall(TOK, JSON.stringify({ call_status: 'completed' }))).status).toBe(400);
  });
  it('oversized body → 413 (no persist)', async () => {
    const huge = 'x'.repeat(260 * 1024);
    expect((await cbCall(TOK, huge)).status).toBe(413);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('invitation_id not matching the token → 400', async () => {
    const b = JSON.stringify({ call_status: 'completed', rsvp_digit: '1', invitation_id: 'other' });
    expect((await cbCall(TOK, b)).status).toBe(400);
  });
  it('rate limit trips → 429 (fail-closed)', async () => {
    let last = 200;
    for (let i = 0; i < 33; i++) last = (await cbCall(TOK, validBody, '6.6.6.6')).status;
    expect(last).toBe(429);
  });
});
