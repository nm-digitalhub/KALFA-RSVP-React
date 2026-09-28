import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

import { createOwnerAgentWhatsApp, OwnerAgentWhatsAppError, type OwnerAgentWhatsApp } from './adapter';
import {
  classifyAdapterThrow,
  decodeFollowupId,
  encodeFollowupId,
  FollowupIdError,
  markReadWithTyping,
  removeOwnerAgentReaction,
  sendOwnerAgentButtons,
  sendOwnerAgentList,
  sendOwnerAgentReaction,
  sendOwnerAgentText,
  type OwnerAgentListSection,
} from './send';

const PHONE_ID = '111122223333';
const TOKEN = 'real-token-abc';
const TO = '+972501234567';
const WAMID = 'wamid.HBgMOTcyNTAxMjM0NTY3FQIAERgSQUJDREVGMDEyMzQ1Njc4OQA=';
const INTAKE = '3f2b8c1e-9a4d-4e7b-8c21-5d6e7f809a1b';

const SENTINELS = {
  WHATSAPP_ACCESS_TOKEN: 'SENTINEL_ENV_TOKEN',
  WHATSAPP_PHONE_NUMBER_ID: '999999999999',
  WHATSAPP_APP_SECRET: 'SENTINEL_ENV_SECRET',
  WHATSAPP_VERIFY_TOKEN: 'SENTINEL_ENV_VERIFY',
  WHATSAPP_API_URL: 'https://sentinel.invalid',
} as const;

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

let calls: Captured[];
let responder: (url: string, body: string) => Response | Promise<Response>;

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function lastBody(): Record<string, unknown> {
  const last = calls.at(-1);
  if (!last) throw new Error('no fetch call');
  return JSON.parse(last.body) as Record<string, unknown>;
}

let logged: string[];
let wa: OwnerAgentWhatsApp;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(SENTINELS)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  calls = [];
  logged = [];
  responder = () => json(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.OUT1' }] });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, headers, body });
    return responder(url, body);
  });
  wa = createOwnerAgentWhatsApp(
    { accessToken: TOKEN, appSecret: 'real-secret', phoneNumberId: PHONE_ID },
    { logSink: (code) => logged.push(code) },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('createOwnerAgentWhatsApp', () => {
  it('throws a code on a null or empty field — never falls back to env', () => {
    expect(() => createOwnerAgentWhatsApp({ accessToken: TOKEN, appSecret: null, phoneNumberId: PHONE_ID })).toThrow(
      OwnerAgentWhatsAppError,
    );
    expect(() => createOwnerAgentWhatsApp({ accessToken: null, appSecret: 's', phoneNumberId: PHONE_ID })).toThrow(
      'wa_config_missing_access_token',
    );
    expect(() => createOwnerAgentWhatsApp({ accessToken: '  ', appSecret: 's', phoneNumberId: PHONE_ID })).toThrow(
      'wa_config_missing_access_token',
    );
    expect(() => createOwnerAgentWhatsApp({ accessToken: TOKEN, appSecret: 's', phoneNumberId: '' })).toThrow(
      'wa_config_missing_phone_number_id',
    );
    expect(() => createOwnerAgentWhatsApp({ accessToken: TOKEN, appSecret: 's', phoneNumberId: '12/../me' })).toThrow(
      'wa_config_invalid_phone_number_id',
    );
  });

  it('WHATSAPP_* sentinels never reach a URL, header or body, on every send path', async () => {
    await sendOwnerAgentText(wa, { to: TO, body: 'שלום', replyToWamid: WAMID });
    await sendOwnerAgentButtons(wa, { to: TO, body: 'b', buttons: [{ id: encodeFollowupId(INTAKE, 0), title: 'כן' }] });
    await sendOwnerAgentList(wa, {
      to: TO,
      body: 'b',
      buttonText: 'בחר',
      sections: [{ title: 's', rows: [{ id: encodeFollowupId(INTAKE, 1), title: 'r' }] }],
    });
    await sendOwnerAgentReaction(wa, { to: TO, wamid: WAMID, emoji: '✅' });
    await removeOwnerAgentReaction(wa, { to: TO, wamid: WAMID });
    responder = () => json(200, { success: true });
    await markReadWithTyping(wa, WAMID);

    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(c.url.startsWith(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_ID}/`)).toBe(true);
      expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
      const blob = JSON.stringify(c);
      for (const s of Object.values(SENTINELS)) expect(blob).not.toContain(s);
    }
  });
});

describe('recipient is ours, never state', () => {
  it('a planted Chat state that resolves another phone does not change `to`', async () => {
    const fakeChat = {
      getState: () => ({ get: async () => ({ phone: '972599999999', bsuid: 'IL.ATTACKER1' }) }),
    };
    Reflect.set(wa, 'chat', fakeChat);

    await sendOwnerAgentText(wa, { to: TO, body: 'x' });
    expect(lastBody().to).toBe(TO);
    expect(lastBody()).not.toHaveProperty('recipient');

    await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [{ id: 'a', title: 'a' }] });
    expect(lastBody().to).toBe(TO);
    expect(lastBody()).not.toHaveProperty('recipient');

    await sendOwnerAgentReaction(wa, { to: TO, wamid: WAMID, emoji: '👍' });
    expect(lastBody().to).toBe(TO);
    expect(lastBody()).not.toHaveProperty('recipient');
  });

  it('text goes out verbatim, one message, with the reply context', async () => {
    const body = '**לא** מומר ~~בכלל~~';
    const out = await sendOwnerAgentText(wa, { to: TO, body, replyToWamid: WAMID });
    expect(out).toEqual({ kind: 'accepted', providerId: 'wamid.OUT1' });
    expect(calls).toHaveLength(1);
    expect(lastBody()).toMatchObject({ type: 'text', text: { body }, context: { message_id: WAMID } });
  });
});

describe('DeliveryOutcome mapping', () => {
  it('131047 → definitely_not_sent', async () => {
    responder = () => json(400, { error: { code: 131047, message: 'Re-engagement message' } });
    const out = await sendOwnerAgentText(wa, { to: TO, body: 'x' });
    expect(out).toEqual({
      kind: 'definitely_not_sent',
      reason: 'provider_rejected',
      providerStatus: 400,
      providerCode: '131047',
    });
  });

  it('130429 (throttle) → a known rejection with its code', async () => {
    responder = () => json(429, { error: { code: 130429, message: 'Rate limit hit' } });
    const out = await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [{ id: 'a', title: 'a' }] });
    expect(out).toMatchObject({ kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: '130429' });
  });

  it('an error Meta flags is_transient → unknown, never resent', async () => {
    responder = () => json(500, { error: { code: 131000, message: 'Something went wrong', is_transient: true } });
    const out = await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [{ id: 'a', title: 'a' }] });
    expect(out).toMatchObject({ kind: 'unknown', reason: 'provider_error', providerCode: '131000' });
  });

  it('a transport throw → unknown', async () => {
    responder = () => {
      throw new TypeError('fetch failed');
    };
    expect(await sendOwnerAgentText(wa, { to: TO, body: 'x' })).toEqual({ kind: 'unknown', reason: 'send_threw' });
    expect(classifyAdapterThrow(new Error('anything'))).toEqual({ kind: 'unknown', reason: 'send_threw' });
    expect(classifyAdapterThrow(null)).toEqual({ kind: 'unknown', reason: 'send_threw' });
  });

  it('a 2xx without a message id → unknown', async () => {
    responder = () => json(200, { messaging_product: 'whatsapp', messages: [] });
    expect(await sendOwnerAgentText(wa, { to: TO, body: 'x' })).toMatchObject({ kind: 'unknown' });
    expect(await sendOwnerAgentReaction(wa, { to: TO, wamid: WAMID, emoji: '👍' })).toEqual({
      kind: 'unknown',
      reason: 'missing_message_id',
    });
  });

  it('a hung request → unknown timeout', async () => {
    responder = () => new Promise<Response>(() => {});
    expect(await sendOwnerAgentText(wa, { to: TO, body: 'x', timeoutMs: 20 })).toEqual({
      kind: 'unknown',
      reason: 'timeout',
    });
  });

  it('reasons never carry Meta text or the phone', async () => {
    responder = () => json(400, { error: { code: 131026, message: `cannot deliver to ${TO}` } });
    const out = await sendOwnerAgentText(wa, { to: TO, body: 'x' });
    expect(out.kind).toBe('definitely_not_sent');
    expect(JSON.stringify(out)).not.toContain('972501234567');
    expect(JSON.stringify(out)).not.toContain('cannot deliver');
  });
});

describe('local limits (checked before any request)', () => {
  const row = (i: number) => ({ id: `r${i}`, title: `row ${i}` });

  it('rejects a bad recipient / body / context with zero fetch', async () => {
    expect(await sendOwnerAgentText(wa, { to: 'IL.abc123', body: 'x' })).toEqual({
      kind: 'definitely_not_sent',
      reason: 'invalid_recipient',
    });
    expect((await sendOwnerAgentText(wa, { to: TO, body: '   ' })).kind).toBe('definitely_not_sent');
    expect((await sendOwnerAgentText(wa, { to: TO, body: 'א'.repeat(4097) })).kind).toBe('definitely_not_sent');
    expect((await sendOwnerAgentText(wa, { to: TO, body: 'x', replyToWamid: 'has space' })).kind).toBe(
      'definitely_not_sent',
    );
    expect(calls).toHaveLength(0);
  });

  it('buttons: ≤3, title ≤20 code points, unique ids', async () => {
    const four = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `t${i}` }));
    expect(await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: four })).toEqual({
      kind: 'definitely_not_sent',
      reason: 'invalid_interactive',
    });
    expect((await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [{ id: 'a', title: 'x'.repeat(21) }] })).kind)
      .toBe('definitely_not_sent');
    expect(
      (await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [{ id: 'a', title: 'a' }, { id: 'a', title: 'b' }] }))
        .kind,
    ).toBe('definitely_not_sent');
    expect((await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [] })).kind).toBe('definitely_not_sent');
    expect(calls).toHaveLength(0);

    // 20 emoji = 20 characters, not 40 UTF-16 units.
    const out = await sendOwnerAgentButtons(wa, { to: TO, body: 'x', buttons: [{ id: 'a', title: '👍'.repeat(20) }] });
    expect(out.kind).toBe('accepted');
  });

  it('list: ≤10 rows in total across sections, title 24, description 72, id 200', async () => {
    const split: OwnerAgentListSection[] = [
      { title: 'a', rows: [0, 1, 2, 3, 4, 5].map(row) },
      { title: 'b', rows: [6, 7, 8, 9, 10].map(row) },
    ];
    const base = { to: TO, body: 'x', buttonText: 'בחר' };
    expect(await sendOwnerAgentList(wa, { ...base, sections: split })).toEqual({
      kind: 'definitely_not_sent',
      reason: 'invalid_interactive',
    });
    const one = (r: { id: string; title: string; description?: string }) => [{ title: 's', rows: [r] }];
    expect((await sendOwnerAgentList(wa, { ...base, sections: one({ id: 'a', title: 'x'.repeat(25) }) })).kind).toBe(
      'definitely_not_sent',
    );
    expect(
      (await sendOwnerAgentList(wa, { ...base, sections: one({ id: 'a', title: 't', description: 'd'.repeat(73) }) }))
        .kind,
    ).toBe('definitely_not_sent');
    expect((await sendOwnerAgentList(wa, { ...base, sections: one({ id: 'i'.repeat(201), title: 't' }) })).kind).toBe(
      'definitely_not_sent',
    );
    expect((await sendOwnerAgentList(wa, { ...base, buttonText: 'x'.repeat(21), sections: one(row(1)) })).kind).toBe(
      'definitely_not_sent',
    );
    expect(calls).toHaveLength(0);

    const ten: OwnerAgentListSection[] = [
      { title: 'a', rows: [0, 1, 2, 3, 4].map(row) },
      { title: 'b', rows: [5, 6, 7, 8, 9].map(row) },
    ];
    expect((await sendOwnerAgentList(wa, { ...base, sections: ten })).kind).toBe('accepted');
    expect(lastBody()).toMatchObject({ type: 'interactive', interactive: { type: 'list' } });
  });
});

describe('markReadWithTyping', () => {
  it('sends read + typing for the named wamid', async () => {
    responder = () => json(200, { success: true });
    expect(await markReadWithTyping(wa, WAMID)).toEqual({ kind: 'ok' });
    expect(lastBody()).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: WAMID,
      typing_indicator: { type: 'text' },
    });
  });

  it('never throws: error, timeout, bad wamid are codes', async () => {
    responder = () => json(400, { error: { code: 131009, message: 'x' } });
    expect(await markReadWithTyping(wa, WAMID)).toEqual({ kind: 'failed', code: 'typing_provider_131009' });
    responder = () => new Promise<Response>(() => {});
    expect(await markReadWithTyping(wa, WAMID, 20)).toEqual({ kind: 'failed', code: 'typing_timeout' });
    expect(await markReadWithTyping(wa, '')).toEqual({ kind: 'failed', code: 'typing_invalid_wamid' });
  });
});

describe('quiet logger', () => {
  it('emits codes only — no Meta body, phone, token or ids', async () => {
    responder = () =>
      json(400, { error: { code: 131026, message: `recipient ${TO} failed`, error_data: { details: WAMID } } });
    await sendOwnerAgentText(wa, { to: TO, body: 'secret body' });
    await sendOwnerAgentReaction(wa, { to: TO, wamid: WAMID, emoji: '👍' });
    expect(logged.length).toBeGreaterThan(0);
    for (const code of logged) expect(code).toMatch(/^wa_[a-z_]+$/);
    const all = logged.join('|');
    for (const s of ['972501234567', TOKEN, WAMID, 'secret body', 'failed']) expect(all).not.toContain(s);
  });
});

describe('follow-up ids', () => {
  it('round-trips and has the documented shape', () => {
    const id = encodeFollowupId(INTAKE, 3);
    expect(id).toBe(`oa:fu:${INTAKE}:3`);
    expect(id.length).toBeLessThanOrEqual(200);
    expect(decodeFollowupId(id)).toEqual({ intakeId: INTAKE, n: 3 });
    expect(decodeFollowupId(encodeFollowupId(INTAKE.toUpperCase(), 0))).toEqual({ intakeId: INTAKE, n: 0 });
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'oa:fu:',
      `oa:fu:${INTAKE}`,
      `oa:fu:${INTAKE}:10`,
      `oa:fu:${INTAKE}:-1`,
      `oa:fu:${INTAKE}:1:extra`,
      `xx:fu:${INTAKE}:1`,
      'oa:fu:not-a-uuid:1',
      `oa:fu:${INTAKE.toUpperCase()}:1`,
      `rsvp_yes_${INTAKE}`,
    ]) {
      expect(decodeFollowupId(bad)).toBeNull();
    }
    expect(() => encodeFollowupId('nope', 1)).toThrow(FollowupIdError);
    expect(() => encodeFollowupId(INTAKE, 10)).toThrow(FollowupIdError);
    expect(() => encodeFollowupId(INTAKE, 1.5)).toThrow(FollowupIdError);
  });
});
