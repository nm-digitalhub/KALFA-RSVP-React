import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('server-only', () => ({}));

const q = {
  countPendingRdpRequests: vi.fn(),
  getActiveRdpGrant: vi.fn(),
  getRdpRequestDetail: vi.fn(),
  listRdpRequests: vi.fn(),
  nameMap: vi.fn(),
  resolveOwner: vi.fn(),
  resolveRdpRequestId: vi.fn(),
};
vi.mock('../queries', () => ({
  countPendingRdpRequests: (...a: unknown[]) => q.countPendingRdpRequests(...a),
  getActiveRdpGrant: (...a: unknown[]) => q.getActiveRdpGrant(...a),
  getRdpRequestDetail: (...a: unknown[]) => q.getRdpRequestDetail(...a),
  listRdpRequests: (...a: unknown[]) => q.listRdpRequests(...a),
  nameMap: (...a: unknown[]) => q.nameMap(...a),
  resolveOwner: (...a: unknown[]) => q.resolveOwner(...a),
  resolveRdpRequestId: (...a: unknown[]) => q.resolveRdpRequestId(...a),
}));

import {
  approverContext,
  cmdApprove,
  cmdDeny,
  cmdList,
  cmdRevoke,
  cmdShow,
  cmdStatus,
  EXIT,
  type CliApi,
  type CliContext,
} from './commands';
import { CLI_TEXT } from './text';

const NOW = new Date('2026-10-06T17:00:00Z');
const OWNER = '22222222-2222-4222-8222-222222222222';
const STAFF = '11111111-1111-4111-8111-111111111111';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const GRANT = '44444444-4444-4444-8444-444444444444';

const CONFIG = {
  ok: true as const,
  config: {
    gatewayOrigin: 'http://127.0.0.1:3013',
    adminOrigin: 'http://127.0.0.1:3014',
    target: 'desktop.example.test:3389',
    gatewayUser: 'desktopuser',
    checkSecret: 'c'.repeat(40),
    connectSecret: 'n'.repeat(40),
    adminSecret: 'a'.repeat(40),
  },
};

const PENDING_REQUEST = {
  id: REQUEST,
  status: 'pending',
  reason: 'maintenance window for the worker',
  requested_minutes: 60,
  granted_minutes: null,
  requester_id: STAFF,
  created_at: '2026-10-06T16:50:00Z',
  expires_at: '2026-10-06T17:20:00Z',
  answered_at: null,
};

type MockApi = { [K in keyof CliApi]: Mock };

function build(overrides: Partial<MockApi> = {}, confirm = true) {
  const out: string[] = [];
  const err: string[] = [];
  const api: MockApi = {
    answer: vi.fn().mockResolvedValue({ outcome: 'approved', grantId: GRANT, expiresAt: '2026-10-06T18:00:00Z', conflictingGrantId: null }),
    endGrant: vi.fn().mockResolvedValue({ outcome: 'revoked', grantId: GRANT }),
    markCut: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue({ ok: true, value: { closed: 0 } }),
    listTunnels: vi.fn().mockResolvedValue({ ok: true, value: { tunnels: [] } }),
    connections: vi.fn().mockResolvedValue({ gateway: 'ok', attribution: 'ok', connections: [] }),
    notify: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue(CONFIG),
    getTicketConfig: vi.fn().mockReturnValue({ ok: false, reason: 'off' }),
    ...overrides,
  };
  const confirmFn = vi.fn().mockResolvedValue(confirm);
  const ctx = {
    admin: {} as CliContext['admin'],
    now: () => NOW,
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
    confirm: confirmFn,
    env: { SSH_CONNECTION: '203.0.113.9 51000 10.0.0.1 22' },
    host: { osUser: 'owner', hostname: 'server', pid: 4242, isTTY: true },
    api: api as unknown as CliApi,
  } satisfies CliContext;
  return { ctx: ctx as CliContext, out, err, api, confirm: confirmFn };
}

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  q.resolveRdpRequestId.mockResolvedValue({ ok: true, id: REQUEST });
  q.getRdpRequestDetail.mockResolvedValue({ request: PENDING_REQUEST, grant: null, events: [] });
  q.resolveOwner.mockResolvedValue({ ok: true, ownerId: OWNER });
  q.nameMap.mockResolvedValue(new Map([[STAFF, 'Dana Levi']]));
  q.getActiveRdpGrant.mockResolvedValue(null);
  q.listRdpRequests.mockResolvedValue([]);
  q.countPendingRdpRequests.mockResolvedValue(0);
});

describe('approverContext', () => {
  it('records attribution hints and nothing secret', () => {
    const { ctx } = build();
    expect(approverContext(ctx)).toEqual({
      os_user: 'owner',
      host: 'server',
      ssh_client_ip: '203.0.113.9',
      tty: true,
      cli: 'rdp-access-cli/1',
      pid: 4242,
    });
  });

  it('tolerates a session without SSH', () => {
    const { ctx } = build();
    expect(approverContext({ ...ctx, env: {} })).toMatchObject({ ssh_client_ip: null });
  });
});

describe('cmdApprove', () => {
  const opts = { id: REQUEST.slice(0, 8), minutes: 60, note: '', yes: true };

  it('clears stale tunnels BEFORE the grant exists, then approves with the server-side target', async () => {
    const { ctx, api, out } = build();
    expect(await cmdApprove(ctx, opts)).toBe(EXIT.ok);
    const disconnectOrder = api.disconnect.mock.invocationCallOrder[0]!;
    const answerOrder = api.answer.mock.invocationCallOrder[0]!;
    expect(disconnectOrder).toBeLessThan(answerOrder);
    expect(api.disconnect).toHaveBeenCalledWith(CONFIG.config, { user: 'desktopuser' });
    expect(api.answer).toHaveBeenCalledWith(
      ctx.admin,
      expect.objectContaining({
        requestId: REQUEST,
        actorId: OWNER,
        verdict: 'approved',
        minutes: 60,
        target: 'desktop.example.test:3389',
      }),
    );
    expect(out.join('\n')).toContain(CLI_TEXT.approved);
    expect(api.notify).toHaveBeenCalledWith({ kind: 'approved', id: REQUEST, minutes: 60, selfApproved: false });
  });

  it('grants the requested duration when --minutes is omitted', async () => {
    q.getRdpRequestDetail.mockResolvedValue({ request: { ...PENDING_REQUEST, requested_minutes: 120 }, grant: null, events: [] });
    const { ctx, api } = build();
    expect(await cmdApprove(ctx, { id: opts.id, note: '', yes: true })).toBe(EXIT.ok);
    expect(api.answer).toHaveBeenCalledWith(ctx.admin, expect.objectContaining({ minutes: 120 }));
    expect(api.notify).toHaveBeenCalledWith(expect.objectContaining({ minutes: 120 }));
  });

  it('flags a self-approval in the notification', async () => {
    q.getRdpRequestDetail.mockResolvedValue({ request: { ...PENDING_REQUEST, requester_id: OWNER }, grant: null, events: [] });
    const { ctx, api } = build();
    await cmdApprove(ctx, opts);
    expect(api.notify).toHaveBeenCalledWith(expect.objectContaining({ selfApproved: true }));
  });

  it.each([0, 4, 241, 60.5, Number.NaN])('rejects the duration %s without touching anything', async (minutes) => {
    const { ctx, api } = build();
    expect(await cmdApprove(ctx, { ...opts, minutes })).toBe(EXIT.error);
    expect(api.disconnect).not.toHaveBeenCalled();
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('refuses an invalid id as an error and an unknown id as nothing-to-do', async () => {
    q.resolveRdpRequestId.mockResolvedValueOnce({ ok: false, reason: 'invalid' });
    expect(await cmdApprove(build().ctx, opts)).toBe(EXIT.error);
    q.resolveRdpRequestId.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    expect(await cmdApprove(build().ctx, opts)).toBe(EXIT.noop);
    q.resolveRdpRequestId.mockResolvedValueOnce({ ok: false, reason: 'ambiguous' });
    const { ctx, err } = build();
    expect(await cmdApprove(ctx, opts)).toBe(EXIT.noop);
    expect(err).toContain(CLI_TEXT.ambiguousId);
  });

  it('does nothing for a request that is no longer pending or has already expired', async () => {
    q.getRdpRequestDetail.mockResolvedValue({ request: { ...PENDING_REQUEST, status: 'approved' }, grant: null, events: [] });
    const first = build();
    expect(await cmdApprove(first.ctx, opts)).toBe(EXIT.noop);
    expect(first.api.answer).not.toHaveBeenCalled();

    q.getRdpRequestDetail.mockResolvedValue({ request: { ...PENDING_REQUEST, expires_at: '2026-10-06T16:59:59Z' }, grant: null, events: [] });
    const second = build();
    expect(await cmdApprove(second.ctx, opts)).toBe(EXIT.noop);
    expect(second.err).toContain(CLI_TEXT.expired);
  });

  it('fails without touching the database when the gateway is not configured', async () => {
    const { ctx, api, err } = build({
      getConfig: vi.fn().mockReturnValue({ ok: false, problems: [{ variable: 'RDPGW_TARGET', reason: 'missing' }] }),
    });
    expect(await cmdApprove(ctx, opts)).toBe(EXIT.error);
    expect(err.join('\n')).toContain('RDPGW_TARGET');
    expect(api.answer).not.toHaveBeenCalled();
  });

  it.each([
    ['no owner', { ok: false, reason: 'no_owner', ownerIds: [] }],
    ['several owners without --as', { ok: false, reason: 'ambiguous', ownerIds: [OWNER, STAFF] }],
    ['a --as that is not an owner', { ok: false, reason: 'not_owner', ownerIds: [OWNER] }],
  ])('fails on %s', async (_label, resolution) => {
    q.resolveOwner.mockResolvedValue(resolution);
    const { ctx, api } = build();
    expect(await cmdApprove(ctx, opts)).toBe(EXIT.error);
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('passes --as through to the owner lookup', async () => {
    const { ctx } = build();
    await cmdApprove(ctx, { ...opts, as: OWNER });
    expect(q.resolveOwner).toHaveBeenCalledWith(ctx.admin, OWNER);
  });

  it('asks for confirmation unless --yes, and a refusal changes nothing', async () => {
    const { ctx, api, confirm } = build({}, false);
    expect(await cmdApprove(ctx, { ...opts, yes: false })).toBe(EXIT.noop);
    expect(confirm).toHaveBeenCalledWith(CLI_TEXT.confirmApprove);
    expect(api.disconnect).not.toHaveBeenCalled();
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('proceeds when the gateway is simply not running (no tunnels can exist)', async () => {
    const { ctx, api } = build({ disconnect: vi.fn().mockResolvedValue({ ok: false, kind: 'unreachable' }) });
    expect(await cmdApprove(ctx, opts)).toBe(EXIT.ok);
    expect(api.answer).toHaveBeenCalled();
  });

  it.each(['timeout', 'rejected', 'bad_response'] as const)(
    'refuses to approve when stale tunnels cannot be cleared (%s)',
    async (kind) => {
      const { ctx, api, err } = build({ disconnect: vi.fn().mockResolvedValue({ ok: false, kind }) });
      expect(await cmdApprove(ctx, opts)).toBe(EXIT.error);
      expect(api.answer).not.toHaveBeenCalled();
      expect(err.join('\n')).toContain(CLI_TEXT.staleTunnelsNotCleared);
    },
  );

  it('reports a grant conflict as nothing-to-do, naming the other grant', async () => {
    const { ctx, err } = build({
      answer: vi.fn().mockResolvedValue({ outcome: 'grant_conflict', grantId: null, expiresAt: null, conflictingGrantId: GRANT }),
    });
    expect(await cmdApprove(ctx, opts)).toBe(EXIT.noop);
    expect(err.join('\n')).toContain(GRANT.slice(0, 8));
  });

  it.each([
    ['requester_not_allowed', EXIT.error],
    ['invalid_target', EXIT.error],
    ['busy', EXIT.error],
    ['unexpected', EXIT.error],
    ['not_pending', EXIT.noop],
    ['expired', EXIT.noop],
  ])('maps the outcome %s to exit %s and sends no success notification', async (outcome, code) => {
    const { ctx, api } = build({
      answer: vi.fn().mockResolvedValue({ outcome, grantId: null, expiresAt: null, conflictingGrantId: null }),
    });
    expect(await cmdApprove(ctx, opts)).toBe(code);
    expect(api.notify).not.toHaveBeenCalled();
  });
});

describe('cmdDeny', () => {
  it('denies and notifies', async () => {
    const { ctx, api } = build({
      answer: vi.fn().mockResolvedValue({ outcome: 'denied', grantId: null, expiresAt: null, conflictingGrantId: null }),
    });
    expect(await cmdDeny(ctx, { id: 'x'.repeat(8), note: 'not now', yes: true })).toBe(EXIT.ok);
    expect(api.answer).toHaveBeenCalledWith(ctx.admin, expect.objectContaining({ verdict: 'denied', note: 'not now', actorId: OWNER }));
    expect(api.notify).toHaveBeenCalledWith({ kind: 'denied', id: REQUEST });
  });

  it('does nothing when declined at the prompt', async () => {
    const { ctx, api } = build({}, false);
    expect(await cmdDeny(ctx, { id: 'abcd', note: '', yes: false })).toBe(EXIT.noop);
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('reports a request that is no longer pending', async () => {
    const { ctx } = build({
      answer: vi.fn().mockResolvedValue({ outcome: 'not_pending', grantId: null, expiresAt: null, conflictingGrantId: null }),
    });
    expect(await cmdDeny(ctx, { id: 'abcd', note: '', yes: true })).toBe(EXIT.noop);
  });
});

describe('cmdRevoke', () => {
  const ACTIVE = { id: GRANT, user_id: STAFF, expires_at: '2026-10-06T18:00:00Z', files_issued: 1, max_files: 20 };

  it('revokes in the database FIRST, then cuts the tunnels and records the confirmation', async () => {
    q.getActiveRdpGrant.mockResolvedValue(ACTIVE);
    const { ctx, api, out } = build();
    expect(await cmdRevoke(ctx, { reason: 'done', yes: true })).toBe(EXIT.ok);
    expect(api.endGrant.mock.invocationCallOrder[0]!).toBeLessThan(api.disconnect.mock.invocationCallOrder[0]!);
    expect(api.endGrant).toHaveBeenCalledWith(ctx.admin, { actorId: OWNER, grantId: GRANT, reason: 'done' });
    expect(api.markCut).toHaveBeenCalledWith(ctx.admin, { grantId: GRANT, ok: true, errorCode: 'ok' });
    expect(api.notify).toHaveBeenCalledWith({ kind: 'revoked', id: GRANT, tunnelsCut: true });
    expect(out.join('\n')).toContain(CLI_TEXT.tunnelsCut);
  });

  it('exits 1 and says so when the disconnect cannot be confirmed (never hides a partial failure)', async () => {
    q.getActiveRdpGrant.mockResolvedValue(ACTIVE);
    const { ctx, api, out } = build({ disconnect: vi.fn().mockResolvedValue({ ok: false, kind: 'timeout' }) });
    expect(await cmdRevoke(ctx, { reason: '', yes: true })).toBe(EXIT.error);
    expect(api.markCut).toHaveBeenCalledWith(ctx.admin, { grantId: GRANT, ok: false, errorCode: 'timeout' });
    expect(out.join('\n')).toContain(CLI_TEXT.tunnelsNotCut);
    expect(api.notify).toHaveBeenCalledWith({ kind: 'revoked', id: GRANT, tunnelsCut: false });
  });

  it('exits 1 when the gateway is not configured, after the database revoke', async () => {
    q.getActiveRdpGrant.mockResolvedValue(ACTIVE);
    const { ctx, api } = build({
      getConfig: vi.fn().mockReturnValue({ ok: false, problems: [{ variable: 'RDPGW_ADMIN_SECRET', reason: 'missing' }] }),
    });
    expect(await cmdRevoke(ctx, { reason: '', yes: true })).toBe(EXIT.error);
    expect(api.endGrant).toHaveBeenCalled();
    expect(api.disconnect).not.toHaveBeenCalled();
  });

  it('has nothing to do without an active grant', async () => {
    const { ctx, api } = build();
    expect(await cmdRevoke(ctx, { reason: '', yes: true })).toBe(EXIT.noop);
    expect(api.endGrant).not.toHaveBeenCalled();
  });

  it('does nothing when declined', async () => {
    q.getActiveRdpGrant.mockResolvedValue(ACTIVE);
    const { ctx, api } = build({}, false);
    expect(await cmdRevoke(ctx, { reason: '', yes: false })).toBe(EXIT.noop);
    expect(api.endGrant).not.toHaveBeenCalled();
  });

  it('reports a refusal from the database (not an owner)', async () => {
    q.getActiveRdpGrant.mockResolvedValue(ACTIVE);
    const { ctx, api } = build({ endGrant: vi.fn().mockResolvedValue({ outcome: 'not_owner', grantId: null }) });
    expect(await cmdRevoke(ctx, { reason: '', yes: true })).toBe(EXIT.error);
    expect(api.disconnect).not.toHaveBeenCalled();
  });
});

describe('read-only commands', () => {
  it('lists as a table, and as JSON without any secret', async () => {
    q.listRdpRequests.mockResolvedValue([PENDING_REQUEST]);
    const table = build();
    expect(await cmdList(table.ctx, { status: 'pending', json: false })).toBe(EXIT.ok);
    expect(table.out[0]).toContain(REQUEST.slice(0, 8));
    expect(table.out[0]).toContain('Dana Levi');

    const json = build();
    await cmdList(json.ctx, { status: 'all', json: true });
    const parsed = JSON.parse(json.out[0]!) as { id: string; requester: string }[];
    expect(parsed[0]).toMatchObject({ id: REQUEST, requester: 'Dana Levi' });
  });

  it('says so when there is nothing pending', async () => {
    const { ctx, out } = build();
    await cmdList(ctx, { status: 'pending', json: false });
    expect(out).toEqual([CLI_TEXT.noPending]);
  });

  it('shows one request with its events, and reports an unknown one', async () => {
    q.getRdpRequestDetail.mockResolvedValue({
      request: PENDING_REQUEST,
      grant: null,
      events: [{ at: '2026-10-06T16:50:00Z', kind: 'requested', actor_kind: 'staff', outcome: 'pending' }],
    });
    const found = build();
    expect(await cmdShow(found.ctx, 'abcd')).toBe(EXIT.ok);
    expect(found.out.join('\n')).toContain('requested');

    q.getRdpRequestDetail.mockResolvedValue(null);
    const missing = build();
    expect(await cmdShow(missing.ctx, 'abcd')).toBe(EXIT.noop);
  });

  it('prints the status without any secret value', async () => {
    q.countPendingRdpRequests.mockResolvedValue(2);
    const { ctx, out } = build();
    expect(await cmdStatus(ctx)).toBe(EXIT.ok);
    const text = out.join('\n');
    expect(text).toContain('בקשות ממתינות: 2');
    expect(text).not.toContain('c'.repeat(40));
  });

  it('says whether ticket login is on, off or half-set, by variable name and never by value', async () => {
    const off = build();
    await cmdStatus(off.ctx);
    expect(off.out.join('\n')).toContain('כניסה לשולחן עם כרטיס: כבויה');

    const on = build({ getTicketConfig: vi.fn().mockReturnValue({ ok: true, config: { ticketSecret: 't'.repeat(40), checkSecret: 'k'.repeat(40), account: 'desktopuser' } }) });
    await cmdStatus(on.ctx);
    expect(on.out.join('\n')).toContain('כניסה לשולחן עם כרטיס: מוגדרת');
    expect(on.out.join('\n')).not.toMatch(/t{40}|k{40}/);

    const broken = build({ getTicketConfig: vi.fn().mockReturnValue({ ok: false, reason: 'invalid', variables: ['RDPGW_XRDP_CHECK_SECRET'] }) });
    await cmdStatus(broken.ctx);
    expect(broken.out.join('\n')).toContain('RDPGW_XRDP_CHECK_SECRET');
  });

  it('lists the failing gateway variables by name in the status', async () => {
    const { ctx, out } = build({
      getConfig: vi.fn().mockReturnValue({ ok: false, problems: [{ variable: 'RDPGW_USER', reason: 'invalid' }] }),
    });
    await cmdStatus(ctx);
    expect(out.join('\n')).toContain('RDPGW_USER (invalid)');
  });
});
