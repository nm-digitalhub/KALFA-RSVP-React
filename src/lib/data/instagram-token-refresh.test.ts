import { afterEach, describe, expect, it, vi } from 'vitest';

// instagram-token-refresh.ts begins with `import 'server-only'` — stub it
// (established convention: elevenlabs-quota.test.ts / voximplant-balance.test.ts).
// node:fs is fully mocked (no established repo precedent for this module, since
// no prior worker cron owns raw file IO — every fs call this module makes is a
// spy so the orchestrator tests run with zero real disk access). fetch is
// stubbed the same way elevenlabs-status.test.ts does it. publish-social's pure
// helpers (classifyGraphApiError etc.) are left UNMOCKED — they have no IO, so
// exercising the real implementation gives better coverage than re-stubbing it.
vi.mock('server-only', () => ({}));
const {
  readFileSyncMock,
  writeFileSyncMock,
  renameSyncMock,
  statSyncMock,
  chmodSyncMock,
  unlinkSyncMock,
  existsSyncMock,
  slackMock,
} = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  renameSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  chmodSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  slackMock: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
  renameSync: renameSyncMock,
  statSync: statSyncMock,
  chmodSync: chmodSyncMock,
  unlinkSync: unlinkSyncMock,
  existsSync: existsSyncMock,
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));

import {
  classifyRefreshFailure,
  computeExpiresAtIso,
  daysUntil,
  parseRefreshSuccessBody,
  parseVerifyResponseId,
  readEnvVar,
  rewriteEnvVars,
  runInstagramTokenRefresh,
} from './instagram-token-refresh';

// resetAllMocks (not clearAllMocks): several tests set a one-off
// mockImplementation (e.g. statSyncMock/writeFileSyncMock throwing) that must
// not leak into the next test — clearAllMocks only resets call history, not a
// configured implementation.
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

// ── pure: env-file parsing/rewriting ────────────────────────────────────────

describe('readEnvVar', () => {
  it('finds a key among unrelated lines, comments, and blanks', () => {
    const content = '# comment\nFOO=bar\n\nMETA_IG_ACCESS_TOKEN=abc123\nBAZ=qux\n';
    expect(readEnvVar(content, 'META_IG_ACCESS_TOKEN')).toBe('abc123');
  });

  it('strips single or double quotes', () => {
    expect(readEnvVar('A="quoted"\n', 'A')).toBe('quoted');
    expect(readEnvVar("A='quoted'\n", 'A')).toBe('quoted');
  });

  it('returns null when the key is absent', () => {
    expect(readEnvVar('A=1\nB=2\n', 'MISSING')).toBeNull();
  });

  it('ignores a non-matching line shape (no false match on a substring key)', () => {
    // META_IG_ACCESS_TOKEN_EXPIRES_AT must not satisfy a lookup for
    // META_IG_ACCESS_TOKEN — the regex match is on the FULL key, not a prefix.
    expect(readEnvVar('META_IG_ACCESS_TOKEN_EXPIRES_AT=2026-01-01\n', 'META_IG_ACCESS_TOKEN')).toBeNull();
  });
});

describe('rewriteEnvVars', () => {
  it('replaces an existing key in place, preserving every other line verbatim', () => {
    const content = '# header\nFOO=bar\nMETA_IG_ACCESS_TOKEN=old\nBAZ=qux\n';
    const out = rewriteEnvVars(content, { META_IG_ACCESS_TOKEN: 'new' });
    expect(out).toBe('# header\nFOO=bar\nMETA_IG_ACCESS_TOKEN=new\nBAZ=qux\n');
  });

  it('appends a missing key at the end', () => {
    const content = 'FOO=bar\n';
    const out = rewriteEnvVars(content, { META_IG_ACCESS_TOKEN_EXPIRES_AT: '2026-10-01T00:00:00.000Z' });
    expect(out).toBe('FOO=bar\nMETA_IG_ACCESS_TOKEN_EXPIRES_AT=2026-10-01T00:00:00.000Z\n');
  });

  it('preserves a missing trailing newline when nothing is appended', () => {
    const content = 'FOO=bar\nMETA_IG_ACCESS_TOKEN=old';
    const out = rewriteEnvVars(content, { META_IG_ACCESS_TOKEN: 'new' });
    expect(out).toBe('FOO=bar\nMETA_IG_ACCESS_TOKEN=new');
  });

  it('adds a trailing newline when appending after content with none', () => {
    const content = 'FOO=bar';
    const out = rewriteEnvVars(content, { NEW_KEY: 'v' });
    expect(out).toBe('FOO=bar\nNEW_KEY=v\n');
  });

  it('updates multiple keys in one pass, replace + append combined', () => {
    const content = 'META_IG_ACCESS_TOKEN=old\n';
    const out = rewriteEnvVars(content, {
      META_IG_ACCESS_TOKEN: 'new',
      META_IG_ACCESS_TOKEN_EXPIRES_AT: '2026-10-01T00:00:00.000Z',
    });
    expect(out).toBe('META_IG_ACCESS_TOKEN=new\nMETA_IG_ACCESS_TOKEN_EXPIRES_AT=2026-10-01T00:00:00.000Z\n');
  });

  it('handles empty original content (append-only)', () => {
    expect(rewriteEnvVars('', { A: '1' })).toBe('A=1\n');
  });
});

// ── pure: Meta response parsing ─────────────────────────────────────────────

describe('parseRefreshSuccessBody', () => {
  it('parses a valid response (Meta doc example shape)', () => {
    const parsed = parseRefreshSuccessBody({ access_token: 'c3oxd...', token_type: 'bearer', expires_in: 5183944 });
    expect(parsed).toEqual({ accessToken: 'c3oxd...', expiresInSeconds: 5183944 });
  });

  it('rejects a missing/non-string access_token', () => {
    expect(parseRefreshSuccessBody({ expires_in: 100 })).toBeNull();
    expect(parseRefreshSuccessBody({ access_token: 123, expires_in: 100 })).toBeNull();
    expect(parseRefreshSuccessBody({ access_token: '', expires_in: 100 })).toBeNull();
  });

  it('rejects a missing/non-number/non-positive expires_in — never coerces via Number()', () => {
    expect(parseRefreshSuccessBody({ access_token: 't' })).toBeNull();
    // A stringly-typed expires_in must be rejected, not Number()-coerced into
    // something that looks plausible (the id-precision lesson applied to this
    // endpoint's own documented Integer field).
    expect(parseRefreshSuccessBody({ access_token: 't', expires_in: '5183944' })).toBeNull();
    expect(parseRefreshSuccessBody({ access_token: 't', expires_in: 0 })).toBeNull();
    expect(parseRefreshSuccessBody({ access_token: 't', expires_in: -1 })).toBeNull();
    expect(parseRefreshSuccessBody({ access_token: 't', expires_in: NaN })).toBeNull();
  });

  it('rejects a non-object body', () => {
    expect(parseRefreshSuccessBody(null)).toBeNull();
    expect(parseRefreshSuccessBody('a string')).toBeNull();
  });
});

describe('parseVerifyResponseId', () => {
  it('reads a flat user_id shape', () => {
    expect(parseVerifyResponseId({ user_id: '178414...', username: 'kalfa' })).toBe('178414...');
  });

  it('reads a flat id shape (generic Graph API single-object convention)', () => {
    expect(parseVerifyResponseId({ id: '178414...' })).toBe('178414...');
  });

  it('reads a data-array-wrapped shape', () => {
    expect(parseVerifyResponseId({ data: [{ user_id: '178414...' }] })).toBe('178414...');
  });

  it('never coerces a numeric id — treats it as absent (precision-loss lesson)', () => {
    expect(parseVerifyResponseId({ user_id: 178414 })).toBeNull();
    expect(parseVerifyResponseId({ data: [{ id: 178414 }] })).toBeNull();
  });

  it('returns null for an empty/absent/malformed body', () => {
    expect(parseVerifyResponseId(null)).toBeNull();
    expect(parseVerifyResponseId({})).toBeNull();
    expect(parseVerifyResponseId({ data: [] })).toBeNull();
  });
});

describe('classifyRefreshFailure', () => {
  it('classifies a "24 hours" message as too_young regardless of exact wording', () => {
    expect(classifyRefreshFailure({ error: { message: 'Token must be at least 24 hours old.' } })).toBe(
      'too_young',
    );
    expect(classifyRefreshFailure({ error: { message: 'has not been issued for 24hours' } })).toBe('too_young');
  });

  it('falls through to classifyGraphApiError for anything else — never guesses silently', () => {
    expect(classifyRefreshFailure({ error: { message: 'Invalid OAuth access token.', code: 190 } })).toBe('auth');
    expect(classifyRefreshFailure({ error: { message: 'rate limited', code: 4 } })).toBe('rate_limit');
    expect(classifyRefreshFailure({ error: { message: 'something else', code: 999 } })).toBe('declined');
    expect(classifyRefreshFailure(null)).toBe('unknown');
  });

  it('never mistakes a rate-limit\'s own "24 hours" wording for too_young (would otherwise go silent)', () => {
    // Meta's rate-limit messages routinely reference their own reset window in
    // hours — "try again in 24 hours" — which would satisfy the bare text
    // heuristic. The code-based classification (rate_limit, code 4) must win
    // so this alerts instead of silently skipping.
    expect(
      classifyRefreshFailure({
        error: { message: 'Application request limit reached, try again in 24 hours', code: 4 },
      }),
    ).toBe('rate_limit');
  });
});

describe('computeExpiresAtIso / daysUntil', () => {
  it('computes an ISO timestamp offset by expires_in seconds', () => {
    const nowMs = Date.parse('2026-08-12T09:40:00.000Z');
    expect(computeExpiresAtIso(5_184_000, nowMs)).toBe('2026-10-11T09:40:00.000Z'); // +60 days
  });

  it('floors whole days remaining, allows negative (already past)', () => {
    const nowMs = Date.parse('2026-08-12T00:00:00.000Z');
    expect(daysUntil('2026-08-26T00:00:00.000Z', nowMs)).toBe(14);
    expect(daysUntil('2026-08-26T23:59:00.000Z', nowMs)).toBe(14); // floored, not rounded up
    expect(daysUntil('2026-08-01T00:00:00.000Z', nowMs)).toBe(-11);
  });

  it('returns null for absent/unparseable input — "unknown" stays distinct from "urgent"', () => {
    expect(daysUntil(null, Date.now())).toBeNull();
    expect(daysUntil('not-a-date', Date.now())).toBeNull();
  });
});

// ── orchestrator ─────────────────────────────────────────────────────────────

const NOW_MS = Date.parse('2026-08-12T09:40:00.000Z');
const ENV_FIXTURE = 'FOO=bar\nMETA_IG_ACCESS_TOKEN=old-token\n';

function stubFetchSequence(responses: Array<{ ok: boolean; status?: number; json: unknown }>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.json,
    } as unknown as Response);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('runInstagramTokenRefresh', () => {
  it('alerts and makes no network call when META_IG_ACCESS_TOKEN is missing', async () => {
    readFileSyncMock.mockReturnValue('FOO=bar\n');
    const fetchMock = stubFetchSequence([]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', category: 'send_health', title: expect.stringContaining('חסר') }),
    );
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('alerts when .env.local cannot be read, and makes no network call', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const fetchMock = stubFetchSequence([]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', title: expect.stringContaining('.env.local') }),
    );
  });

  it('logs and skips silently on a too-young refresh failure — no alert, no write', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    stubFetchSequence([{ ok: false, status: 400, json: { error: { message: 'Token is younger than 24 hours.' } } }]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(slackMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('alerts (warn) on any other refresh failure, with the classified kind + no write', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    stubFetchSequence([{ ok: false, status: 401, json: { error: { message: 'Invalid access token', code: 190 } } }]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'send_health',
        source: 'instagram-token-refresh',
        fields: expect.objectContaining({ httpStatus: 401, kind: 'auth' }),
      }),
    );
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('never alerts on a bare transport failure (fetch throws) — logs only, retried next tick', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network blip'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runInstagramTokenRefresh(NOW_MS)).resolves.toBeUndefined();
    expect(slackMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('alerts (error) on a malformed success body and never calls verify or writes', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    const fetchMock = stubFetchSequence([{ ok: true, json: { access_token: 'new-token' } }]); // missing expires_in
    await runInstagramTokenRefresh(NOW_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1); // verify never attempted
    expect(slackMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', title: expect.stringContaining('לא תקינה') }));
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('verify-then-write: does NOT write when verification of the new token fails', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    stubFetchSequence([
      { ok: true, json: { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { ok: false, status: 401, json: { error: { message: 'invalid token' } } }, // verify fails
    ]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', title: expect.stringContaining('אימות נכשל') }),
    );
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(renameSyncMock).not.toHaveBeenCalled();
  });

  it('on full success: writes the new token + expiry atomically, preserving the original file mode, no failure alert', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    statSyncMock.mockReturnValue({ mode: 0o100600 }); // regular file, 0600
    stubFetchSequence([
      { ok: true, json: { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { ok: true, json: { user_id: '178414000000000', username: 'kalfa' } },
    ]);
    await runInstagramTokenRefresh(NOW_MS);

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [tmpPath, writtenContent] = writeFileSyncMock.mock.calls[0];
    expect(String(tmpPath)).toContain('.env.local');
    expect(writtenContent).toContain('META_IG_ACCESS_TOKEN=new-token');
    expect(writtenContent).toContain('META_IG_ACCESS_TOKEN_EXPIRES_AT=2026-10-11T09:40:00.000Z');

    expect(chmodSyncMock).toHaveBeenCalledWith(tmpPath, 0o600);
    expect(renameSyncMock).toHaveBeenCalledWith(tmpPath, expect.stringContaining('.env.local'));
    // No error/warn alert on the happy path (no failure branch fired), and the
    // fresh 60-day expiry is nowhere near the 14-day warning threshold.
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('preserves a non-default original mode (0640) rather than hardcoding 0600', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    statSyncMock.mockReturnValue({ mode: 0o100640 }); // regular file, 0640
    stubFetchSequence([
      { ok: true, json: { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { ok: true, json: { user_id: '178414000000000' } },
    ]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(chmodSyncMock).toHaveBeenCalledWith(expect.anything(), 0o640);
  });

  it('falls back to mode 0600 when the original file cannot be stat-ed', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    statSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    stubFetchSequence([
      { ok: true, json: { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { ok: true, json: { user_id: '178414000000000' } },
    ]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(chmodSyncMock).toHaveBeenCalledWith(expect.anything(), 0o600);
  });

  it('alerts (error) and cleans up the temp file when the atomic write itself fails', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    statSyncMock.mockReturnValue({ mode: 0o100600 });
    writeFileSyncMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    existsSyncMock.mockReturnValue(true);
    stubFetchSequence([
      { ok: true, json: { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { ok: true, json: { user_id: '178414000000000' } },
    ]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(unlinkSyncMock).toHaveBeenCalled();
    expect(renameSyncMock).not.toHaveBeenCalled();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', title: expect.stringContaining('כתיבת') }),
    );
  });

  it('second protection: alerts when the persisted expiry is under 14 days, even on a too_young skip', async () => {
    const soonExpiry = new Date(NOW_MS + 10 * 86_400_000).toISOString(); // 10 days out
    readFileSyncMock.mockReturnValue(`${ENV_FIXTURE}META_IG_ACCESS_TOKEN_EXPIRES_AT=${soonExpiry}\n`);
    stubFetchSequence([{ ok: false, status: 400, json: { error: { message: '24 hours old required' } } }]);
    await runInstagramTokenRefresh(NOW_MS);
    // too_young itself is silent, but the second-protection alert must still fire.
    expect(slackMock).toHaveBeenCalledTimes(1);
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        title: expect.stringContaining('מתקרב לתפוגה'),
        fields: { daysLeft: 10 },
      }),
    );
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('second protection: fires ALONGSIDE the failure alert when both conditions hold', async () => {
    const soonExpiry = new Date(NOW_MS + 5 * 86_400_000).toISOString();
    readFileSyncMock.mockReturnValue(`${ENV_FIXTURE}META_IG_ACCESS_TOKEN_EXPIRES_AT=${soonExpiry}\n`);
    stubFetchSequence([{ ok: false, status: 401, json: { error: { message: 'Invalid access token', code: 190 } } }]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(slackMock).toHaveBeenCalledTimes(2);
    expect(slackMock).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('נכשל') }));
    expect(slackMock).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('מתקרב לתפוגה') }));
  });

  it('second protection stays silent on a first-ever run with no persisted expiry', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE); // no EXPIRES_AT line at all
    stubFetchSequence([{ ok: false, status: 400, json: { error: { message: '24 hours old' } } }]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('a fresh successful refresh never re-triggers the 14-day warning (60-day runway)', async () => {
    readFileSyncMock.mockReturnValue(ENV_FIXTURE);
    statSyncMock.mockReturnValue({ mode: 0o100600 });
    stubFetchSequence([
      { ok: true, json: { access_token: 'new-token', token_type: 'bearer', expires_in: 5_184_000 } },
      { ok: true, json: { user_id: '178414000000000' } },
    ]);
    await runInstagramTokenRefresh(NOW_MS);
    expect(slackMock).not.toHaveBeenCalled();
  });
});
