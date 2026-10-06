// The live key expires 2027-10-27, so production will answer a quiet "ok" for over a
// year. Every branch that MATTERS here is therefore unreachable in production and can
// only be proven by these tests.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { alertMock, readMock, authMock } = vi.hoisted(() => ({
  alertMock: vi.fn(),
  readMock: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: alertMock }));
vi.mock('./sender', () => ({ readSmsSettings: readMock }));
vi.mock('./extra-client', () => ({ getAuthKey: authMock }));

import { runExtraKeyCheck, EXTRA_KEY_ALERT_DAYS } from './run-key-check';

const OK_SETTINGS = { kind: 'ok' as const, token: 't', sender: '03-3301505', enabled: true };
const healthy = (daysToExpiry: number | null) => ({
  ok: true as const,
  scopes: null,
  createdAt: '2025-10-27',
  expireAt: '2027-10-27',
  daysToExpiry,
  accountEmail: 'account@example.com',
});

beforeEach(() => {
  alertMock.mockReset();
  readMock.mockReset().mockResolvedValue(OK_SETTINGS);
  authMock.mockReset();
});

describe('what it refuses to alert about', () => {
  it('no credentials stored is a valid state', async () => {
    readMock.mockResolvedValue({ kind: 'unconfigured' });
    expect(await runExtraKeyCheck()).toEqual({ outcome: 'skipped', health: null });
    expect(authMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('an unreadable settings row belongs to the DB panels', async () => {
    readMock.mockResolvedValue({ kind: 'unreadable' });
    expect((await runExtraKeyCheck()).outcome).toBe('skipped');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('one unreachable day says nothing — this runs daily', async () => {
    authMock.mockResolvedValue({ ok: false, kind: 'unreachable', message: 'x' });
    expect((await runExtraKeyCheck()).outcome).toBe('degraded');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('a key with plenty of life left is silent', async () => {
    authMock.mockResolvedValue(healthy(412));
    expect((await runExtraKeyCheck()).outcome).toBe('ok');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('is silent one day before the threshold, and speaks on it', async () => {
    // Pins the boundary rather than "somewhere around 30".
    authMock.mockResolvedValue(healthy(EXTRA_KEY_ALERT_DAYS + 1));
    expect((await runExtraKeyCheck()).outcome).toBe('ok');
    expect(alertMock).not.toHaveBeenCalled();

    authMock.mockResolvedValue(healthy(EXTRA_KEY_ALERT_DAYS));
    expect((await runExtraKeyCheck()).outcome).toBe('degraded');
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it('never treats an unknown expiry as "expiring soon"', async () => {
    // null means we could not read the date. Alerting on it would page daily,
    // forever, about a date nobody can check.
    authMock.mockResolvedValue(healthy(null));
    expect((await runExtraKeyCheck()).outcome).toBe('ok');
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('what it does alert about', () => {
  it('a rejected key', async () => {
    authMock.mockResolvedValue({ ok: false, kind: 'key_invalid', message: 'לא תקף' });
    expect((await runExtraKeyCheck()).outcome).toBe('failed');
    const call = alertMock.mock.calls[0][0];
    expect(call.level).toBe('error');
    expect(call.source).toBe('extra-key-check');
  });

  it('an approaching expiry, as a warning', async () => {
    authMock.mockResolvedValue(healthy(14));
    expect((await runExtraKeyCheck()).outcome).toBe('degraded');
    const call = alertMock.mock.calls[0][0];
    expect(call.level).toBe('warn');
    expect(call.fields.days_to_expiry).toBe('14');
    // The alert has to say what stops working, or it is just a date.
    expect(call.detail).toContain('OTP');
  });

  it('an expiry already passed, as an error', async () => {
    authMock.mockResolvedValue(healthy(-3));
    expect((await runExtraKeyCheck()).outcome).toBe('failed');
    expect(alertMock.mock.calls[0][0].level).toBe('error');
  });
});

describe('the switch', () => {
  it('checks the key even while SMS sending is switched OFF', async () => {
    // A key expires whether or not the channel is dark, and finding out on the day
    // someone switches sending back on is what this monitor exists to prevent.
    readMock.mockResolvedValue({ ...OK_SETTINGS, enabled: false });
    authMock.mockResolvedValue(healthy(5));
    expect((await runExtraKeyCheck()).outcome).toBe('degraded');
    expect(authMock).toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(1);
  });
});
