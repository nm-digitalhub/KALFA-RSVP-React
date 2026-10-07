import { PassThrough } from 'node:stream';

import { render } from 'ink';
import { describe, expect, it } from 'vitest';

import type { ConnectionDetail } from '../connections';
import { INITIAL_CONNECTIONS, INITIAL_CONNECTIONS_VIEW, nextConnectionsState, type ConnectionsState } from './connections-state';
import { WatchView, type WatchViewProps } from './watch-view';

const REQUEST_ID = '0199e9d1-8c2a-7b3c-9d4e-5f6a7b8c9d0e';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-07T00:00:00.000Z');

const REQUEST = {
  id: REQUEST_ID,
  status: 'pending',
  reason: 'החלפת מפתח בשרת',
  requested_minutes: 60,
  granted_minutes: null,
  requester_id: USER_ID,
  created_at: '2026-10-06T23:56:00.000Z',
  expires_at: '2026-10-07T00:26:00.000Z',
  answered_at: null,
} as const;

function conn(id: string, over: Partial<ConnectionDetail> = {}): ConnectionDetail {
  return {
    tunnelId: id, gatewayUser: 'desktopuser', clientIp: '198.51.100.20', target: 'desktop.example.test:3389', connectedOn: '2026-10-06T23:50:00.000Z',
    attribution: 'attributed', grantId: 'g-1111-aaaa', requestId: REQUEST_ID, permission: 'active',
    grantStartsAt: '2026-10-06T23:45:00.000Z', grantExpiresAt: '2026-10-07T00:45:00.000Z', grantEndedAt: null,
    reason: 'החלפת מפתח בשרת', requesterId: USER_ID, approverId: USER_ID, requestIp: '203.0.113.7', requestedMinutes: 60, grantedMinutes: 60,
    tunnelsOpened: 1, cut: 'not_needed', cutError: null, filesIssued: 1, maxFiles: 20, ...over,
  };
}
function stateWith(...open: ConnectionDetail[]): ConnectionsState {
  return nextConnectionsState(INITIAL_CONNECTIONS, { gateway: 'ok', attribution: 'ok', connections: open }, '2026-10-07T00:00:05.000Z');
}

function base(over: Partial<WatchViewProps> = {}): WatchViewProps {
  return {
    columns: 120,
    terminalRows: 44,
    hostname: 'kalfa-host',
    now: NOW,
    requests: [REQUEST],
    names: new Map([[USER_ID, 'Dana Levi']]),
    selected: 0,
    chosen: REQUEST,
    active: null,
    expired24h: 3,
    extras: new Map([[REQUEST_ID, { requestIp: '203.0.113.7', answerNote: null, answeredBy: null }]]),
    view: 'requests',
    connections: stateWith(conn('t', { clientIp: '203.0.113.7', connectedOn: '2026-10-07T00:00:09.000Z' })),
    connectionsView: INITIAL_CONNECTIONS_VIEW,
    history: [
      { time: '00:00:07', message: '0199e9d1  Approved' },
      { time: '00:00:09', message: '0199e9d1  Gateway check: allowed' },
    ],
    identity: 'desktopuser',
    route: 'RD Gateway',
    target: 'desktop.example.test:3389',
    loaded: true,
    error: null,
    busy: false,
    intervalSeconds: 5,
    mode: { kind: 'list' },
    inspecting: false,
    activity: [],
    ...over,
  };
}

// Renders one frame to a fake terminal and returns the plain text (colour codes stripped).
async function frame(props: WatchViewProps): Promise<string> {
  const stdout = Object.assign(new PassThrough(), { columns: props.columns, rows: props.terminalRows });
  let output = '';
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const app = render(<WatchView {...props} />, { stdout: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 30));
  app.unmount();
  return output.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('WatchView', () => {
  it('shows real values, under names that say what they are', async () => {
    const out = await frame(base());
    expect(out).toContain('203.0.113.7'); // Request IP: the address recorded with the request
    expect(out).toMatch(/Requester\s+Dana Levi/);
    expect(out).toMatch(/Gateway user\s+desktopuser/);
    expect(out).toMatch(/Route\s+RD Gateway/);
    expect(out).toMatch(/Request IP\s+203\.0\.113\.7/);
    expect(out).not.toContain('Not recorded');
    expect(out).toContain('LIVE 01');
    expect(out).toContain('EXPIRED 24H 03');
    expect(out).toContain('GRANT 00');
  });

  it('shows recent activity from the audit trail, not just this session', async () => {
    const out = await frame(base());
    expect(out).toContain('00:00:07  0199e9d1  Approved');
    expect(out).toContain('00:00:09  0199e9d1  Gateway check: allowed');
    expect(out).not.toContain('No CLI actions in this session');
  });

  it('keeps what was done from this screen as its own, marked line', async () => {
    const out = await frame(base({ activity: [{ time: '00:01:00', message: 'Approved 0199e9d1' }] }));
    expect(out).toContain('00:01:00  CLI  Approved 0199e9d1');
  });

  it('says so when a request has no recorded address, and when the gateway is not configured', async () => {
    const out = await frame(base({ extras: new Map(), identity: null, route: null }));
    expect(out).toMatch(/Request IP\s+Not recorded/);
    expect(out).toMatch(/Gateway user\s+Gateway not configured/);
    expect(out).toMatch(/Route\s+Gateway not configured/);
  });

  it('shows LIVE as unknown instead of zero when the gateway could not be asked', async () => {
    const out = await frame(base({ connections: nextConnectionsState(stateWith(conn('t')), { gateway: 'failed' }, '2026-10-07T00:00:10.000Z') }));
    expect(out).toContain('LIVE --');
    expect(out).not.toContain('LIVE 00');
    expect(out).not.toContain('LIVE 01');
  });

  it('reports the live grant together with who is connected', async () => {
    const out = await frame(
      base({
        active: { id: 'g', request_id: REQUEST_ID, user_id: USER_ID, status: 'active', target: 'h:3389', starts_at: '2026-10-07T00:00:00Z', expires_at: '2026-10-07T01:00:00Z', ended_at: null, ended_reason: null, files_issued: 2, max_files: 20, tunnels_cut_at: null, cut_attempts: 0, last_cut_error: null },
      }),
    );
    expect(out).toContain('GRANT 01');
    expect(out).toContain('Files 2/20');
    expect(out).toContain('Live 1 from 203.0.113.7');
  });

  it('survives a request whose requester is gone', async () => {
    const out = await frame(base({ requests: [{ ...REQUEST, requester_id: null }], chosen: { ...REQUEST, requester_id: null } }));
    expect(out).toContain('ACCESS REQUESTS');
  });
});

// ── any window size ─────────────────────────────────────────────────────────────────────────────

const MANY = Array.from({ length: 9 }, (_, i) => ({
  ...REQUEST,
  id: `0199e9d${i}-8c2a-7b3c-9d4e-5f6a7b8c9d0e`,
  requester_id: i % 2 ? USER_ID : null,
  reason: 'החלפת מפתח בשרת ובדיקת הלוגים של ה-worker '.repeat(6),
}));
const NAMES = new Map([[USER_ID, 'Dana Levi-Mevorach With A Very Long Display Name']]);
const HISTORY = Array.from({ length: 6 }, (_, i) => ({ time: `00:00:0${i}`, message: `0199e9d1  Gateway check: allowed ${'x'.repeat(80)}` }));

async function frameLines(props: WatchViewProps): Promise<string[]> {
  const stdout = Object.assign(new PassThrough(), { columns: props.columns, rows: props.terminalRows });
  const writes: string[] = [];
  stdout.on('data', (chunk: Buffer) => {
    writes.push(chunk.toString('utf8'));
  });
  const app = render(<WatchView {...props} />, { stdout: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 30));
  app.unmount();
  // debug mode writes the whole frame on every render; the last write that has content is what the terminal ends up showing
  const last = writes.filter((w) => w.trim() !== '').at(-1) ?? '';
  return last.replace(/\u001b\[[0-9;]*m/g, '').replace(/\n+$/, '').split('\n');
}

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [40, 16], [40, 24], [60, 20], [80, 24], [80, 30], [94, 28], [95, 28], [100, 36], [120, 44], [120, 50], [160, 60], [200, 80], [300, 100],
];

describe('WatchView at any window size', () => {
  for (const [columns, rows] of SIZES) {
    it(`${columns}x${rows}: fits the window, shows the selected request and how to quit`, async () => {
      const lines = await frameLines(
        base({
          columns, terminalRows: rows, requests: MANY, chosen: MANY[6], selected: 6, names: NAMES, history: HISTORY,
          extras: new Map(MANY.map((r) => [r.id, { requestIp: '2001:db8:85a3::8a2e:370:7334', answerNote: null, answeredBy: null }])),
          activity: [{ time: '00:01:00', message: 'Approved 0199e9d1 '.repeat(8) }],
          active: { id: 'g', request_id: REQUEST_ID, user_id: USER_ID, status: 'active', target: 'h:3389', starts_at: '2026-10-07T00:00:00Z', expires_at: '2026-10-07T01:00:00Z', ended_at: null, ended_reason: null, files_issued: 2, max_files: 20, tunnels_cut_at: null, cut_attempts: 0, last_cut_error: null },
          mode: { kind: 'approve', requestId: MANY[6]!.id, minutes: 60 },
        }),
      );
      const text = lines.join('\n');
      expect(lines.length, 'taller than the window').toBeLessThanOrEqual(rows - 1);
      expect(Math.max(...lines.map((l) => l.length)), 'wider than the window').toBeLessThanOrEqual(columns - 1);
      expect(text).toContain('0199e9d6'); // the selected request is on screen, however short the list
      expect(text).toMatch(/Q/);
      expect(text).toContain('Approve 0199e9d6'); // the confirmation prompt is never pushed off the bottom
    });
  }

  it('says so under the minimum size and still names the way out', async () => {
    const lines = await frameLines(base({ columns: 39, terminalRows: 15 }));
    const text = lines.join('\n');
    expect(text).toContain('Terminal too small');
    expect(text).toContain('39x15, need 40x16');
    expect(text).toContain('press Q to quit');
  });

  it('shows the details of the selected request on demand in a narrow window', async () => {
    const lines = await frameLines(base({ columns: 80, terminalRows: 30, inspecting: true }));
    const text = lines.join('\n');
    expect(text).toContain('REQUEST DETAILS');
    expect(text).not.toContain('ACCESS REQUESTS');
  });
});

// ── the connections view ────────────────────────────────────────────────────────────────────────

const NOW_CONN = new Date('2026-10-07T00:00:10.000Z');
const T1 = 'aaaaaaaa-1111-4111-8111-000000000001';
const T2 = 'bbbbbbbb-2222-4222-8222-000000000002';
const T3 = 'cccccccc-3333-4333-8333-000000000003';
const NAMES_CONN = new Map([[USER_ID, 'Dana Levi']]);

function connectionsFrame(over: Partial<WatchViewProps>) {
  return frame(base({ view: 'connections', now: NOW_CONN, names: NAMES_CONN, ...over }));
}

describe('WatchView, connections view', () => {
  it('says "no open connections" only after a successful empty answer from the gateway', async () => {
    const out = await connectionsFrame({ connections: stateWith() });
    expect(out).toContain('OPEN CONNECTIONS');
    expect(out).toContain('No open connections in the gateway.');
    expect(out).toContain('LIVE 00');
  });

  it('shows a connection under an active permission with the requester, the time left and the permission', async () => {
    const out = await connectionsFrame({ connections: stateWith(conn(T1)) });
    expect(out).toContain('aaaaaaaa');
    expect(out).toContain('Dana Levi');
    expect(out).toContain('ACTIVE');
    expect(out).toContain('00:44:50'); // 00:45:00 - 00:00:10
    expect(out).toContain('LIVE 01');
  });

  it('highlights a connection that is open under an expired or revoked permission', async () => {
    const out = await connectionsFrame({
      connections: stateWith(
        conn(T1, { permission: 'expired', grantExpiresAt: '2026-10-07T00:00:00.000Z' }),
        conn(T2, { permission: 'revoked', grantEndedAt: '2026-10-07T00:00:00.000Z' }),
      ),
    });
    expect(out).toContain('EXPIRED');
    expect(out).toContain('REVOKED');
    expect(out).toMatch(/!\s+aaaaaaaa/);
    expect(out).toMatch(/!\s+bbbbbbbb/);
  });

  it('does not call a connection without attribution unauthorized, and says why it has none', async () => {
    const out = await frame(base({
      view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns: 160, terminalRows: 50,
      connections: stateWith(conn(T3, { attribution: 'none', grantId: null, requestId: null, permission: null, requesterId: null })),
      connectionsView: { selectedId: T3, details: true, scroll: 0 },
    }));
    expect(out).toContain('No attribution found');
    expect(out).toContain('does not by itself mean it is unauthorized');
    expect(out).not.toMatch(/unauthori[sz]ed connection|not authori[sz]ed/i);

    const list = await connectionsFrame({ connections: stateWith(conn(T3, { attribution: 'none', grantId: null, requestId: null, permission: null, requesterId: null })) });
    expect(list).toContain('NO MATCH');
    expect(list).not.toMatch(/!\s+cccccccc/); // no "overdue" mark: a missing record is not proof of anything
  });

  it('keeps the connections and marks their permissions unavailable when the database failed', async () => {
    const connections = nextConnectionsState(
      INITIAL_CONNECTIONS,
      { gateway: 'ok', attribution: 'failed', connections: [conn(T1, { attribution: 'unavailable', permission: null, grantId: null, requesterId: null })] },
      '2026-10-07T00:00:05.000Z',
    );
    const out = await connectionsFrame({ connections });
    expect(out).toContain('aaaaaaaa');
    expect(out).toContain('NO DATA');
    expect(out).toContain('Database unavailable');
    expect(out).toContain('LIVE 01');
  });

  it('marks the list as not current when the gateway failed, shows when it last answered, and never shows 00', async () => {
    const connections = nextConnectionsState(stateWith(conn(T1)), { gateway: 'failed' }, '2026-10-07T00:00:08.000Z');
    const out = await connectionsFrame({ connections });
    expect(out).toContain('STALE (not current)');
    expect(out).toContain('last answer 03:00:05');
    expect(out).toContain('LIVE --');
    expect(out).not.toContain('LIVE 00');
    expect(out).toMatch(/\?\s+aaaaaaaa/); // unknown, not open
  });

  it('does not claim "no connections" when the gateway failed before it ever answered', async () => {
    const out = await connectionsFrame({ connections: nextConnectionsState(INITIAL_CONNECTIONS, { gateway: 'failed' }, '2026-10-07T00:00:08.000Z') });
    expect(out).toContain('Connections unknown');
    expect(out).not.toContain('No open connections');
    expect(out).toContain('LIVE --');
  });

  it('keeps a vanished connection as "gone", never as "disconnected"', async () => {
    const connections = nextConnectionsState(stateWith(conn(T1), conn(T2)), { gateway: 'ok', attribution: 'ok', connections: [conn(T2)] }, '2026-10-07T00:00:09.000Z');
    const out = await connectionsFrame({ connections });
    expect(out).toMatch(/-\s+aaaaaaaa/);
    expect(out).toContain('GONE');
    expect(out).not.toMatch(/disconnected|נותק/i);
  });

  it('shows the details of the selected connection with the two addresses under their own names', async () => {
    const out = await frame(base({
      view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns: 160, terminalRows: 60,
      connections: stateWith(conn(T1, { tunnelsOpened: 2 })),
      connectionsView: { selectedId: T1, details: true, scroll: 0 },
    }));
    expect(out).toContain(T1);
    expect(out).toMatch(/Connection IP\s+198\.51\.100\.20/);
    expect(out).toMatch(/Request IP\s+203\.0\.113\.7/);
    expect(out).toMatch(/Requester\s+Dana Levi/);
    expect(out).toMatch(/Approved by\s+Dana Levi/);
    expect(out).toContain('החלפת מפתח בשרת');
    expect(out).toContain('2 under this grant');
    expect(out).toMatch(/Permission\s+Active/);
    expect(out).toMatch(/Gateway data\s+03:00:05 \(5s ago\)/); // Israel time, UTC+3
  });

  it('shows how the disconnect stands only when the grant row says one was tried', async () => {
    const pending = await frame(base({
      view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns: 160, terminalRows: 60,
      connections: stateWith(conn(T1, { permission: 'revoked', cut: 'pending', grantEndedAt: '2026-10-07T00:00:00.000Z' })),
      connectionsView: { selectedId: T1, details: true, scroll: 0 },
    }));
    expect(pending).toMatch(/Disconnect\s+Done once, waiting for the second check/);
    const active = await frame(base({
      view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns: 160, terminalRows: 60,
      connections: stateWith(conn(T1)),
      connectionsView: { selectedId: T1, details: true, scroll: 0 },
    }));
    expect(active).not.toContain('Disconnect ');
  });

  it('shows only the keys that exist here: no action key is offered', async () => {
    const out = await connectionsFrame({ connections: stateWith(conn(T1)) });
    expect(out).toContain('[Tab] Requests');
    expect(out).toContain('[Enter] Details');
    expect(out).toContain('[R] Refresh');
    expect(out).toContain('[Q] Quit');
    expect(out).not.toMatch(/\[A\] Approve|\[D\] Deny|\[X\] Revoke|Disconnect now|Extend/);
    const requests = await frame(base());
    expect(requests).toContain('[Tab] Connections');
  });

  it('keeps the selected connection in view, by id, when the list has many rows', async () => {
    const many = Array.from({ length: 12 }, (_, i) => conn(`dddddddd-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`));
    for (const [columns, rows] of [[80, 24], [120, 30], [160, 50]] as const) {
      const selectedId = many[9]!.tunnelId;
      const lines = await frameLines(base({ view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns, terminalRows: rows, connections: stateWith(...many), connectionsView: { selectedId, details: false, scroll: 0 } }));
      expect(lines.join('\n'), `${columns}x${rows}`).toContain(selectedId.slice(0, 8) + ' ');
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(columns - 1);
    }
  });

  it('fits every window size without losing the selected row or the way out', async () => {
    const rowsData = [
      conn(T1), conn(T2, { permission: 'revoked' }), conn(T3, { attribution: 'none', grantId: null, requestId: null, permission: null, requesterId: null }),
    ];
    for (const [columns, rows] of SIZES) {
      const lines = await frameLines(base({ view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns, terminalRows: rows, connections: stateWith(...rowsData), connectionsView: { selectedId: T2, details: false, scroll: 0 } }));
      const text = lines.join('\n');
      expect(lines.length, `${columns}x${rows} height`).toBeLessThanOrEqual(rows - 1);
      expect(Math.max(...lines.map((l) => l.length)), `${columns}x${rows} width`).toBeLessThanOrEqual(columns - 1);
      expect(text, `${columns}x${rows} selected`).toContain('bbbbbbbb');
      expect(text, `${columns}x${rows} quit`).toMatch(/Q/);
    }
  });

  it('opens the details full width and scrolls them, so nothing essential is cut off', async () => {
    const scrolled = await frame(base({
      view: 'connections', now: NOW_CONN, names: NAMES_CONN, columns: 80, terminalRows: 24,
      connections: stateWith(conn(T1)),
      connectionsView: { selectedId: T1, details: true, scroll: 12 },
    }));
    expect(scrolled).toContain('[Up/Down] Scroll');
    expect(scrolled).not.toContain('OPEN CONNECTIONS');
    expect(scrolled).toMatch(/Tunnels opened|Files|Approved for/); // the lines that were below the fold
  });
});
