// What these tests are for: the outgoing-mail check exists to catch a SILENT failure,
// so every assertion here is about a case where the naive implementation would report
// "תקין" and be wrong.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const listMock = vi.fn();
const getMock = vi.fn();
const verifyMock = vi.fn();
const closeMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    domains = { list: listMock, get: getMock };
  },
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ verify: verifyMock, close: closeMock }) },
}));

import { checkResendHealth, checkSmtpHealth, domainFromSender } from './health';

const okList = (domains: unknown[]) => ({
  data: { object: 'list', has_more: false, data: domains },
  error: null,
});
const domain = (over: Record<string, unknown> = {}) => ({
  id: 'd-1',
  name: 'send.kalfa.me',
  status: 'verified',
  created_at: '2026-01-01',
  region: 'us-east-1',
  capabilities: { sending: 'enabled', receiving: 'disabled' },
  ...over,
});
const okDetail = (records: unknown[]) => ({
  data: { ...domain(), records },
  error: null,
});

beforeEach(() => {
  listMock.mockReset();
  getMock.mockReset();
  verifyMock.mockReset();
  closeMock.mockReset();
});

describe('domainFromSender', () => {
  it('reads a bare address and a display-name address alike', () => {
    // Both forms are valid in the admin field and both are in use.
    expect(domainFromSender('noreply@send.kalfa.me')).toBe('send.kalfa.me');
    expect(domainFromSender('KALFA <noreply@send.kalfa.me>')).toBe('send.kalfa.me');
    expect(domainFromSender('קלפה <NoReply@Send.Kalfa.ME>')).toBe('send.kalfa.me');
  });

  it('returns null rather than guessing', () => {
    // Checking the WRONG domain and calling it healthy is worse than admitting we
    // could not tell which domain to check.
    expect(domainFromSender('not-an-address')).toBeNull();
    expect(domainFromSender('trailing@')).toBeNull();
    expect(domainFromSender('no-dot@localhost')).toBeNull();
  });
});

describe('checkResendHealth', () => {
  it('matches the domain the From header actually uses, not just any verified one', async () => {
    // A Resend account can hold several verified domains. "Some domain is verified"
    // proves nothing about the one this system sends from.
    listMock.mockResolvedValue(okList([domain({ name: 'kalfa.me' })]));
    const r = await checkResendHealth('re_x', 'KALFA <noreply@send.kalfa.me>');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe('domain_missing');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('treats temporary_failure as broken — the status the SDK type omits', async () => {
    // resend 6.26.0's DomainStatus union has no 'temporary_failure', though Resend's
    // docs define it as "previously verified, DNS records currently missing". A switch
    // over the typed union would drop the one value that means "it just broke".
    listMock.mockResolvedValue(okList([domain({ status: 'temporary_failure' })]));
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok === false && r.kind).toBe('domain_failed');
    expect(r.ok === false && r.observedStatus).toBe('temporary_failure');
  });

  it('reports an unrecognised status verbatim instead of calling it healthy', async () => {
    listMock.mockResolvedValue(okList([domain({ status: 'something_new' })]));
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('something_new');
  });

  it('catches a broken DKIM row under a domain that still reads verified', async () => {
    // The domain-level roll-up is not always immediate. The rows are the truth.
    listMock.mockResolvedValue(okList([domain()]));
    getMock.mockResolvedValue(
      okDetail([
        { record: 'SPF', status: 'verified' },
        { record: 'DKIM', status: 'temporary_failure' },
      ]),
    );
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok === false && r.kind).toBe('domain_failed');
    expect(r.ok === false && r.message).toContain('DKIM');
  });

  it('ignores tracking records, which are pending forever on an unused feature', async () => {
    // Alerting hourly about open/click tracking nobody enabled is how a channel gets
    // muted — and it would bury the SPF/DKIM signal this check exists for.
    listMock.mockResolvedValue(okList([domain()]));
    getMock.mockResolvedValue(
      okDetail([
        { record: 'SPF', status: 'verified' },
        { record: 'DKIM', status: 'verified' },
        { record: 'Tracking', status: 'not_started' },
      ]),
    );
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok).toBe(true);
    expect(r.ok && r.records.map((x) => x.record)).toEqual(['SPF', 'DKIM']);
  });

  it('separates a sending-only key from a broken integration', async () => {
    // A key scoped to sending cannot read /domains. That is the SAFER key; calling it
    // a fault would push someone to widen it.
    listMock.mockResolvedValue({ data: null, error: { name: 'restricted_api_key', message: 'x', statusCode: 401 } });
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok === false && r.kind).toBe('key_restricted');
  });

  it('fails LOUD on an unrecognised auth error rather than silently skipping', async () => {
    // Resend's public error reference does not list every name the SDK's union carries.
    // An unknown 401/403 is a key problem either way; resolving it to key_restricted
    // (which never alerts) would let a dead key stop business mail in silence.
    listMock.mockResolvedValue({
      data: null,
      error: { name: 'some_future_auth_error', message: 'x', statusCode: 403 },
    });
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok === false && r.kind).toBe('key_invalid');
  });

  it('still treats an unrecognised 429 as throttling', async () => {
    listMock.mockResolvedValue({
      data: null,
      error: { name: 'some_future_quota_error', message: 'x', statusCode: 429 },
    });
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok === false && r.kind).toBe('rate_limited');
  });

  it('separates a dead key from throttling', async () => {
    listMock.mockResolvedValue({ data: null, error: { name: 'invalid_api_key', message: 'x', statusCode: 401 } });
    expect((await checkResendHealth('re_x', 'a@b.co')).ok === false).toBe(true);
    listMock.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'x', statusCode: 429 } });
    const r = await checkResendHealth('re_x', 'a@b.co');
    expect(r.ok === false && r.kind).toBe('rate_limited');
  });

  it('flags a verified domain whose sending capability is switched off', async () => {
    listMock.mockResolvedValue(okList([domain({ capabilities: { sending: 'disabled', receiving: 'disabled' } })]));
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok === false && r.kind).toBe('sending_disabled');
  });

  it('keeps the verdict when the record breakdown cannot be fetched', async () => {
    // Call one already established the key works and the domain is verified. Losing
    // the detail degrades the report; inventing a failure over it would be worse.
    listMock.mockResolvedValue(okList([domain()]));
    getMock.mockRejectedValue(new Error('network'));
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok).toBe(true);
    expect(r.ok && r.records).toEqual([]);
  });

  it('calls partially_verified healthy but not fully verified', async () => {
    listMock.mockResolvedValue(okList([domain({ status: 'partially_verified' })]));
    getMock.mockResolvedValue(okDetail([{ record: 'SPF', status: 'verified' }]));
    const r = await checkResendHealth('re_x', 'noreply@send.kalfa.me');
    expect(r.ok).toBe(true);
    expect(r.ok && r.fullyVerified).toBe(false);
  });

  it('never puts the api key in the result', async () => {
    listMock.mockRejectedValue(new Error('failed to fetch https://api.resend.com?key=re_SECRET'));
    const r = await checkResendHealth('re_SECRET', 'noreply@send.kalfa.me');
    expect(JSON.stringify(r)).not.toContain('re_SECRET');
  });
});

describe('checkSmtpHealth', () => {
  const cfg = {
    smtp_host: 'mail.example.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'u',
    smtp_password: 'p',
  };

  it('verifies without composing a message', async () => {
    verifyMock.mockResolvedValue(true);
    const r = await checkSmtpHealth(cfg, 'KALFA <noreply@kalfa.me>');
    expect(r.ok).toBe(true);
    // No DNS verdict on this path: the relay rewrites and signs the body, so SPF/DKIM
    // state is the relay's business. Absent, not false.
    expect(r.ok && r.fullyVerified).toBeNull();
    expect(closeMock).toHaveBeenCalled();
  });

  it('tells a rejected password apart from an unreachable host', async () => {
    verifyMock.mockRejectedValue(Object.assign(new Error('bad'), { responseCode: 535 }));
    expect((await checkSmtpHealth(cfg, 'a@b.co')).ok === false).toBe(true);
    const auth = await checkSmtpHealth(cfg, 'a@b.co');
    expect(auth.ok === false && auth.kind).toBe('smtp_auth_failed');

    verifyMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const down = await checkSmtpHealth(cfg, 'a@b.co');
    expect(down.ok === false && down.kind).toBe('unreachable');
  });

  it('never puts the password in the result', async () => {
    verifyMock.mockRejectedValue(new Error('auth failed for u with pass p-SECRET'));
    const r = await checkSmtpHealth({ ...cfg, smtp_password: 'p-SECRET' }, 'a@b.co');
    expect(JSON.stringify(r)).not.toContain('p-SECRET');
  });
});
