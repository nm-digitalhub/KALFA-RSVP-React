import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/console-calls', async (orig) => ({
  ...(await orig<typeof import('@/lib/data/console-calls')>()),
  getConsoleCallById: vi.fn(),
  getConsoleCallSessionUrls: vi.fn(),
  resolveTransferTarget: vi.fn(),
  resolveExternalDialTarget: vi.fn(),
}));
// Keep the real pickSessionUrl (pure URL selection); stub only the network POST.
vi.mock('@/lib/voximplant/session-command', async (orig) => ({
  ...(await orig<typeof import('@/lib/voximplant/session-command')>()),
  postCommandToSession: vi.fn(),
}));

import {
  deliverConsoleCallCommand,
  deliverParameterlessCallCommand,
  invalidCallIdResponse,
  loadConnectedCustomerCall,
  resolveCallTarget,
} from './live-call-command';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  resolveExternalDialTarget,
  resolveTransferTarget,
} from '@/lib/data/console-calls';
import { postCommandToSession } from '@/lib/voximplant/session-command';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const SECURE_URL = 'https://media.example/request/s/tok';
const ERRORS = { unavailable: 'לא זמינה', undelivered: 'לא נמסרה' };

function call(over: Record<string, unknown> = {}) {
  return { id: CALL_ID, status: 'connected', direction: 'outbound', kind: 'manual', eventId: 'ev-1', ...over };
}

async function refusal(step: { ok: boolean; response?: Response }) {
  if (step.ok || !step.response) throw new Error('expected a refusal');
  return { status: step.response.status, body: await step.response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConsoleCallById).mockResolvedValue(call() as never);
  vi.mocked(getConsoleCallSessionUrls).mockResolvedValue({
    sessionUrl: null,
    secureSessionUrl: SECURE_URL,
  });
  vi.mocked(postCommandToSession).mockResolvedValue({ delivered: true, status: 200 });
});

describe('invalidCallIdResponse', () => {
  it('is null for a UUID and a 400 for anything else', async () => {
    expect(invalidCallIdResponse(CALL_ID)).toBeNull();
    const res = invalidCallIdResponse('not-a-uuid');
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: 'מזהה שיחה לא תקין' });
  });
});

describe('loadConnectedCustomerCall', () => {
  it('returns a connected customer call', async () => {
    expect(await loadConnectedCustomerCall(CALL_ID, 'סוג שגוי')).toEqual({ ok: true, call: call() });
  });

  it('answers 404 for a missing call', async () => {
    vi.mocked(getConsoleCallById).mockResolvedValue(null);
    expect((await refusal(await loadConnectedCustomerCall(CALL_ID, 'סוג שגוי'))).status).toBe(404);
  });

  it("answers 409 with the route's own wording for a non-customer kind", async () => {
    vi.mocked(getConsoleCallById).mockResolvedValue(call({ kind: 'ai_handoff' }) as never);
    expect(await refusal(await loadConnectedCustomerCall(CALL_ID, 'סוג שגוי'))).toEqual({
      status: 409,
      body: { error: 'סוג שגוי' },
    });
  });

  it('answers 409 for a call that is not connected', async () => {
    vi.mocked(getConsoleCallById).mockResolvedValue(call({ status: 'ringing' }) as never);
    expect(await refusal(await loadConnectedCustomerCall(CALL_ID, 'סוג שגוי'))).toEqual({
      status: 409,
      body: { error: 'השיחה אינה מחוברת כעת' },
    });
  });
});

describe('resolveCallTarget', () => {
  it('resolves an agent to a vox_username, an agent audit entry and an agent acknowledgement', async () => {
    vi.mocked(resolveTransferTarget).mockResolvedValue({ ok: true, voxUsername: 'agent_x' });
    const resolved = await resolveCallTarget({ to_agent_id: TARGET_ID }, USER_ID, 'עצמך');
    expect(resolved).toEqual({
      ok: true,
      target: {
        payload: { vox_username: 'agent_x' },
        audit: { toAgentId: TARGET_ID },
        accepted: { target: 'agent', to_agent_id: TARGET_ID },
      },
    });
    expect(resolveTransferTarget).toHaveBeenCalledWith(TARGET_ID, USER_ID);
    expect(resolveExternalDialTarget).not.toHaveBeenCalled();
  });

  it("answers 409 for every agent refusal, with the route's wording for 'self'", async () => {
    vi.mocked(resolveTransferTarget).mockResolvedValue({ ok: false, reason: 'self' });
    expect(await refusal(await resolveCallTarget({ to_agent_id: USER_ID }, USER_ID, 'עצמך'))).toEqual({
      status: 409,
      body: { error: 'עצמך' },
    });
    vi.mocked(resolveTransferTarget).mockResolvedValue({ ok: false, reason: 'not_ready' });
    expect(await refusal(await resolveCallTarget({ to_agent_id: TARGET_ID }, USER_ID, 'עצמך'))).toEqual({
      status: 409,
      body: { error: 'הנציג המבוקש אינו זמין כעת' },
    });
  });

  it('resolves an outside number without ever putting it in the audit entry or the acknowledgement', async () => {
    vi.mocked(resolveExternalDialTarget).mockResolvedValue({ ok: true, phone: '+972501234567' });
    const resolved = await resolveCallTarget({ to_phone: '050-1234567' }, USER_ID, 'עצמך');
    expect(resolved).toEqual({
      ok: true,
      target: {
        payload: { phone: '+972501234567' },
        audit: { externalTarget: true },
        accepted: { target: 'external' },
      },
    });
    expect(resolveExternalDialTarget).toHaveBeenCalledWith('050-1234567', USER_ID);
    expect(resolveTransferTarget).not.toHaveBeenCalled();
  });

  it('answers 429 for a rate-limited outside number and 409 for any other refusal', async () => {
    vi.mocked(resolveExternalDialTarget).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    expect((await refusal(await resolveCallTarget({ to_phone: '1' }, USER_ID, 'עצמך'))).status).toBe(429);
    vi.mocked(resolveExternalDialTarget).mockResolvedValue({ ok: false, reason: 'dnc' });
    expect(await refusal(await resolveCallTarget({ to_phone: '1' }, USER_ID, 'עצמך'))).toEqual({
      status: 409,
      body: { error: 'המספר מופיע ברשימת החסומים' },
    });
  });
});

describe('deliverConsoleCallCommand', () => {
  it('posts the envelope to the HTTPS handle and returns its request id', async () => {
    const delivery = await deliverConsoleCallCommand(CALL_ID, 'transfer', { vox_username: 'agent_x' }, ERRORS);
    expect(delivery.ok).toBe(true);
    if (!delivery.ok) return;
    const [url, envelope] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(url.href).toBe(SECURE_URL);
    expect(envelope).toEqual({
      command: 'transfer',
      request_id: delivery.requestId,
      payload: { vox_username: 'agent_x' },
    });
  });

  it('answers 409 without posting when the call has no usable handle', async () => {
    vi.mocked(getConsoleCallSessionUrls).mockResolvedValue(null);
    expect(await refusal(await deliverConsoleCallCommand(CALL_ID, 'transfer', {}, ERRORS))).toEqual({
      status: 409,
      body: { error: ERRORS.unavailable },
    });
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('answers 502 when the session does not accept the command', async () => {
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    expect(await refusal(await deliverConsoleCallCommand(CALL_ID, 'transfer', {}, ERRORS))).toEqual({
      status: 502,
      body: { error: ERRORS.undelivered },
    });
  });
});

describe('deliverParameterlessCallCommand', () => {
  const audit = vi.fn(async () => undefined);
  const action = {
    command: 'conference_remove',
    wrongKindError: 'סוג שגוי',
    undeliveredError: 'לא נמסרה',
    audit,
    acceptedFlag: 'removing',
  };
  const req = (body?: string) =>
    new Request(`https://beta.kalfa.me/api/console-calls/${CALL_ID}/conference/remove`, {
      method: 'POST',
      body,
    });

  it('delivers an empty-payload command for an empty body, audits it and answers 202', async () => {
    const res = await deliverParameterlessCallCommand(req(), CALL_ID, USER_ID, action);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ removing: true, request_id: expect.any(String) });
    const [, envelope] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(envelope).toEqual({ command: 'conference_remove', request_id: body.request_id, payload: {} });
    expect(audit).toHaveBeenCalledWith({
      fromAgentId: USER_ID,
      consoleCallId: CALL_ID,
      eventId: 'ev-1',
      requestId: body.request_id,
    });
  });

  it('refuses a malformed call id before reading anything else', async () => {
    const res = await deliverParameterlessCallCommand(req('{}'), 'nope', USER_ID, action);
    expect(res.status).toBe(400);
    expect(getConsoleCallById).not.toHaveBeenCalled();
  });

  it('refuses a smuggled field with 400 and an oversized body with 413', async () => {
    const smuggled = await deliverParameterlessCallCommand(req('{"to_agent_id":"x"}'), CALL_ID, USER_ID, action);
    expect(smuggled.status).toBe(400);
    const big = await deliverParameterlessCallCommand(req(`{"a":"${'x'.repeat(300)}"}`), CALL_ID, USER_ID, action);
    expect(big.status).toBe(413);
    expect(getConsoleCallById).not.toHaveBeenCalled();
  });

  it('does not audit a command that was not delivered', async () => {
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    const res = await deliverParameterlessCallCommand(req('{}'), CALL_ID, USER_ID, action);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'לא נמסרה' });
    expect(audit).not.toHaveBeenCalled();
  });
});
