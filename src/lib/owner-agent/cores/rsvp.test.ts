import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { createAdminClient } from '@/lib/supabase/admin';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import { getRsvpTotals } from './rsvp';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25; Israel midnight = 2026-09-24T21:00Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

// Rows embed their event as `events`, the shape `events!inner(status)` filters
// on. Each carries guest PII the core must count past.
const active = { status: 'active' };
const closed = { status: 'closed' };
const pii = { full_name: 'דנה כהן', phone: '+972501234567', note: 'אלרגיה לבוטנים', rsvp_token: 'tok-1' };
function db() {
  return createFakeCountClient({
    events: [
      { id: 'e1', status: 'active' },
      { id: 'e2', status: 'active' },
      { id: 'e3', status: 'closed' },
      { id: 'e4', status: 'draft' },
    ],
    guests: [
      { id: 'g1', ...pii, status: 'attending', expected_count: 4, events: active },
      { id: 'g2', ...pii, status: 'attending', expected_count: 2, events: active },
      { id: 'g3', ...pii, status: 'declined', expected_count: 1, events: active },
      { id: 'g4', ...pii, status: 'maybe', expected_count: null, events: active },
      { id: 'g5', ...pii, status: 'pending', expected_count: 3, events: active },
      { id: 'g6', ...pii, status: 'pending', expected_count: 1, events: active },
      // not active → never counted
      { id: 'g7', ...pii, status: 'attending', expected_count: 5, events: closed },
      { id: 'g8', ...pii, status: 'pending', expected_count: 1, events: { status: 'draft' } },
      // an embed that did not join is dropped, as an inner join drops it
      { id: 'g9', ...pii, status: 'attending', expected_count: 1, events: null },
    ],
    rsvp_responses: [
      { id: 'r1', note: 'נגיע', created_at: '2026-09-24T21:30:00Z', events: active },
      { id: 'r2', note: 'x', created_at: '2026-09-24T20:00:00Z', events: active }, // 23:00 on the 24th
      { id: 'r3', note: 'x', created_at: '2026-09-20T10:00:00Z', events: active },
      { id: 'r4', note: 'x', created_at: '2026-09-24T22:00:00Z', events: closed },
      { id: 'r5', note: 'x', created_at: '2026-09-01T10:00:00Z', events: active },
    ],
  });
}

describe('getRsvpTotals (core)', () => {
  it('counts guest rows by RSVP status across ACTIVE events only', async () => {
    const { client } = db();
    const s = await getRsvpTotals(client as unknown as AdminClient, 'today', NOW);
    expect(s).toEqual({
      activeEvents: 2,
      guestRows: 6,
      attending: 2,
      declined: 1,
      maybe: 1,
      pending: 2,
      responsesInRange: 1, // r1; r2 is before Israel midnight, r4 is a closed event
    });
    expect(s.attending + s.declined + s.maybe + s.pending).toBe(s.guestRows);
  });

  it('only responsesInRange depends on the range', async () => {
    const { client } = db();
    const s7 = await getRsvpTotals(client as unknown as AdminClient, '7d', NOW);
    expect(s7.responsesInRange).toBe(3); // r1, r2, r3
    expect(s7.guestRows).toBe(6);
    const s30 = await getRsvpTotals(client as unknown as AdminClient, '30d', NOW);
    expect(s30.responsesInRange).toBe(4); // + r5
  });

  it('every query is head-only; guests are filtered on the embedded event status and select no guest column but id', async () => {
    const { client, calls } = db();
    await getRsvpTotals(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(7);
    for (const c of calls) {
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    const guestCalls = calls.filter((c) => c.table === 'guests');
    expect(guestCalls).toHaveLength(5);
    for (const c of guestCalls) {
      expect(c.columns).toBe('id, events!inner(status)');
      expect(c.filters[0]).toEqual({ op: 'eq', args: ['events.status', 'active'] });
    }
    expect(calls.find((c) => c.table === 'rsvp_responses')?.filters).toEqual([
      { op: 'eq', args: ['events.status', 'active'] },
      { op: 'gte', args: ['created_at', '2026-09-17T22:30:00.000Z'] },
    ]);
  });

  it('result is numbers only — no guest name, phone, note or token', async () => {
    const { client } = db();
    const s = await getRsvpTotals(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
    const json = JSON.stringify(s);
    for (const leak of ['דנה', '+972', 'אלרגיה', 'tok-']) expect(json).not.toContain(leak);
  });

  it('carries no people sum until the aggregates migration is applied', async () => {
    const { client } = db();
    const s = await getRsvpTotals(client as unknown as AdminClient, '30d', NOW);
    expect(Object.keys(s)).not.toContain('invitedPeople');
    expect(Object.keys(s)).not.toContain('attendingPeople');
  });

  it('throws on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['guests'] });
    await expect(getRsvpTotals(client as unknown as AdminClient, 'today', NOW)).rejects.toThrow();
  });
});
