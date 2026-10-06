import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const requirePlatformPermission = vi.fn();
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: (...args: unknown[]) => requirePlatformPermission(...args) }));

const createAdminClient = vi.fn(() => ({ admin: true }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminClient() }));
const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }));

const service = {
  requestRdpAccess: vi.fn(),
  cancelRdpRequest: vi.fn(),
  endOwnRdpGrant: vi.fn(),
  beginRdpFileIssue: vi.fn(),
  recordRdpFileFailure: vi.fn(),
};
vi.mock('@/lib/rdp-access/service', () => ({
  requestRdpAccess: (...a: unknown[]) => service.requestRdpAccess(...a),
  cancelRdpRequest: (...a: unknown[]) => service.cancelRdpRequest(...a),
  endOwnRdpGrant: (...a: unknown[]) => service.endOwnRdpGrant(...a),
  beginRdpFileIssue: (...a: unknown[]) => service.beginRdpFileIssue(...a),
  recordRdpFileFailure: (...a: unknown[]) => service.recordRdpFileFailure(...a),
}));

const getRdpGatewayConfig = vi.fn();
vi.mock('@/lib/rdp-access/config', () => ({ getRdpGatewayConfig: () => getRdpGatewayConfig() }));
const connectRdpFile = vi.fn();
vi.mock('@/lib/rdp-access/gateway-client', () => ({ connectRdpFile: (...a: unknown[]) => connectRdpFile(...a) }));
const getRdpGrantRequestId = vi.fn();
vi.mock('@/lib/rdp-access/queries', () => ({ getRdpGrantRequestId: (...a: unknown[]) => getRdpGrantRequestId(...a) }));
const validateRdpFile = vi.fn();
vi.mock('@/lib/rdp-access/rdp-file', () => ({ validateRdpFile: (...a: unknown[]) => validateRdpFile(...a) }));

import {
  cancelMyRdpRequest,
  deriveRdpAccessView,
  endMyRdpGrant,
  getMyRdpAccessState,
  issueMyRdpFile,
  submitRdpAccessRequest,
} from './rdp-access';

const USER = { id: '11111111-1111-4111-8111-111111111111' };
const REQUEST = '22222222-2222-4222-8222-222222222222';
const GRANT = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-07T00:00:00.000Z');

function request(over: Record<string, unknown> = {}) {
  return {
    id: REQUEST,
    status: 'pending',
    reason: 'החלפת מפתח בשרת',
    requested_minutes: 60,
    created_at: '2026-10-06T23:55:00.000Z',
    expires_at: '2026-10-07T00:25:00.000Z',
    answered_at: null,
    granted_minutes: null,
    answer_note: null,
    cancelled_at: null,
    ...over,
  } as Parameters<typeof deriveRdpAccessView>[0];
}
function grant(over: Record<string, unknown> = {}) {
  return {
    id: GRANT,
    request_id: REQUEST,
    status: 'active',
    target: 'desktop.example.test:3389',
    starts_at: '2026-10-06T23:58:00.000Z',
    expires_at: '2026-10-07T00:58:00.000Z',
    ended_at: null,
    ended_reason: null,
    files_issued: 3,
    max_files: 20,
    ...over,
  } as Parameters<typeof deriveRdpAccessView>[1];
}

beforeEach(() => {
  for (const fn of [...Object.values(service), requirePlatformPermission, createClient, getRdpGatewayConfig, connectRdpFile, getRdpGrantRequestId, validateRdpFile]) {
    fn.mockReset();
  }
  createAdminClient.mockClear();
  requirePlatformPermission.mockResolvedValue(USER);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('deriveRdpAccessView', () => {
  it('is none without a request', () => {
    expect(deriveRdpAccessView(null, null, NOW)).toEqual({ kind: 'none' });
  });

  it('shows a pending request until its own expiry, then as expired', () => {
    expect(deriveRdpAccessView(request(), null, NOW)).toMatchObject({ kind: 'pending', requestId: REQUEST, requestedMinutes: 60 });
    expect(deriveRdpAccessView(request({ expires_at: '2026-10-06T23:59:00.000Z' }), null, NOW)).toMatchObject({ kind: 'expired' });
  });

  it('shows the live grant with its download counter and the granted (not the requested) minutes', () => {
    const view = deriveRdpAccessView(request({ status: 'approved', granted_minutes: 5, answered_at: '2026-10-06T23:58:00.000Z' }), grant(), NOW);
    expect(view).toEqual({
      kind: 'active',
      requestId: REQUEST,
      reason: 'החלפת מפתח בשרת',
      grantedMinutes: 5,
      startsAt: '2026-10-06T23:58:00.000Z',
      expiresAt: '2026-10-07T00:58:00.000Z',
      filesIssued: 3,
      maxFiles: 20,
    });
  });

  it('treats an approved request whose grant is over, revoked or past its end as ended', () => {
    const approved = request({ status: 'approved', granted_minutes: 60 });
    expect(deriveRdpAccessView(approved, grant({ status: 'revoked', ended_at: '2026-10-07T00:10:00.000Z', ended_reason: 'revoked_by_owner' }), NOW))
      .toMatchObject({ kind: 'ended', endedReason: 'revoked_by_owner', endedAt: '2026-10-07T00:10:00.000Z', filesIssued: 3 });
    expect(deriveRdpAccessView(approved, grant({ expires_at: '2026-10-06T23:59:00.000Z' }), NOW))
      .toMatchObject({ kind: 'ended', endedReason: 'expired' });
    expect(deriveRdpAccessView(approved, null, NOW)).toMatchObject({ kind: 'ended', endedReason: null, filesIssued: 0 });
  });

  it('carries the owner note of a denial and maps cancelled and expired', () => {
    expect(deriveRdpAccessView(request({ status: 'denied', answered_at: '2026-10-07T00:01:00.000Z', answer_note: 'נא לתאם מראש' }), null, NOW))
      .toEqual({ kind: 'denied', requestId: REQUEST, requestedMinutes: 60, answeredAt: '2026-10-07T00:01:00.000Z', note: 'נא לתאם מראש' });
    expect(deriveRdpAccessView(request({ status: 'cancelled' }), null, NOW)).toMatchObject({ kind: 'cancelled' });
    expect(deriveRdpAccessView(request({ status: 'expired' }), null, NOW)).toMatchObject({ kind: 'expired' });
  });
});

describe('getMyRdpAccessState', () => {
  function stubReads(requestRow: unknown, grantRow: unknown = null) {
    const chain = (rows: unknown[]) => ({
      select: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }),
        eq: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    });
    createClient.mockResolvedValue({
      from: (table: string) => (table === 'rdp_access_requests' ? chain(requestRow ? [requestRow] : []) : chain(grantRow ? [grantRow] : [])),
    });
  }

  it('gates first and reads through the cookie client, never the admin client', async () => {
    requirePlatformPermission.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(getMyRdpAccessState()).rejects.toThrow('NEXT_REDIRECT');
    expect(requirePlatformPermission).toHaveBeenCalledWith('rdp.request');
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('leads with the form (none) when the last outcome is older than a day', async () => {
    stubReads(request({ status: 'denied', answered_at: '2020-01-01T00:00:00.000Z' }));
    expect((await getMyRdpAccessState()).view).toEqual({ kind: 'none' });
  });

  it('returns the server clock so the countdown can correct a skewed device clock', async () => {
    stubReads(null);
    const state = await getMyRdpAccessState();
    expect(Number.isNaN(Date.parse(state.serverNow))).toBe(false);
  });
});

describe('the writes', () => {
  it('derive the user from the gate and pass nothing else from the caller as an identity', async () => {
    service.requestRdpAccess.mockResolvedValue({ outcome: 'created', requestId: REQUEST, expiresAt: 'x' });
    await submitRdpAccessRequest({ reason: 'החלפת מפתח בשרת', minutes: 60 }, '203.0.113.7');
    expect(service.requestRdpAccess).toHaveBeenCalledWith({ admin: true }, {
      userId: USER.id,
      reason: 'החלפת מפתח בשרת',
      minutes: 60,
      clientIp: '203.0.113.7',
    });

    service.cancelRdpRequest.mockResolvedValue({ outcome: 'cancelled' });
    await cancelMyRdpRequest(REQUEST);
    expect(service.cancelRdpRequest).toHaveBeenCalledWith({ admin: true }, { userId: USER.id, requestId: REQUEST });

    service.endOwnRdpGrant.mockResolvedValue({ outcome: 'ended', grantId: GRANT });
    await endMyRdpGrant();
    expect(service.endOwnRdpGrant).toHaveBeenCalledWith({ admin: true }, { userId: USER.id });
  });

  it('touch nothing when the gate refuses', async () => {
    requirePlatformPermission.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(submitRdpAccessRequest({ reason: 'x'.repeat(10), minutes: 60 }, null)).rejects.toThrow();
    await expect(cancelMyRdpRequest(REQUEST)).rejects.toThrow();
    await expect(endMyRdpGrant()).rejects.toThrow();
    await expect(issueMyRdpFile('203.0.113.7')).rejects.toThrow();
    expect(createAdminClient).not.toHaveBeenCalled();
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('issueMyRdpFile', () => {
  const config = {
    gatewayOrigin: 'http://127.0.0.1:3013',
    adminOrigin: 'http://127.0.0.1:3014',
    target: 'configured.example.test:3389',
    gatewayUser: 'desktopuser',
    checkSecret: 'c'.repeat(40),
    connectSecret: 'n'.repeat(40),
    adminSecret: 'a'.repeat(40),
  };
  const reserved = { outcome: 'ok', grantId: GRANT, target: 'granted.example.test:3389', expiresAt: 'x', filesLeft: 19 };

  beforeEach(() => {
    getRdpGatewayConfig.mockReturnValue({ ok: true, config });
    service.beginRdpFileIssue.mockResolvedValue(reserved);
    connectRdpFile.mockResolvedValue({ ok: true, value: { text: 'raw' } });
    validateRdpFile.mockReturnValue({ ok: true, content: 'validated' });
    getRdpGrantRequestId.mockResolvedValue(REQUEST);
  });

  it('returns the validated file, asking the gateway for the GRANT target, not the configured one', async () => {
    await expect(issueMyRdpFile('203.0.113.7')).resolves.toEqual({ ok: true, content: 'validated' });
    expect(service.beginRdpFileIssue).toHaveBeenCalledWith({ admin: true }, { userId: USER.id, clientIp: '203.0.113.7' });
    expect(connectRdpFile).toHaveBeenCalledWith({ ...config, target: 'granted.example.test:3389' }, '203.0.113.7');
    expect(validateRdpFile).toHaveBeenCalledWith('raw', { target: 'granted.example.test:3389' });
    expect(service.recordRdpFileFailure).not.toHaveBeenCalled();
  });

  it('reserves nothing when the address is unknown or the gateway is not configured', async () => {
    await expect(issueMyRdpFile(null)).resolves.toEqual({ ok: false, reason: 'no_client_ip' });
    await expect(issueMyRdpFile('not an ip')).resolves.toEqual({ ok: false, reason: 'no_client_ip' });
    getRdpGatewayConfig.mockReturnValue({ ok: false, problems: [{ variable: 'RDPGW_CHECK_SECRET', reason: 'missing' }] });
    await expect(issueMyRdpFile('203.0.113.7')).resolves.toEqual({ ok: false, reason: 'gateway_unavailable' });
    expect(service.beginRdpFileIssue).not.toHaveBeenCalled();
  });

  it('passes the database refusals through and never calls the gateway for them', async () => {
    for (const outcome of ['not_allowed', 'no_active_grant', 'file_limit', 'too_soon'] as const) {
      service.beginRdpFileIssue.mockResolvedValueOnce({ ...reserved, outcome, grantId: null, target: null });
      await expect(issueMyRdpFile('203.0.113.7')).resolves.toEqual({ ok: false, reason: outcome });
    }
    service.beginRdpFileIssue.mockResolvedValueOnce({ ...reserved, outcome: 'unexpected' });
    await expect(issueMyRdpFile('203.0.113.7')).resolves.toEqual({ ok: false, reason: 'gateway_unavailable' });
    expect(connectRdpFile).not.toHaveBeenCalled();
  });

  it('records a gateway failure after the reservation, with the fixed kind only', async () => {
    connectRdpFile.mockResolvedValue({ ok: false, kind: 'timeout' });
    await expect(issueMyRdpFile('203.0.113.7')).resolves.toEqual({ ok: false, reason: 'gateway_unavailable' });
    expect(service.recordRdpFileFailure).toHaveBeenCalledWith({ admin: true }, {
      grantId: GRANT,
      requestId: REQUEST,
      clientIp: '203.0.113.7',
      outcome: 'timeout',
    });
  });

  it('refuses a file the validator rejects, records why, and never returns its content', async () => {
    validateRdpFile.mockReturnValue({ ok: false, reason: 'forbidden_setting' });
    const result = await issueMyRdpFile('203.0.113.7');
    expect(result).toEqual({ ok: false, reason: 'gateway_unavailable' });
    expect(JSON.stringify(result)).not.toContain('raw');
    expect(service.recordRdpFileFailure).toHaveBeenCalledWith({ admin: true }, expect.objectContaining({ outcome: 'file_forbidden_setting' }));
  });
});
