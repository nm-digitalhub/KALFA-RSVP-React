import { describe, expect, it } from 'vitest';

import { deriveRdpDisplayStatus, stationStatesFor } from './status';

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
  it('puts a waiting request at the owner\'s approval and nothing after it', () => {
    expect(stationStatesFor('pending', 0)).toEqual(['done', 'waiting', 'upcoming', 'upcoming']);
  });

  it('moves a live grant from "file" to "connected" once a file was downloaded', () => {
    expect(stationStatesFor('active', 0)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(stationStatesFor('active', 2)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('marks an ended grant that never produced a file as stopped at the file', () => {
    expect(stationStatesFor('ended', 0)).toEqual(['done', 'done', 'stopped', 'upcoming']);
    expect(stationStatesFor('ended', 1)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('stops every unanswered or refused request at the owner\'s approval', () => {
    for (const status of ['denied', 'expired', 'cancelled'] as const) {
      expect(stationStatesFor(status, 0)).toEqual(['done', 'stopped', 'upcoming', 'upcoming']);
    }
  });
});
