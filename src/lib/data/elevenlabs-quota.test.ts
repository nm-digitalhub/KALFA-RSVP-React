import { afterEach, describe, expect, it, vi } from 'vitest';

// elevenlabs-quota.ts begins with `import 'server-only'` — stub it (established
// convention: voximplant-balance.test.ts). The read (getElevenLabsQuota) + the
// key resolver + Slack are mocked so evaluateQuotaAlert stays a pure unit and
// runElevenLabsQuotaCheck's wiring is asserted without any real IO.
vi.mock('server-only', () => ({}));
const { keyMock, quotaMock, slackMock } = vi.hoisted(() => ({
  keyMock: vi.fn(),
  quotaMock: vi.fn(),
  slackMock: vi.fn(),
}));
vi.mock('@/lib/data/elevenlabs-status', () => ({
  getElevenLabsApiKeyWithSource: keyMock,
  getElevenLabsQuota: quotaMock,
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));

import { evaluateQuotaAlert, runElevenLabsQuotaCheck } from './elevenlabs-quota';

afterEach(() => vi.clearAllMocks());

describe('evaluateQuotaAlert (pure threshold decision)', () => {
  const q = (count: number | null, limit: number | null) => ({
    characterCount: count,
    characterLimit: limit,
    tier: 'creator',
  });

  it('is silent below 80%', () => {
    expect(evaluateQuotaAlert(q(79, 100))).toBeNull();
    expect(evaluateQuotaAlert(q(0, 100))).toBeNull();
  });

  it('warns from exactly 80% through 94%', () => {
    expect(evaluateQuotaAlert(q(80, 100))?.level).toBe('warn');
    expect(evaluateQuotaAlert(q(94, 100))?.level).toBe('warn');
  });

  it('errors at exactly 95% and above', () => {
    expect(evaluateQuotaAlert(q(95, 100))?.level).toBe('error');
    expect(evaluateQuotaAlert(q(100, 100))?.level).toBe('error');
  });

  it('reports used/limit/percent fields (rounded)', () => {
    expect(evaluateQuotaAlert(q(90, 100))?.fields).toEqual({ used: 90, limit: 100, percent: 90 });
    // 9860/350071 ≈ 2.8% → below threshold → null (the live beta value).
    expect(evaluateQuotaAlert(q(9860, 350071))).toBeNull();
  });

  it('flags an unreadable/absent quota (null, missing fields, or zero limit) as warn', () => {
    expect(evaluateQuotaAlert(null)?.title).toContain('לא ניתנת לקריאה');
    expect(evaluateQuotaAlert(q(null, 100))?.level).toBe('warn');
    expect(evaluateQuotaAlert(q(5, null))?.title).toContain('לא ניתנת');
    expect(evaluateQuotaAlert(q(5, 0))?.level).toBe('warn');
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
    quotaMock.mockResolvedValue({ characterCount: 96, characterLimit: 100, tier: 'creator' });
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
    quotaMock.mockResolvedValue({ characterCount: 10, characterLimit: 100, tier: 'creator' });
    await runElevenLabsQuotaCheck();
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('alerts "unreadable" (warn) when a configured key returns no quota', async () => {
    keyMock.mockResolvedValue({ key: 'k', source: 'env' });
    quotaMock.mockResolvedValue(null);
    await runElevenLabsQuotaCheck();
    expect(slackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        title: expect.stringContaining('לא ניתנת לקריאה'),
        fields: expect.objectContaining({ keySource: 'env' }),
      }),
    );
  });

  it('never throws and does not alert on a transient read failure', async () => {
    keyMock.mockResolvedValue({ key: 'k', source: 'db' });
    quotaMock.mockRejectedValue(new Error('network blip'));
    await expect(runElevenLabsQuotaCheck()).resolves.toBeUndefined();
    expect(slackMock).not.toHaveBeenCalled();
  });
});
