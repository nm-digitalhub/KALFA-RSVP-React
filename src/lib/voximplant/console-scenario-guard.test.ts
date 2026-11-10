import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import { guardConsoleScenarioRequest } from './console-scenario-guard';

const SECRET = 'test-console-secret';
const schema = z.strictObject({ secret: z.string(), token: z.string() });
const OPTS = {
  scope: 'test-console',
  rate: { limit: 100, windowMs: 60_000 },
  maxBodyBytes: 256,
  schema,
} as const;

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://beta.kalfa.me/api/voximplant/console/x', {
    method: 'POST',
    headers: { 'x-real-ip': '4.4.4.4', ...headers },
    body,
  });
}
const valid = () => JSON.stringify({ secret: SECRET, token: 't' });

describe('guardConsoleScenarioRequest', () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
    vi.stubEnv('KALFA_CONSOLE_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('passes a well-formed body carrying the secret and returns the parsed data', async () => {
    const res = await guardConsoleScenarioRequest(req(valid()), OPTS);
    expect(res).toEqual({ ok: true, data: { secret: SECRET, token: 't' } });
  });

  it('rate-limits per scope and IP before reading anything', async () => {
    const opts = { ...OPTS, rate: { limit: 1, windowMs: 60_000 } };
    expect((await guardConsoleScenarioRequest(req(valid()), opts)).ok).toBe(true);
    // Even a garbage body is answered by the limiter, not by the parser.
    expect(await guardConsoleScenarioRequest(req('not json'), opts)).toEqual({
      ok: false,
      reason: 'rate_limited',
      status: 429,
    });
    // A different IP has its own budget.
    expect(
      (await guardConsoleScenarioRequest(req(valid(), { 'x-real-ip': '5.5.5.5' }), opts)).ok,
    ).toBe(true);
  });

  it('refuses on a declared Content-Length over the cap', async () => {
    const res = await guardConsoleScenarioRequest(req(valid(), { 'content-length': '9999' }), OPTS);
    expect(res).toEqual({ ok: false, reason: 'body_too_large', status: 413 });
  });

  it('refuses a body whose real size is over the cap', async () => {
    const big = JSON.stringify({ secret: SECRET, token: 'x'.repeat(400) });
    const res = await guardConsoleScenarioRequest(req(big), OPTS);
    expect(res).toEqual({ ok: false, reason: 'body_too_large', status: 413 });
  });

  it('answers 400 for non-JSON and for a body outside the schema', async () => {
    expect(await guardConsoleScenarioRequest(req('{nope'), OPTS)).toEqual({
      ok: false,
      reason: 'invalid_body',
      status: 400,
    });
    const extra = JSON.stringify({ secret: SECRET, token: 't', more: 1 });
    expect(await guardConsoleScenarioRequest(req(extra), OPTS)).toEqual({
      ok: false,
      reason: 'invalid_body',
      status: 400,
    });
  });

  it('fails closed with 503 when the secret is unset — even for a matching-looking body', async () => {
    vi.stubEnv('KALFA_CONSOLE_SECRET', '');
    expect(await guardConsoleScenarioRequest(req(valid()), OPTS)).toEqual({
      ok: false,
      reason: 'secret_unset',
      status: 503,
    });
  });

  it('answers 401 for a wrong secret', async () => {
    for (const secret of ['other', `${SECRET}x`, '']) {
      const res = await guardConsoleScenarioRequest(req(JSON.stringify({ secret, token: 't' })), OPTS);
      expect(res).toEqual({ ok: false, reason: 'secret_mismatch', status: 401 });
    }
  });

  it('checks the schema before the secret (a malformed body never reaches the compare)', async () => {
    vi.stubEnv('KALFA_CONSOLE_SECRET', '');
    const res = await guardConsoleScenarioRequest(req(JSON.stringify({ secret: 'x' })), OPTS);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});
