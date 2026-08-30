import { afterEach, describe, expect, it, vi } from 'vitest';

// elevenlabs-quota.ts begins with `import 'server-only'` — stub it (established
// convention: voximplant-balance.test.ts). The read (getElevenLabsQuotaResult) +
// the key resolver + Slack are mocked so evaluateQuotaAlert stays a pure unit and
// runElevenLabsQuotaCheck's wiring is asserted without any real IO.
vi.mock('server-only', () => ({}));
const { keyMock, quotaMock, slackMock } = vi.hoisted(() => ({
  keyMock: vi.fn(),
  quotaMock: vi.fn(),
  slackMock: vi.fn(),
}));
vi.mock('@/lib/data/elevenlabs-status', () => ({
  getElevenLabsApiKeyWithSource: keyMock,
  getElevenLabsQuotaResult: quotaMock,
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));

import { evaluateQuotaAlert, runElevenLabsQuotaCheck } from './elevenlabs-quota';

afterEach(() => vi.clearAllMocks());

// A successful read. The threshold cases care only about the two numbers.
const ok = (count: number | null, limit: number | null) =>
  ({ ok: true as const, data: { characterCount: count, characterLimit: limit, tier: 'creator' } });

describe('evaluateQuotaAlert (pure threshold decision)', () => {
  it('is silent below 80%', () => {
    expect(evaluateQuotaAlert(ok(79, 100))).toBeNull();
    expect(evaluateQuotaAlert(ok(0, 100))).toBeNull();
  });

  it('warns from exactly 80% through 94%', () => {
    expect(evaluateQuotaAlert(ok(80, 100))?.level).toBe('warn');
    expect(evaluateQuotaAlert(ok(94, 100))?.level).toBe('warn');
  });

  it('errors at exactly 95% and above', () => {
    expect(evaluateQuotaAlert(ok(95, 100))?.level).toBe('error');
    expect(evaluateQuotaAlert(ok(100, 100))?.level).toBe('error');
  });

  it('reports used/limit/percent fields (rounded)', () => {
    expect(evaluateQuotaAlert(ok(90, 100))?.fields).toEqual({ used: 90, limit: 100, percent: 90 });
    // 9860/350071 ≈ 2.8% → below threshold → null (the live beta value).
    expect(evaluateQuotaAlert(ok(9860, 350071))).toBeNull();
  });

  it('flags a usable-looking but degenerate quota as a CONTRACT problem, not a key problem', () => {
    // A 200 that parses but carries no usable numbers means ElevenLabs changed
    // the response shape — the published schema marks both fields required.
    const zeroLimit = evaluateQuotaAlert(ok(5, 0));
    expect(zeroLimit?.level).toBe('warn');
    expect(zeroLimit?.fields.reason).toBe('contract_change');
    expect(evaluateQuotaAlert(ok(null, 100))?.fields.reason).toBe('contract_change');
    expect(evaluateQuotaAlert(ok(5, null))?.fields.reason).toBe('contract_change');
  });
});

// The whole point of the rewrite: the operator must be told what actually broke.
// Before this, every one of these produced the identical "the API key is missing
// the user_read permission" message — which sent a real operator to re-issue a
// working key after a single slow response.
describe('evaluateQuotaAlert — failures name their real cause', () => {
  const failWith = (failure: Parameters<typeof evaluateQuotaAlert>[0] extends { ok: true }
    ? never
    : { ok: false; failure: unknown }) => evaluateQuotaAlert(failure as never);

  it('a timeout is reported as a timeout, and never blamed on the key', () => {
    const d = failWith({ ok: false, failure: { kind: 'timeout', timeoutMs: 30000 } });
    expect(d?.level).toBe('warn');
    expect(d?.fields).toEqual({ reason: 'timeout', timeoutMs: 30000 });
    expect(d?.detail).toContain('30');
    expect(d?.detail).not.toContain('user_read');
    expect(d?.detail).not.toContain('הרשאה');
  });

  it('a network failure surfaces the underlying message', () => {
    const d = failWith({ ok: false, failure: { kind: 'network', message: 'ECONNREFUSED' } });
    expect(d?.fields.reason).toBe('network');
    expect(d?.detail).toContain('ECONNREFUSED');
  });

  it('401 IS reported as a genuine key problem (the one case that always was)', () => {
    const d = failWith({
      ok: false,
      failure: { kind: 'http', status: 401, code: 'invalid_api_key', message: 'Invalid API key' },
    });
    expect(d?.fields).toMatchObject({ reason: 'auth', status: 401, code: 'invalid_api_key' });
    expect(d?.detail).toContain('מפתח');
  });

  it('429 is reported as rate limiting, not as a key problem', () => {
    const d = failWith({
      ok: false,
      failure: { kind: 'http', status: 429, code: 'system_busy', message: null },
    });
    expect(d?.fields).toMatchObject({ reason: 'rate_limit', status: 429, code: 'system_busy' });
    expect(d?.detail).toContain('תקין');
  });

  it('5xx is reported as an upstream fault', () => {
    const d = failWith({ ok: false, failure: { kind: 'http', status: 503, code: null, message: null } });
    expect(d?.fields).toMatchObject({ reason: 'upstream_5xx', status: 503 });
  });

  it('a 200 with an unreadable body is reported as an API contract change', () => {
    const d = failWith({ ok: false, failure: { kind: 'malformed', message: 'boom' } });
    expect(d?.fields.reason).toBe('contract_change');
    expect(d?.detail).toContain('boom');
  });
});

describe('runElevenLabsQuotaCheck (fail-safe cron wrapper)', () => {
  it('is a dark-safe no-op when no key is configured', async () => {
    keyMock.mockResolvedValue({ key: null, source: null });
    await runElevenLabsQuotaCheck();
    expect(quotaMock).not.toHaveBeenCalled();
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('alerts send_health as error at ≥95%, tagging the key source', async () => {
    keyMock.mockResolvedValue({ key: 'k', source: 'db' });
    quotaMock.mockResolvedValue(ok(96, 100));
    await runElevenLabsQuotaCheck();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        category: 'send_health',
        source: 'elevenlabs-quota',
        fields: expect.objectContaining({ keySource: 'db', percent: 96 }),
      }),
    );
  });

  it('stays silent below 80%', async () => {
    keyMock.mockResolvedValue({ key: 'k', source: 'db' });
    quotaMock.mockResolvedValue(ok(10, 100));
    await runElevenLabsQuotaCheck();
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('alerts with the REAL reason when the read fails, tagging the key source', async () => {
    keyMock.mockResolvedValue({ key: 'k', source: 'env' });
    quotaMock.mockResolvedValue({ ok: false, failure: { kind: 'timeout', timeoutMs: 30000 } });
    await runElevenLabsQuotaCheck();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        title: expect.stringContaining('לא ניתנת לקריאה'),
        fields: expect.objectContaining({ keySource: 'env', reason: 'timeout' }),
      }),
    );
  });

  it('never throws, and REPORTS an unexpected reader bug instead of swallowing it', async () => {
    // Previously this returned silently, making a broken monitor look identical
    // to a healthy one. Errors must not be swallowed.
    keyMock.mockResolvedValue({ key: 'k', source: 'db' });
    quotaMock.mockRejectedValue(new Error('network blip'));
    await expect(runElevenLabsQuotaCheck()).resolves.toBeUndefined();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ reason: 'network' }),
      }),
    );
    expect(slackMock.mock.calls[0][0].detail).toContain('network blip');
  });
});
