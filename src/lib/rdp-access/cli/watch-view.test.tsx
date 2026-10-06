import { PassThrough } from 'node:stream';

import { render } from 'ink';
import { describe, expect, it } from 'vitest';

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
    extras: new Map([[REQUEST_ID, { requestIp: '203.0.113.7', answerNote: null }]]),
    live: { known: true, count: 1, tunnels: [{ tunnelId: 't', user: 'desktopuser', clientIp: '203.0.113.7', target: 'h:3389', connectedOn: '2026-10-07T00:00:09Z' }] },
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
    const out = await frame(base({ live: { known: false } }));
    expect(out).toContain('LIVE --');
    expect(out).not.toContain('LIVE 00');
  });

  it('reports the live grant together with who is connected', async () => {
    const out = await frame(
      base({
        active: { id: 'g', request_id: REQUEST_ID, user_id: USER_ID, status: 'active', target: 'h:3389', starts_at: '2026-10-07T00:00:00Z', expires_at: '2026-10-07T01:00:00Z', ended_at: null, ended_reason: null, files_issued: 2, max_files: 20, tunnels_cut_at: null, cut_attempts: 0 },
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
          extras: new Map(MANY.map((r) => [r.id, { requestIp: '2001:db8:85a3::8a2e:370:7334', answerNote: null }])),
          activity: [{ time: '00:01:00', message: 'Approved 0199e9d1 '.repeat(8) }],
          active: { id: 'g', request_id: REQUEST_ID, user_id: USER_ID, status: 'active', target: 'h:3389', starts_at: '2026-10-07T00:00:00Z', expires_at: '2026-10-07T01:00:00Z', ended_at: null, ended_reason: null, files_issued: 2, max_files: 20, tunnels_cut_at: null, cut_attempts: 0 },
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
