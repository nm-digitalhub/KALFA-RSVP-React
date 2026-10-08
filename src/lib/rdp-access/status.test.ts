import { describe, expect, it } from 'vitest';

import { deriveRdpDisplayStatus, firstGatewayAllow, stationStatesFor } from './status';

const now = new Date('2026-10-07T00:00:00.000Z');
const live = { status: 'active', expires_at: '2026-10-07T01:00:00.000Z' };

describe('deriveRdpDisplayStatus', () => {
  it('maps the simple request statuses', () => {
    expect(deriveRdpDisplayStatus('pending', null, now)).toBe('pending');
    expect(deriveRdpDisplayStatus('denied', null, now)).toBe('denied');
    expect(deriveRdpDisplayStatus('cancelled', null, now)).toBe('cancelled');
    expect(deriveRdpDisplayStatus('expired', null, now)).toBe('expired');
  });

  it('is active only while the grant is live', () => {
    expect(deriveRdpDisplayStatus('approved', live, now)).toBe('active');
    expect(deriveRdpDisplayStatus('approved', { ...live, status: 'revoked' }, now)).toBe('ended');
    expect(deriveRdpDisplayStatus('approved', { ...live, status: 'expired' }, now)).toBe('ended');
    expect(deriveRdpDisplayStatus('approved', null, now)).toBe('ended');
  });

  it('treats a grant past its end as over even when the sweep has not marked it', () => {
    expect(deriveRdpDisplayStatus('approved', { status: 'active', expires_at: '2026-10-06T23:59:59.000Z' }, now)).toBe('ended');
  });

  it('treats an unknown request status as expired rather than as live', () => {
    expect(deriveRdpDisplayStatus('something_new', live, now)).toBe('expired');
  });
});

describe('stationStatesFor', () => {
  const none = { filesIssued: 0, connected: false };

  it('puts a waiting request at the owner\'s approval and nothing after it', () => {
    expect(stationStatesFor('pending', none)).toEqual(['done', 'waiting', 'upcoming', 'upcoming']);
  });

  it('lights the last station only for a connection the gateway recorded, never for a download', () => {
    expect(stationStatesFor('active', none)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(stationStatesFor('active', { filesIssued: 5, connected: false })).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(stationStatesFor('active', { filesIssued: 1, connected: true })).toEqual(['done', 'done', 'done', 'current']);
  });

  it('marks where an ended grant stopped: no file, a file but no connection, or all the way', () => {
    expect(stationStatesFor('ended', none)).toEqual(['done', 'done', 'stopped', 'upcoming']);
    expect(stationStatesFor('ended', { filesIssued: 2, connected: false })).toEqual(['done', 'done', 'done', 'stopped']);
    expect(stationStatesFor('ended', { filesIssued: 1, connected: true })).toEqual(['done', 'done', 'done', 'done']);
  });

  it('stops every unanswered or refused request at the owner\'s approval', () => {
    for (const status of ['denied', 'expired', 'cancelled'] as const) {
      expect(stationStatesFor(status, none)).toEqual(['done', 'stopped', 'upcoming', 'upcoming']);
    }
  });
});

describe('firstGatewayAllow', () => {
  it('is the earliest allowed gateway check, whatever order the events come in', () => {
    expect(
      firstGatewayAllow([
        { at: '2026-10-07T00:00:20.000Z', kind: 'tunnel_check', outcome: 'allow' },
        { at: '2026-10-07T00:00:09.000Z', kind: 'tunnel_check', outcome: 'allow' },
        { at: '2026-10-07T00:00:05.000Z', kind: 'tunnel_check', outcome: 'deny:no_grant' },
        { at: '2026-10-07T00:00:01.000Z', kind: 'approved', outcome: null },
      ]),
    ).toBe('2026-10-07T00:00:09.000Z');
  });

  it('is null when the gateway never allowed anything: a refusal or other events are no connection', () => {
    expect(firstGatewayAllow([])).toBeNull();
    expect(
      firstGatewayAllow([
        { at: '2026-10-07T00:00:05.000Z', kind: 'tunnel_check', outcome: 'deny:expired' },
        { at: '2026-10-07T00:00:06.000Z', kind: 'file_issued', outcome: 'allow' },
      ]),
    ).toBeNull();
  });
});
