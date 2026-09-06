import { describe, expect, it } from 'vitest';

import { sortEventsForList, type SortableEvent } from './event-list-sort';

interface Row extends SortableEvent {
  id: string;
}

function row(id: string, over: Partial<SortableEvent> = {}): Row {
  return {
    id,
    status: 'active',
    event_date: null,
    created_at: '2026-01-01T00:00:00+00:00',
    ...over,
  };
}

const ids = (rows: readonly Row[]) => sortEventsForList(rows).map((r) => r.id);

describe('sortEventsForList', () => {
  it('groups draft before active before closed, whatever the input order', () => {
    const rows = [
      row('closed', { status: 'closed' }),
      row('active', { status: 'active' }),
      row('draft', { status: 'draft' }),
    ];
    expect(ids(rows)).toEqual(['draft', 'active', 'closed']);
  });

  it('orders by event_date ascending inside a group', () => {
    const rows = [
      row('march', { event_date: '2026-03-01T18:00:00+03:00' }),
      row('january', { event_date: '2026-01-01T18:00:00+02:00' }),
      row('february', { event_date: '2026-02-01T18:00:00+02:00' }),
    ];
    expect(ids(rows)).toEqual(['january', 'february', 'march']);
  });

  it('puts date-less events last inside their group', () => {
    const rows = [
      row('undated', { event_date: null }),
      row('dated', { event_date: '2026-05-01T18:00:00+03:00' }),
    ];
    expect(ids(rows)).toEqual(['dated', 'undated']);
  });

  // The case a "all null dates to the very end" comparator gets wrong: the
  // status group is the OUTER key, so a draft with no date still outranks a
  // dated active event.
  it('keeps an undated draft ahead of a dated active event', () => {
    const rows = [
      row('active-dated', { status: 'active', event_date: '2026-01-01T18:00:00+02:00' }),
      row('draft-undated', { status: 'draft', event_date: null }),
    ];
    expect(ids(rows)).toEqual(['draft-undated', 'active-dated']);
  });

  it('treats an unparseable event_date as no date rather than reordering randomly', () => {
    const rows = [
      row('broken', { event_date: 'not-a-date' }),
      row('dated', { event_date: '2026-05-01T18:00:00+03:00' }),
    ];
    expect(ids(rows)).toEqual(['dated', 'broken']);
  });

  it('breaks ties on created_at, newest first, in both input orders', () => {
    const older = row('older', { created_at: '2026-01-01T00:00:00+00:00' });
    const newer = row('newer', { created_at: '2026-02-01T00:00:00+00:00' });
    expect(ids([older, newer])).toEqual(['newer', 'older']);
    expect(ids([newer, older])).toEqual(['newer', 'older']);
  });

  it('compares instants, not strings, across UTC offsets', () => {
    // 21:00+03:00 is 18:00Z — EARLIER than 20:00Z, though its string sorts later.
    const rows = [
      row('later-utc', { event_date: '2026-04-01T20:00:00+00:00' }),
      row('earlier-offset', { event_date: '2026-04-01T21:00:00+03:00' }),
    ];
    expect(ids(rows)).toEqual(['earlier-offset', 'later-utc']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('b', { status: 'closed' }), row('a', { status: 'draft' })];
    const snapshot = [...rows];
    sortEventsForList(rows);
    expect(rows).toEqual(snapshot);
  });

  it('returns an empty array for an empty list', () => {
    expect(sortEventsForList([])).toEqual([]);
  });
});
