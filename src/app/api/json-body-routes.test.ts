import { beforeEach, describe, expect, it, vi } from 'vitest';

// Four JSON routes of the agent console and the public widget, pinned at the part every one of them repeats: who is
// let in, in what order, and how the body is read — the size cap (and what it measures), the 413 and 400 answers and
// their wording. What each route does AFTER a valid body is covered by one pass-through case per route.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/security/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/security/rate-limit')>()),
  rateLimit: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/ops/device-telemetry', () => ({
  isDeviceTelemetryEnabled: vi.fn(),
  appendTelemetryLines: vi.fn(),
  renderTelemetryLine: vi.fn(),
}));
vi.mock('@/lib/data/widget-sdk-auth', () => ({ signOneTimeKeyForWidget: vi.fn() }));
vi.mock('@/lib/data/console-calls', () => ({ resolveDialTarget: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { resolveDialTarget } from '@/lib/data/console-calls';
import { signOneTimeKeyForWidget } from '@/lib/data/widget-sdk-auth';
import { isDeviceTelemetryEnabled } from '@/lib/ops/device-telemetry';
import { rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

import { POST as shift } from './agents/shift/route';
import { POST as telemetry } from './agents/telemetry/route';
import { POST as dialIntent } from './console-calls/dial-intent/route';
import { POST as widgetSdkAuth } from './widget/sdk-auth/route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const TOO_LARGE = 'בקשה גדולה מדי';
const INVALID_BODY = 'גוף הבקשה אינו תקין';

const upsert = vi.fn();

function post(raw: string, headers: Record<string, string> = {}): Request {
  return new Request('https://beta.kalfa.me/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x', ...headers },
    body: raw,
  });
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({ error });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: { from: () => ({ upsert }) } },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
  vi.mocked(rateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(isDeviceTelemetryEnabled).mockReturnValue(true);
  upsert.mockResolvedValue({ error: null });
});

const ROUTES = [
  { name: 'agents/shift', handler: shift, cap: 4 * 1024, measure: 'string-length', schemaError: 'בקשה לא תקינה' },
  { name: 'agents/telemetry', handler: telemetry, cap: 64 * 1024, measure: 'string-length', schemaError: 'בקשה לא תקינה' },
  { name: 'widget/sdk-auth', handler: widgetSdkAuth, cap: 2_048, measure: 'string-length', schemaError: 'מפתח חד-פעמי אינו תקין' },
  { name: 'console-calls/dial-intent', handler: dialIntent, cap: 2_048, measure: 'utf8-bytes', schemaError: INVALID_BODY },
] as const;

describe.each(ROUTES)('$name — reading the body', (route) => {
  it('413 on a body one character over the cap', async () => {
    await expectError(await route.handler(post('x'.repeat(route.cap + 1))), 413, TOO_LARGE);
  });

  it('measures the cap in its own unit: characters, or bytes on the wire', async () => {
    // Hebrew letters are two bytes each in UTF-8: under the cap as a string, over it on the wire.
    const hebrew = 'א'.repeat(Math.floor(route.cap * 0.75));
    const res = await route.handler(post(hebrew));
    if (route.measure === 'utf8-bytes') await expectError(res, 413, TOO_LARGE);
    else await expectError(res, 400, INVALID_BODY);
  });

  it('400 on a body that is not JSON, and on an empty one', async () => {
    await expectError(await route.handler(post('{not json')), 400, INVALID_BODY);
    await expectError(await route.handler(post('')), 400, INVALID_BODY);
  });

  it('400 with its own wording on JSON its schema refuses', async () => {
    await expectError(await route.handler(post(JSON.stringify({ smuggled: 1 }))), 400, route.schemaError);
  });
});

describe('who is let in before the body is read', () => {
  // A body that would be refused for its size: reaching the 413 would mean the gate was skipped.
  const oversized = () => post('x'.repeat(70 * 1024));

  it.each([
    ['agents/shift', shift],
    ['agents/telemetry', telemetry],
  ] as const)('%s answers the console-agent refusal as it is', async (_name, handler) => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({ ok: false, status: 401, error: 'לא מורשה' } as never);
    await expectError(await handler(oversized()), 401, 'לא מורשה');
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it('agents/shift rate-limits per agent, 20 a minute', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as never);
    await expectError(await shift(oversized()), 429, 'יותר מדי בקשות — נסו שוב בעוד רגע');
    expect(rateLimit).toHaveBeenCalledWith(`agent-shift:${USER_ID}`, { limit: 20, windowMs: 60_000 });
  });

  it('agents/telemetry says the channel is off before it rate-limits, then 40 a minute per agent', async () => {
    vi.mocked(isDeviceTelemetryEnabled).mockReturnValue(false);
    await expectError(await telemetry(oversized()), 503, 'ערוץ האבחון כבוי');
    expect(rateLimit).not.toHaveBeenCalled();

    vi.mocked(isDeviceTelemetryEnabled).mockReturnValue(true);
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as never);
    await expectError(await telemetry(oversized()), 429, 'יותר מדי בקשות — נסו שוב בעוד רגע');
    expect(rateLimit).toHaveBeenCalledWith(`agent-telemetry:${USER_ID}`, { limit: 40, windowMs: 60_000 });
  });

  it('widget/sdk-auth has no session: it rate-limits per IP, 5 a minute', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as never);
    await expectError(await widgetSdkAuth(oversized()), 429, 'יותר מדי בקשות — נסו שוב בעוד רגע');
    const [key, limits] = vi.mocked(rateLimit).mock.calls[0];
    expect(key.startsWith('widget-sdk-auth:')).toBe(true);
    expect(limits).toEqual({ limit: 5, windowMs: 60_000 });
    expect(requireConsoleAgent).not.toHaveBeenCalled();
  });

  it('console-calls/dial-intent needs a console agent (401) who holds manage_voice (403)', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({ ok: false, status: 401, error: 'לא מורשה' } as never);
    await expectError(await dialIntent(oversized()), 401, 'לא מורשה');
    expect(callerHasPlatformPermission).not.toHaveBeenCalled();

    vi.mocked(requireConsoleAgent).mockResolvedValue({ ok: true, ctx: { userId: USER_ID, supabase: {} } } as never);
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    await expectError(await dialIntent(oversized()), 403, 'אין הרשאה');
    expect(vi.mocked(callerHasPlatformPermission).mock.calls[0][1]).toBe('manage_voice');
    expect(resolveDialTarget).not.toHaveBeenCalled();
  });

  it('console-calls/dial-intent refuses on a declared Content-Length over the cap, whatever the body is', async () => {
    const res = await dialIntent(post(JSON.stringify({ kind: 'callback', id: REQUEST_ID }), { 'content-length': '2049' }));
    await expectError(res, 413, TOO_LARGE);
    expect(resolveDialTarget).not.toHaveBeenCalled();
  });
});

describe('past a valid body', () => {
  it('agents/shift saves the caller\'s own row and answers the state it saved', async () => {
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ insert: vi.fn().mockResolvedValue({}) }) } as never);
    const res = await shift(post(JSON.stringify({ active: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, active: true });
    expect(upsert.mock.calls[0][0]).toMatchObject({ agent_id: USER_ID, active: true });
  });

  it('widget/sdk-auth signs the trimmed key and answers the hash alone', async () => {
    vi.mocked(signOneTimeKeyForWidget).mockReturnValue({ ok: true, hash: 'abc123' } as never);
    const res = await widgetSdkAuth(post(JSON.stringify({ one_time_key: '  key-12345678  ' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: 'abc123' });
    expect(signOneTimeKeyForWidget).toHaveBeenCalledWith('key-12345678');
  });

  it('console-calls/dial-intent resolves the target from the parsed body and passes a refusal on with its reason', async () => {
    vi.mocked(resolveDialTarget).mockResolvedValue({ ok: false, reason: 'dnc' } as never);
    const res = await dialIntent(post(JSON.stringify({ kind: 'callback', id: REQUEST_ID })));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'לא ניתן לחייג כעת', reason: 'dnc' });
    const [target, , options] = vi.mocked(resolveDialTarget).mock.calls[0];
    expect(target).toEqual({ kind: 'callback', id: REQUEST_ID });
    expect(options).toEqual({ allowOutsideHours: false });
  });
});
