import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  answerRdpRequest,
  beginRdpFileIssue,
  cancelRdpRequest,
  checkRdpTunnel,
  endOwnRdpGrant,
  endRdpGrant,
  hasActiveRdpGrant,
  markRdpCut,
  RdpAccessServiceError,
  recordRdpFileFailure,
  requestRdpAccess,
  sweepRdpAccess,
} from './service';

type Admin = Parameters<typeof requestRdpAccess>[0];

// A service-role double that answers every rpc() with one canned result and records the calls.
function fake(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { admin: { rpc } as unknown as Admin, rpc };
}

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const GRANT = '44444444-4444-4444-8444-444444444444';

describe('requestRdpAccess', () => {
  it('maps a created request and sends the exact arguments', async () => {
    const { admin, rpc } = fake({
      data: [{ outcome: 'created', request_id: REQUEST, expires_at: '2026-10-06T17:00:00Z' }],
      error: null,
    });
    const result = await requestRdpAccess(admin, { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: null });
    expect(result).toEqual({ outcome: 'created', requestId: REQUEST, expiresAt: '2026-10-06T17:00:00Z' });
    expect(rpc).toHaveBeenCalledWith('rdp_request_access', {
      p_user_id: USER,
      p_reason: 'maintenance window',
      p_minutes: 60,
      p_client_ip: null,
    });
  });

  it('surfaces the NULL columns of a refusal instead of trusting them', async () => {
    const { admin } = fake({ data: [{ outcome: 'not_allowed', request_id: null, expires_at: null }], error: null });
    const result = await requestRdpAccess(admin, { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: '203.0.113.7' });
    expect(result).toEqual({ outcome: 'not_allowed', requestId: null, expiresAt: null });
  });

  it('maps the busy outcome (the pending row vanished twice during the insert)', async () => {
    const { admin } = fake({ data: [{ outcome: 'busy', request_id: null, expires_at: null }], error: null });
    const result = await requestRdpAccess(admin, { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: null });
    expect(result).toEqual({ outcome: 'busy', requestId: null, expiresAt: null });
  });

  it('reports an outcome it does not know as unexpected, never as success', async () => {
    const { admin } = fake({ data: [{ outcome: 'brand_new_outcome', request_id: null, expires_at: null }], error: null });
    const result = await requestRdpAccess(admin, { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: null });
    expect(result.outcome).toBe('unexpected');
  });

  it('throws a safe error on a database error, without the driver message', async () => {
    const { admin } = fake({ data: null, error: { message: 'column "request_ip" violates constraint secret_detail' } });
    const call = requestRdpAccess(admin, { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: null });
    await expect(call).rejects.toBeInstanceOf(RdpAccessServiceError);
    await expect(call).rejects.toThrow('rdp-access: request_access failed');
    await expect(call).rejects.not.toThrow(/request_ip|constraint/);
  });

  it('throws on an empty result set', async () => {
    const { admin } = fake({ data: [], error: null });
    await expect(
      requestRdpAccess(admin, { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: null }),
    ).rejects.toBeInstanceOf(RdpAccessServiceError);
  });
});

describe('cancelRdpRequest / endOwnRdpGrant', () => {
  it('maps cancel', async () => {
    const { admin, rpc } = fake({ data: [{ outcome: 'cancelled' }], error: null });
    expect(await cancelRdpRequest(admin, { userId: USER, requestId: REQUEST })).toEqual({ outcome: 'cancelled' });
    expect(rpc).toHaveBeenCalledWith('rdp_cancel_request', { p_user_id: USER, p_request_id: REQUEST });
  });

  it('maps ending an own grant, with a null grant id on refusal', async () => {
    const { admin } = fake({ data: [{ outcome: 'no_active_grant', grant_id: null }], error: null });
    expect(await endOwnRdpGrant(admin, { userId: USER })).toEqual({ outcome: 'no_active_grant', grantId: null });
  });
});

describe('beginRdpFileIssue', () => {
  it('maps a reserved download', async () => {
    const { admin } = fake({
      data: [{ outcome: 'ok', grant_id: GRANT, target: 'desktop.example.test:3389', expires_at: '2026-10-06T18:00:00Z', files_left: 19 }],
      error: null,
    });
    expect(await beginRdpFileIssue(admin, { userId: USER, clientIp: '203.0.113.7' })).toEqual({
      outcome: 'ok',
      grantId: GRANT,
      target: 'desktop.example.test:3389',
      expiresAt: '2026-10-06T18:00:00Z',
      filesLeft: 19,
    });
  });

  it('keeps target and expiry null when the download is refused', async () => {
    const { admin } = fake({
      data: [{ outcome: 'too_soon', grant_id: GRANT, target: null, expires_at: null, files_left: 3 }],
      error: null,
    });
    const result = await beginRdpFileIssue(admin, { userId: USER, clientIp: null });
    expect(result.outcome).toBe('too_soon');
    expect(result.target).toBeNull();
  });
});

describe('answerRdpRequest', () => {
  const context = { os_user: 'owner', tty: true };

  it('sends minutes and target for an approval', async () => {
    const { admin, rpc } = fake({
      data: [{ outcome: 'approved', grant_id: GRANT, expires_at: '2026-10-06T18:00:00Z', conflicting_grant_id: null }],
      error: null,
    });
    const result = await answerRdpRequest(admin, {
      requestId: REQUEST,
      actorId: OWNER,
      verdict: 'approved',
      minutes: 60,
      target: 'desktop.example.test:3389',
      note: '',
      context,
    });
    expect(result).toEqual({ outcome: 'approved', grantId: GRANT, expiresAt: '2026-10-06T18:00:00Z', conflictingGrantId: null });
    expect(rpc).toHaveBeenCalledWith('rdp_answer_request', {
      p_request_id: REQUEST,
      p_actor_id: OWNER,
      p_verdict: 'approved',
      p_minutes: 60,
      p_target: 'desktop.example.test:3389',
      p_note: '',
      p_context: context,
    });
  });

  it('sends inert placeholders for a denial, which the function ignores', async () => {
    const { admin, rpc } = fake({
      data: [{ outcome: 'denied', grant_id: null, expires_at: null, conflicting_grant_id: null }],
      error: null,
    });
    await answerRdpRequest(admin, { requestId: REQUEST, actorId: OWNER, verdict: 'denied', note: 'not now', context });
    expect(rpc).toHaveBeenCalledWith(
      'rdp_answer_request',
      expect.objectContaining({ p_verdict: 'denied', p_minutes: 0, p_target: '', p_note: 'not now' }),
    );
  });

  it('exposes the conflicting grant when another approval won', async () => {
    const { admin } = fake({
      data: [{ outcome: 'grant_conflict', grant_id: null, expires_at: null, conflicting_grant_id: GRANT }],
      error: null,
    });
    const result = await answerRdpRequest(admin, {
      requestId: REQUEST,
      actorId: OWNER,
      verdict: 'approved',
      minutes: 30,
      target: 'desktop.example.test:3389',
      note: '',
      context,
    });
    expect(result.outcome).toBe('grant_conflict');
    expect(result.conflictingGrantId).toBe(GRANT);
  });
});

describe('endRdpGrant', () => {
  it('omits the optional arguments the caller did not give', async () => {
    const { admin, rpc } = fake({ data: [{ outcome: 'revoked', grant_id: GRANT }], error: null });
    expect(await endRdpGrant(admin, { actorId: OWNER })).toEqual({ outcome: 'revoked', grantId: GRANT });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_actor_id).toBe(OWNER);
    expect(args.p_grant_id).toBeUndefined();
    expect(args.p_reason).toBeUndefined();
  });

  it('refuses a non-owner', async () => {
    const { admin } = fake({ data: [{ outcome: 'not_owner', grant_id: null }], error: null });
    expect((await endRdpGrant(admin, { actorId: USER })).outcome).toBe('not_owner');
  });
});

describe('checkRdpTunnel (fail-closed)', () => {
  const input = { target: 'desktop.example.test:3389', clientIp: '203.0.113.7', tunnelRef: 'tunnel-1' };

  it('allows only on a literal true', async () => {
    const { admin, rpc } = fake({ data: [{ allow: true, grant_id: GRANT, expires_at: '2026-10-06T18:00:00Z' }], error: null });
    expect(await checkRdpTunnel(admin, input)).toEqual({ allow: true, grantId: GRANT, expiresAt: '2026-10-06T18:00:00Z' });
    expect(rpc).toHaveBeenCalledWith('rdp_check_tunnel', {
      p_target: 'desktop.example.test:3389',
      p_client_ip: '203.0.113.7',
      p_tunnel_ref: 'tunnel-1',
    });
  });

  it.each([false, null, undefined, 'true', 1])('refuses when allow is %j', async (allow) => {
    const { admin } = fake({ data: [{ allow, grant_id: null, expires_at: null }], error: null });
    expect((await checkRdpTunnel(admin, input)).allow).toBe(false);
  });

  it('throws on a database error so the caller can deny', async () => {
    const { admin } = fake({ data: null, error: { message: 'connection reset' } });
    await expect(checkRdpTunnel(admin, input)).rejects.toThrow('rdp-access: check_tunnel failed');
  });
});

describe('sweepRdpAccess / markRdpCut', () => {
  it('maps the sweep counters', async () => {
    const { admin } = fake({ data: [{ requests_expired: 2, grants_expired: 1, access_removed: 0 }], error: null });
    expect(await sweepRdpAccess(admin)).toEqual({ requestsExpired: 2, grantsExpired: 1, accessRemoved: 0 });
  });

  it('records a disconnect attempt', async () => {
    const { admin, rpc } = fake({ data: null, error: null });
    await markRdpCut(admin, { grantId: GRANT, ok: false, errorCode: 'unreachable' });
    expect(rpc).toHaveBeenCalledWith('rdp_mark_cut', { p_grant_id: GRANT, p_ok: false, p_error_code: 'unreachable' });
  });

  it('throws when the bookkeeping write fails', async () => {
    const { admin } = fake({ data: null, error: { message: 'boom' } });
    await expect(markRdpCut(admin, { grantId: GRANT, ok: true, errorCode: 'none' })).rejects.toThrow(
      'rdp-access: mark_cut failed',
    );
  });
});

describe('deadlock retry', () => {
  const ok = { data: [{ outcome: 'created', request_id: REQUEST, expires_at: '2026-10-06T17:00:00Z' }], error: null };
  const input = { userId: USER, reason: 'maintenance window', minutes: 60, clientIp: null } as const;

  it.each(['40P01', '40001'])('repeats the call once after SQLSTATE %s and returns the second answer', async (code) => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code, message: 'deadlock detected' } })
      .mockResolvedValueOnce(ok);
    const result = await requestRdpAccess({ rpc } as unknown as Admin, input);
    expect(result.outcome).toBe('created');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('gives up after one repeat and throws the safe error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '40P01', message: 'deadlock detected' } });
    await expect(requestRdpAccess({ rpc } as unknown as Admin, input)).rejects.toThrow('rdp-access: request_access failed');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('does not repeat any other error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '23514', message: 'check violation' } });
    await expect(requestRdpAccess({ rpc } as unknown as Admin, input)).rejects.toBeInstanceOf(RdpAccessServiceError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('repeats the bookkeeping write too', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'x' } })
      .mockResolvedValueOnce({ data: null, error: null });
    await markRdpCut({ rpc } as unknown as Admin, { grantId: GRANT, ok: true, errorCode: 'ok' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('hasActiveRdpGrant', () => {
  // supabase-js query builder double: records the filters and resolves with the canned rows
  function builder(result: { data: unknown; error: unknown }) {
    const calls: [string, unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'gt', 'limit']) {
      chain[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return name === 'limit' ? Promise.resolve(result) : chain;
      };
    }
    return { admin: { from: () => chain } as unknown as Admin, calls };
  }

  const NOW = new Date('2026-10-06T17:00:00.000Z');

  it('counts only a grant that is active AND not past its expiry', async () => {
    const { admin, calls } = builder({ data: [{ id: GRANT }], error: null });
    expect(await hasActiveRdpGrant(admin, NOW)).toBe(true);
    expect(calls).toContainEqual(['eq', ['status', 'active']]);
    expect(calls).toContainEqual(['gt', ['expires_at', '2026-10-06T17:00:00.000Z']]);
  });

  it('is false when nothing matches', async () => {
    const { admin } = builder({ data: [], error: null });
    expect(await hasActiveRdpGrant(admin, NOW)).toBe(false);
  });

  it('throws on a database error', async () => {
    const { admin } = builder({ data: null, error: { message: 'x' } });
    await expect(hasActiveRdpGrant(admin, NOW)).rejects.toThrow('rdp-access: has_active_grant failed');
  });
});

describe('answerRdpRequest busy outcome', () => {
  it('maps the busy outcome', async () => {
    const { admin } = fake({
      data: [{ outcome: 'busy', grant_id: null, expires_at: null, conflicting_grant_id: null }],
      error: null,
    });
    const result = await answerRdpRequest(admin, {
      requestId: REQUEST,
      actorId: OWNER,
      verdict: 'approved',
      minutes: 30,
      target: 'desktop.example.test:3389',
      note: '',
      context: {},
    });
    expect(result.outcome).toBe('busy');
  });
});

describe('recordRdpFileFailure', () => {
  it('records a failed download as a staff event with the fixed outcome, and no tunnel', async () => {
    const { admin, rpc } = fake({ data: null, error: null });
    await recordRdpFileFailure(admin, { grantId: GRANT, requestId: REQUEST, clientIp: '203.0.113.7', outcome: 'timeout' });
    expect(rpc).toHaveBeenCalledWith('rdp_record_event', {
      p_kind: 'file_failed', p_actor_kind: 'staff', p_grant_id: GRANT, p_request_id: REQUEST,
      p_client_ip: '203.0.113.7', p_tunnel_ref: '', p_outcome: 'timeout',
    });
  });

  it('names the operation only when the database refuses', async () => {
    const { admin } = fake({ data: null, error: { code: '42501', message: 'permission denied for table secret' } });
    await expect(recordRdpFileFailure(admin, { grantId: GRANT, requestId: REQUEST, clientIp: null, outcome: 'x' })).rejects.toThrow(
      'rdp-access: record_file_failure failed',
    );
  });
});
