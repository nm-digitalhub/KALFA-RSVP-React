import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { createAdminClient } from '@/lib/supabase/admin';
import { isPastEventDay } from '@/lib/data/event-date';
import { createFakeCountClient, nonNumericLeaves } from '@/test/fake-count-client';
import { getEventsPipelineSummary } from './events';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25 (22:30Z on the 24th): the UTC date and the Israel
// date differ, so a UTC-midnight or slice(0,10) boundary shows up as a wrong
// count. Israel midnight today = 2026-09-24T21:00Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');

const name = 'החתונה של דנה ויוסי';
function db() {
  return createFakeCountClient({
    events: [
      // Israel day 25.9 (today) — 20:00 IDT
      { id: 'e1', name, status: 'active', event_type: 'wedding', event_date: '2026-09-25T17:00:00Z', created_at: '2026-09-24T21:30:00Z' },
      // Israel day 24.9 (yesterday) at 23:30 IDT — the UTC date is also 24.9
      { id: 'e2', name, status: 'active', event_type: 'wedding', event_date: '2026-09-24T20:30:00Z', created_at: '2026-09-10T10:00:00Z' },
      // Israel day 25.9 at 00:30 IDT, whose UTC date is 24.9 — today, not past
      { id: 'e3', name, status: 'active', event_type: 'brit', event_date: '2026-09-24T21:30:00Z', created_at: '2026-09-20T10:00:00Z' },
      // Israel day 1.10 (today + 6) — inside 7d
      { id: 'e4', name, status: 'active', event_type: 'bar_mitzvah', event_date: '2026-10-01T15:00:00Z', created_at: '2026-09-01T10:00:00Z' },
      // Israel day 2.10 (today + 7) — outside 7d, inside 30d
      { id: 'e5', name, status: 'active', event_type: 'henna', event_date: '2026-10-02T15:00:00Z', created_at: '2026-08-01T10:00:00Z' },
      { id: 'e6', name, status: 'active', event_type: 'other', event_date: null, created_at: '2026-09-24T20:00:00Z' },
      { id: 'e7', name, status: 'draft', event_type: 'wedding', event_date: '2026-09-26T15:00:00Z', created_at: '2026-09-24T22:00:00Z' },
      { id: 'e8', name, status: 'closed', event_type: 'birthday', event_date: '2026-09-01T15:00:00Z', created_at: '2026-08-01T10:00:00Z' },
    ],
  });
}

describe('getEventsPipelineSummary (core)', () => {
  it('counts current state by status and by type of active events', async () => {
    const { client } = db();
    const s = await getEventsPipelineSummary(client as unknown as AdminClient, 'today', NOW);
    expect(s.byStatus).toEqual({ draft: 1, active: 6, closed: 1 });
    expect(s.activeByType).toEqual({
      wedding: 2,
      bar_mitzvah: 1,
      bat_mitzvah: 0,
      brit: 1,
      britah: 0,
      henna: 1,
      engagement: 0,
      birthday: 0,
      other: 1,
    });
    expect(s.activeWithoutDate).toBe(1);
  });

  it('activePastDay matches isPastEventDay (Israel calendar day, not UTC)', async () => {
    const { client } = db();
    const s = await getEventsPipelineSummary(client as unknown as AdminClient, 'today', NOW);
    // e2 is past; e3 shares e2's UTC date but is TODAY in Israel.
    expect(isPastEventDay('2026-09-24T20:30:00Z', NOW)).toBe(true);
    expect(isPastEventDay('2026-09-24T21:30:00Z', NOW)).toBe(false);
    expect(s.activePastDay).toBe(1);
  });

  it('the forward window counts Israel days from today, today included', async () => {
    const { client } = db();
    const today = await getEventsPipelineSummary(client as unknown as AdminClient, 'today', NOW);
    expect(today.activeUpcomingInWindow).toBe(2); // e1, e3
    const week = await getEventsPipelineSummary(client as unknown as AdminClient, '7d', NOW);
    expect(week.activeUpcomingInWindow).toBe(3); // + e4 (today + 6); e5 is today + 7
    const month = await getEventsPipelineSummary(client as unknown as AdminClient, '30d', NOW);
    expect(month.activeUpcomingInWindow).toBe(4); // + e5; drafts never count
  });

  it('createdInRange looks backward from the range start', async () => {
    const { client } = db();
    const count = async (r: 'today' | '7d' | '30d') =>
      (await getEventsPipelineSummary(client as unknown as AdminClient, r, NOW)).createdInRange;
    expect(await count('today')).toBe(2); // e1 21:30Z, e7 22:00Z; e6 20:00Z is 23:00 on the 24th
    expect(await count('7d')).toBe(4); // + e3, e6
    expect(await count('30d')).toBe(6); // + e2, e4
  });

  it('every query is a head-only exact count; boundaries are Israel midnights', async () => {
    const { client, calls } = db();
    await getEventsPipelineSummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(16);
    for (const c of calls) {
      expect(c.table).toBe('events');
      expect(c.columns).toBe('id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
    }
    expect(calls).toContainEqual(
      expect.objectContaining({
        filters: [
          { op: 'eq', args: ['status', 'active'] },
          { op: 'gte', args: ['event_date', '2026-09-24T21:00:00.000Z'] },
          { op: 'lt', args: ['event_date', '2026-10-01T21:00:00.000Z'] },
        ],
      }),
    );
  });

  it('result is numbers only — no event name', async () => {
    const { client } = db();
    const s = await getEventsPipelineSummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('דנה');
  });

  it('throws on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['events'] });
    await expect(
      getEventsPipelineSummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow();
  });
});
