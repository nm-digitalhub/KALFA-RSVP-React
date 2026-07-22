import { beforeEach, describe, expect, it, vi } from 'vitest';

// Branch B: the ctx/cb routes authenticate by the row's opaque per-call
// access_token (looked up server-side) — NOT a signed/purpose token. The ctx
// response carries only invitation fields. These tests mock the token→row
// lookups directly.

// agent-tool-guard.ts begins with `import 'server-only'` (throws outside a server
// context); stub it, same convention as call-result-processing.test.ts.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/data/call-attempts', () => ({
  getCallContextByAccessToken: vi.fn(),
  getCallAttemptByAccessToken: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookEvents: vi.fn(async () => {}) }));
vi.mock('@/lib/data/console-monitor', () => ({ advanceLegStatus: vi.fn(async () => {}) }));
vi.mock('@/lib/data/call-result-processing', () => ({
  processCallRsvp: vi.fn(async () => ({ status: 'saved' })),
  processCallDnc: vi.fn(async () => ({ ok: true })),
  processOwnerNote: vi.fn(async () => ({ ok: true })),
}));

import { GET } from './ctx/[token]/route';
import { POST } from './cb/[token]/route';
import { POST as saveRsvpPOST } from './agent-tool/rsvp/[token]/route';
import { POST as dncPOST } from './agent-tool/dnc/[token]/route';
import { POST as notePOST } from './agent-tool/note/[token]/route';
import {
  processCallDnc,
  processCallRsvp,
  processOwnerNote,
} from '@/lib/data/call-result-processing';
import {
  getCallContextByAccessToken,
  getCallAttemptByAccessToken,
} from '@/lib/data/call-attempts';
import { insertWebhookEvents } from '@/lib/data/webhooks';
import { advanceLegStatus } from '@/lib/data/console-monitor';
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
function rsvpReq(token: string, body: string, ip = '7.7.7.7', headers: Record<string, string> = {}) {
  return new Request(`https://beta.kalfa.me/api/voximplant/agent-tool/rsvp/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...headers },
    body,
  });
}
const rsvpCall = (token: string, body: string, ip?: string, headers?: Record<string, string>) =>
  saveRsvpPOST(rsvpReq(token, body, ip, headers), { params: Promise.resolve({ token }) });
function toolReq(path: string, token: string, body: string, ip = '3.3.3.3') {
  return new Request(`https://beta.kalfa.me/api/voximplant/agent-tool/${path}/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body,
  });
}
const dncCall = (token: string, body: string, ip?: string) =>
  dncPOST(toolReq('dnc', token, body, ip), { params: Promise.resolve({ token }) });
const noteCall = (token: string, body: string, ip?: string) =>
  notePOST(toolReq('note', token, body, ip), { params: Promise.resolve({ token }) });

const CTX = {
  attempt: {
    id: AID,
    status: 'dialing',
    token_expires_at: FUTURE(),
    guest_id: 'g1',
    event_id: 'ev1',
    contact_id: 'ct1',
    el_correlation_nonce: 'nonce_test_abc',
  },
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
  vi.mocked(getCallAttemptByAccessToken).mockResolvedValue({
    id: AID,
    token_expires_at: FUTURE(),
  } as never);
});

describe('ctx GET', () => {
  it('valid → 200 with the invitation fields only, no PII and no provider key', async () => {
    const res = await ctxCall(TOK);
    expect(res.status).toBe(200);
    // Token-bearing URL + guest data in the body: must never be cacheable.
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual([
      'event_address',
      'event_celebrants',
      'event_date',
      'event_name',
      'event_rsvp_deadline',
      'event_time',
      'event_venue',
      'guest_name',
      'kalfa_attempt_token',
    ]);
    expect(json.guest_name).toBe('ישראל'); // first name only
    expect(json.event_name).toBe('חתונה');
    expect(json.event_venue).toBe('אולם הגן');
    // Additive item-2 link field: the row's non-authorizing correlation nonce.
    expect(json.kalfa_attempt_token).toBe('nonce_test_abc');
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
    const res = await ctxCall(TOK);
    expect(res.status).toBe(404);
    // Error paths must carry no-store too — the URL still bears the token.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('event not active → 404', async () => {
    vi.mocked(getCallContextByAccessToken).mockResolvedValue({ ...CTX, event: { ...CTX.event, status: 'closed' } } as never);
    expect((await ctxCall(TOK)).status).toBe(404);
  });
  it('terminal attempt status → 404', async () => {
    vi.mocked(getCallContextByAccessToken).mockResolvedValue({ ...CTX, attempt: { ...CTX.attempt, status: 'completed' } } as never);
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
    expect(res.headers.get('cache-control')).toBe('no-store');
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
    const res = await cbCall(TOK, '{not json');
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
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

  // Human-agent supervisor leg status (monitor/takeover) is handled OUT-OF-BAND:
  // it advances the leg row, does NOT queue to the webhook drain, and is SCOPED to
  // the token's attempt so a token can never move another call's leg.
  it('leg status connected → 200, advances the leg scoped to the token attempt, no drain', async () => {
    const b = JSON.stringify({ kind: 'human_leg', request_id: 'rid-9', leg_status: 'connected' });
    const res = await cbCall(TOK, b);
    expect(res.status).toBe(200);
    expect(advanceLegStatus).toHaveBeenCalledWith(AID, 'rid-9', 'connected', undefined);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('leg failed with a numeric code → coerced to string, terminal state advanced', async () => {
    const b = JSON.stringify({ kind: 'human_leg', request_id: 'rid-9', leg_status: 'failed', failure_code: 486 });
    expect((await cbCall(TOK, b)).status).toBe(200);
    expect(advanceLegStatus).toHaveBeenCalledWith(AID, 'rid-9', 'failed', '486');
  });
  it('leg status on an unknown token → 404, never advances a leg', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue(null);
    const b = JSON.stringify({ kind: 'human_leg', request_id: 'rid-9', leg_status: 'connected' });
    expect((await cbCall(TOK, b)).status).toBe(404);
    expect(advanceLegStatus).not.toHaveBeenCalled();
  });
  it('leg status with an unknown leg_status → 400 (strictObject/enum), no advance', async () => {
    const b = JSON.stringify({ kind: 'human_leg', request_id: 'rid-9', leg_status: 'spying' });
    expect((await cbCall(TOK, b)).status).toBe(400);
    expect(advanceLegStatus).not.toHaveBeenCalled();
  });
});

describe('agent-tool save_rsvp POST', () => {
  const attendingBody = JSON.stringify({ attending: true, adults: 2, children: 1, tool_call_id: 'tc1' });

  it('valid attending → 200 {ok:true}, persists call_rsvp with value-hash dedupe + syncs', async () => {
    const res = await rsvpCall(TOK, attendingBody);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, status: 'saved' });
    expect(insertWebhookEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'voximplant',
        event_kind: 'call_rsvp',
        dedupe_key: expect.stringMatching(new RegExp(`^vox-rsvp:${AID}:[0-9a-f]{16}$`)),
        message_id: AID,
      }),
    ]);
    expect(processCallRsvp).toHaveBeenCalledWith(AID, expect.objectContaining({ attending: true, adults: 2, children: 1 }));
  });

  it('declined → 200 and still persists + syncs', async () => {
    const res = await rsvpCall(TOK, JSON.stringify({ attending: false, adults: 0, children: 0 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'saved' });
    expect(processCallRsvp).toHaveBeenCalled();
  });

  it('distinct answers → distinct dedupe_key (a mid-call correction persists separately)', async () => {
    await rsvpCall(TOK, JSON.stringify({ attending: true, adults: 2, children: 0 }));
    await rsvpCall(TOK, JSON.stringify({ attending: true, adults: 3, children: 0 }));
    const keys = vi.mocked(insertWebhookEvents).mock.calls.map((c) => (c[0][0] as { dedupe_key: string }).dedupe_key);
    expect(keys[0]).not.toBe(keys[1]);
  });

  // The contract the agent's wording depends on: HTTP 200 is NOT business success.
  // Only `ok:true && status:'saved'` may be voiced as "נרשם".
  it('business rejection → 200 {ok:false, status:rejected, reason} — never "saved"', async () => {
    vi.mocked(processCallRsvp).mockResolvedValueOnce({
      status: 'rejected',
      reason: 'closed',
    });
    const res = await rsvpCall(TOK, attendingBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      status: 'rejected',
      reason: 'closed',
    });
    expect(insertWebhookEvents).toHaveBeenCalled();
  });

  it('applied → 200 {ok:true, status:saved} — the ONLY shape that permits "נרשם"', async () => {
    vi.mocked(processCallRsvp).mockResolvedValueOnce({ status: 'saved' });
    const res = await rsvpCall(TOK, attendingBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'saved' });
  });

  it('transient throw → 200 {ok:false, status:queued} — durable row drives the retry', async () => {
    vi.mocked(processCallRsvp).mockRejectedValueOnce(new Error('db down'));
    const res = await rsvpCall(TOK, attendingBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, status: 'queued' });
    expect(insertWebhookEvents).toHaveBeenCalled();
  });

  it('unknown token → 404 (no persist)', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue(null);
    const res = await rsvpCall(TOK, attendingBody);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('expired token → 404 (no persist)', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue({ id: AID, token_expires_at: PAST() } as never);
    expect((await rsvpCall(TOK, attendingBody)).status).toBe(404);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('invalid JSON → 400 (no persist)', async () => {
    expect((await rsvpCall(TOK, '{bad')).status).toBe(400);
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('attending with zero people → 400 (refine)', async () => {
    expect((await rsvpCall(TOK, JSON.stringify({ attending: true, adults: 0, children: 0 }))).status).toBe(400);
  });
  it('unknown extra field → 400 (strictObject)', async () => {
    expect((await rsvpCall(TOK, JSON.stringify({ attending: true, adults: 1, children: 0, x: 1 }))).status).toBe(400);
  });
  it('out-of-range count → 400', async () => {
    expect((await rsvpCall(TOK, JSON.stringify({ attending: true, adults: 99, children: 0 }))).status).toBe(400);
  });
  it('rate limit trips → 429 (fail-closed)', async () => {
    let last = 200;
    for (let i = 0; i < 33; i++) last = (await rsvpCall(TOK, attendingBody, '4.4.4.4')).status;
    expect(last).toBe(429);
  });

  it('canonical status field: maybe → 200, processed with status maybe', async () => {
    const res = await rsvpCall(TOK, JSON.stringify({ status: 'maybe', adults: 0, children: 0 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'saved' });
    expect(processCallRsvp).toHaveBeenCalledWith(AID, expect.objectContaining({ status: 'maybe' }));
  });
  it('status attending with zero people → 400 (refine applies to canonical status)', async () => {
    expect((await rsvpCall(TOK, JSON.stringify({ status: 'attending', adults: 0, children: 0 }))).status).toBe(400);
  });
  it('neither status nor attending → 400', async () => {
    expect((await rsvpCall(TOK, JSON.stringify({ adults: 1, children: 0 }))).status).toBe(400);
  });
});

describe('agent-tool mark_dnc POST', () => {
  it('valid → 200 {ok:true}, persists call_dnc idempotently + syncs', async () => {
    const res = await dncCall(TOK, JSON.stringify({ tool_call_id: 'tc9' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(insertWebhookEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'voximplant',
        event_kind: 'call_dnc',
        dedupe_key: `vox-dnc:${AID}`,
        message_id: AID,
      }),
    ]);
    expect(processCallDnc).toHaveBeenCalledWith(AID);
  });
  it('empty body → still valid (no params in the contract)', async () => {
    expect((await dncCall(TOK, '')).status).toBe(200);
  });
  it('unknown token → 404 (no persist)', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue(null);
    const res = await dncCall(TOK, '{}');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
  it('extra field → 400 (strictObject)', async () => {
    expect((await dncCall(TOK, JSON.stringify({ phone: '0501234567' }))).status).toBe(400);
  });
  it('sync failure → 200 {ok:false} with durable row persisted', async () => {
    vi.mocked(processCallDnc).mockResolvedValueOnce({ ok: false });
    const res = await dncCall(TOK, '{}');
    expect(await res.json()).toEqual({ ok: false });
    expect(insertWebhookEvents).toHaveBeenCalled();
  });
});

describe('agent-tool notify_owner POST', () => {
  const noteBody = JSON.stringify({ kind: 'question', text: 'האם יש חניה באולם?' });

  it('valid → 200 {ok:true}, persists with note-hash dedupe + syncs', async () => {
    const res = await noteCall(TOK, noteBody);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(insertWebhookEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'voximplant',
        event_kind: 'call_owner_note',
        dedupe_key: expect.stringMatching(new RegExp(`^vox-note:${AID}:[0-9a-f]{16}$`)),
        message_id: AID,
      }),
    ]);
    expect(processOwnerNote).toHaveBeenCalledWith(
      AID,
      expect.objectContaining({ kind: 'question', text: 'האם יש חניה באולם?' }),
    );
  });
  it('missing text → 400', async () => {
    expect((await noteCall(TOK, JSON.stringify({ kind: 'question' }))).status).toBe(400);
  });
  it('text over 500 chars → 400', async () => {
    const b = JSON.stringify({ kind: 'message', text: 'א'.repeat(501) });
    expect((await noteCall(TOK, b)).status).toBe(400);
  });
  it('bad kind → 400', async () => {
    expect((await noteCall(TOK, JSON.stringify({ kind: 'spam', text: 'x' }))).status).toBe(400);
  });
  it('expired token → 404 (no persist)', async () => {
    vi.mocked(getCallAttemptByAccessToken).mockResolvedValue({ id: AID, token_expires_at: PAST() } as never);
    const res = await noteCall(TOK, noteBody);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(insertWebhookEvents).not.toHaveBeenCalled();
  });
});
