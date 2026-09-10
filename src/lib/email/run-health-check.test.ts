// The alerting policy IS the feature here. A health check that pages about valid
// states gets muted, and a muted channel is worse than no check — so every test below
// pins one boundary between "worth waking someone" and "not".
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// vi.mock factories are hoisted above every const in this file, so the spies have to
// be created by vi.hoisted() or the factory closes over a temporal-dead-zone binding.
const {
  alertMock,
  readSettingsMock,
  providerMock,
  resendCheckMock,
  smtpCheckMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  readSettingsMock: vi.fn(),
  providerMock: vi.fn(),
  resendCheckMock: vi.fn(),
  smtpCheckMock: vi.fn(),
}));

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: alertMock }));
vi.mock('./sender', () => ({
  readEmailSettings: readSettingsMock,
  selectedEmailProvider: providerMock,
}));
vi.mock('./health', () => ({
  checkResendHealth: resendCheckMock,
  checkSmtpHealth: smtpCheckMock,
}));

import { runEmailHealthCheck } from './run-health-check';

const SETTINGS = {
  kind: 'ok' as const,
  data: {
    email_enabled: true,
    smtp_host: 'mail.example.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'u',
    smtp_password: 'p',
    smtp_from: 'KALFA <noreply@send.kalfa.me>',
  },
};

beforeEach(() => {
  alertMock.mockReset();
  readSettingsMock.mockReset().mockResolvedValue(SETTINGS);
  providerMock.mockReset().mockReturnValue('resend');
  resendCheckMock.mockReset();
  smtpCheckMock.mockReset();
  process.env.RESEND_API_KEY = 're_test';
});

describe('runEmailHealthCheck — what it refuses to alert about', () => {
  it('mail switched off is a valid state, not a fault', async () => {
    readSettingsMock.mockResolvedValue({ kind: 'unconfigured' });
    expect(await runEmailHealthCheck()).toEqual({ outcome: 'skipped', health: null });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('an unreadable settings row belongs to the DB panels, not to this alert', async () => {
    readSettingsMock.mockResolvedValue({ kind: 'unreadable' });
    expect((await runEmailHealthCheck()).outcome).toBe('skipped');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('a sending-only key means "could not ask", never "broken"', async () => {
    resendCheckMock.mockResolvedValue({ ok: false, kind: 'key_restricted', message: 'x' });
    expect((await runEmailHealthCheck()).outcome).toBe('skipped');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('provider throttling says nothing about configuration', async () => {
    resendCheckMock.mockResolvedValue({ ok: false, kind: 'rate_limited', message: 'x' });
    expect((await runEmailHealthCheck()).outcome).toBe('degraded');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('an outstanding optional record is recorded, not paged', async () => {
    resendCheckMock.mockResolvedValue({
      ok: true, transport: 'resend', from: 'a@b.co', domain: 'b.co',
      domainStatus: 'partially_verified', records: [], fullyVerified: false,
    });
    expect((await runEmailHealthCheck()).outcome).toBe('degraded');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('half an SMTP config is unconfigured, not broken', async () => {
    providerMock.mockReturnValue('smtp');
    readSettingsMock.mockResolvedValue({
      kind: 'ok',
      data: { ...SETTINGS.data, smtp_password: null },
    });
    expect((await runEmailHealthCheck()).outcome).toBe('skipped');
    expect(smtpCheckMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('runEmailHealthCheck — what it does alert about', () => {
  it('a broken sending domain, which nothing else in the system would surface', async () => {
    resendCheckMock.mockResolvedValue({
      ok: false, kind: 'domain_failed', message: 'שבור', observedStatus: 'temporary_failure',
    });
    expect((await runEmailHealthCheck()).outcome).toBe('failed');
    expect(alertMock).toHaveBeenCalledTimes(1);
    const call = alertMock.mock.calls[0][0];
    expect(call.level).toBe('error');
    expect(call.source).toBe('email-health-check');
    expect(call.fields.status).toBe('temporary_failure');
  });

  it('EMAIL_PROVIDER=resend with no key — the next business email would throw', async () => {
    delete process.env.RESEND_API_KEY;
    const r = await runEmailHealthCheck();
    expect(r.outcome).toBe('failed');
    expect(resendCheckMock).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it('SMTP credentials rejected', async () => {
    providerMock.mockReturnValue('smtp');
    smtpCheckMock.mockResolvedValue({ ok: false, kind: 'smtp_auth_failed', message: 'x' });
    expect((await runEmailHealthCheck()).outcome).toBe('failed');
    expect(alertMock.mock.calls[0][0].fields.transport).toBe('smtp');
  });
});

describe('runEmailHealthCheck — the healthy path', () => {
  it('reports ok and stays silent', async () => {
    resendCheckMock.mockResolvedValue({
      ok: true, transport: 'resend', from: 'a@b.co', domain: 'b.co',
      domainStatus: 'verified', records: [{ record: 'SPF', status: 'verified' }],
      fullyVerified: true,
    });
    expect((await runEmailHealthCheck()).outcome).toBe('ok');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('passes the From address through to the probe, not a guess', async () => {
    resendCheckMock.mockResolvedValue({
      ok: true, transport: 'resend', from: 'x', domain: null,
      domainStatus: 'verified', records: [], fullyVerified: true,
    });
    await runEmailHealthCheck();
    expect(resendCheckMock).toHaveBeenCalledWith('re_test', 'KALFA <noreply@send.kalfa.me>');
  });
});
