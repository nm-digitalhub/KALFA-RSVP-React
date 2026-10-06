import { describe, expect, it } from 'vitest';

import { RDP_EVENT_KINDS } from '../events';
import { describeRecentEvent, liveConnections, toHistoryLines } from './watch-data';

const ID = '0199e9d1-8c2a-7b3c-9d4e-5f6a7b8c9d0e';

describe('describeRecentEvent', () => {
  it('has a line for every audit event kind, led by the short request id', () => {
    for (const kind of RDP_EVENT_KINDS) {
      const line = describeRecentEvent({ kind, requestId: ID, outcome: null });
      expect(line.startsWith('0199e9d1  ')).toBe(true);
      expect(line.length).toBeGreaterThan('0199e9d1  '.length + 3);
    }
  });

  it('reads a gateway check as allowed or denied with the reason', () => {
    expect(describeRecentEvent({ kind: 'tunnel_check', requestId: ID, outcome: 'allow' })).toBe('0199e9d1  Gateway check: allowed');
    expect(describeRecentEvent({ kind: 'tunnel_check', requestId: ID, outcome: 'deny:no_active_grant' })).toBe(
      '0199e9d1  Gateway check: denied (no_active_grant)',
    );
    expect(describeRecentEvent({ kind: 'tunnel_check', requestId: null, outcome: null })).toBe('--------  Gateway check: denied');
  });

  it('appends a short outcome code and shows an unknown kind by its own code instead of hiding it', () => {
    expect(describeRecentEvent({ kind: 'file_failed', requestId: ID, outcome: 'timeout' })).toBe('0199e9d1  File preparation failed (timeout)');
    expect(describeRecentEvent({ kind: 'disconnect_ok', requestId: ID, outcome: 'ok' })).toBe('0199e9d1  Live connections cut');
    expect(describeRecentEvent({ kind: 'approved', requestId: ID, outcome: 'approved' })).toBe('0199e9d1  Approved');
    expect(describeRecentEvent({ kind: 'brand_new_kind', requestId: null, outcome: null })).toBe('--------  brand_new_kind');
    expect(describeRecentEvent({ kind: 'brand_new_kind', requestId: null, outcome: 'x' })).toBe('--------  brand_new_kind (x)');
  });
});

describe('toHistoryLines', () => {
  it('turns newest-first events into oldest-first lines with formatted times', () => {
    const lines = toHistoryLines(
      [
        { at: '2026-10-07T00:00:12Z', kind: 'grant_revoked', actorKind: 'owner_cli', requestId: ID, outcome: null },
        { at: '2026-10-07T00:00:07Z', kind: 'approved', actorKind: 'owner_cli', requestId: ID, outcome: null },
      ],
      (iso) => iso.slice(11, 19),
    );
    expect(lines).toEqual([
      { time: '00:00:07', message: '0199e9d1  Approved' },
      { time: '00:00:12', message: '0199e9d1  Access revoked' },
    ]);
  });
});

describe('liveConnections', () => {
  it('counts the gateway\'s tunnels, including none', () => {
    expect(liveConnections({ ok: true, value: { tunnels: [] } })).toEqual({ known: true, count: 0, tunnels: [] });
    const tunnel = { tunnelId: 't', user: 'u', clientIp: '203.0.113.7', target: 'h:3389', connectedOn: 'x' };
    expect(liveConnections({ ok: true, value: { tunnels: [tunnel] } })).toEqual({ known: true, count: 1, tunnels: [tunnel] });
  });

  it('is unknown, not zero, when the gateway could not be asked', () => {
    expect(liveConnections({ ok: false })).toEqual({ known: false });
    expect(liveConnections(null)).toEqual({ known: false });
  });
});
