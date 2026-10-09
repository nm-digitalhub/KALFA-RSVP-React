import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/access-log', () => ({ recordStaffAccess: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { createAdminClient } from '@/lib/supabase/admin';
import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';

import { getEventForStaffView } from './event-view';

// The staff view of one event: its identity, and an OPAQUE link to its campaign. An event can have several campaigns - a cancelled one
// for every reset test run, at most one live, and a new one only while none is live - so "the campaign" is the NEWEST: the live one
// when there is one. The lookup must never fail, and never hide the link, because a second campaign exists. It reads the id and
// nothing else: 'view_events' buys the event's identity, not its campaign's status or money.

const EVENT = '33333333-3333-4333-8333-333333333333';
const eventRow: TableRow = {
  id: EVENT, name: 'החתונה של דנה', event_type: 'wedding', event_date: '2026-12-01T18:00:00Z', rsvp_deadline: null, status: 'active', venue_name: 'אולם', owner_id: 'owner-1',
};
const campaign = (id: string, status: string, created: string): TableRow => ({ id, event_id: EVENT, status, created_at: created });

function wire(campaigns: TableRow[]) {
  const db = createFakeTableClient({ events: [eventRow], campaigns });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as never);
});

describe('getEventForStaffView - the campaign link', () => {
  it('needs the view_events permission and records the access before it reads', async () => {
    wire([]);
    await getEventForStaffView(EVENT);
    expect(requirePlatformPermission).toHaveBeenCalledWith('view_events');
    expect(recordStaffAccess).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-1', permission: 'view_events', subjectId: EVENT }));
  });

  it('an event with no campaign has no link', async () => {
    wire([]);
    expect((await getEventForStaffView(EVENT)).campaignId).toBeNull();
  });

  it('one campaign: its id', async () => {
    wire([campaign('c1', 'approved', '2026-10-08T10:00:00+00:00')]);
    expect((await getEventForStaffView(EVENT)).campaignId).toBe('c1');
  });

  it('a cancelled campaign AND a live one: the link goes to the live one (the newer), whatever order the rows come in, and the lookup does not fail', async () => {
    wire([campaign('old', 'cancelled', '2026-10-08T08:00:00+00:00'), campaign('live', 'approved', '2026-10-08T10:00:00+00:00')]);
    expect((await getEventForStaffView(EVENT)).campaignId).toBe('live');
    wire([campaign('live', 'approved', '2026-10-08T10:00:00+00:00'), campaign('old', 'cancelled', '2026-10-08T08:00:00+00:00')]);
    expect((await getEventForStaffView(EVENT)).campaignId).toBe('live');
  });

  it('several cancelled campaigns and no live one: the newest, so the link is not lost', async () => {
    wire([campaign('first', 'cancelled', '2026-10-08T08:00:00+00:00'), campaign('second', 'cancelled', '2026-10-08T09:00:00+00:00')]);
    expect((await getEventForStaffView(EVENT)).campaignId).toBe('second');
  });

  it('asks for the id and NOTHING else - not the status, not the money - newest first, one row', async () => {
    const db = wire([campaign('c1', 'approved', '2026-10-08T10:00:00+00:00')]);
    await getEventForStaffView(EVENT);
    const read = db.ops.find((o) => o.table === 'campaigns');
    expect(read?.columns).toBe('id');
  });

  it('an unknown event is "not found", and nothing is audited', async () => {
    const db = createFakeTableClient({ events: [], campaigns: [] });
    vi.mocked(createAdminClient).mockReturnValue(db.client as never);
    await expect(getEventForStaffView(EVENT)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(recordStaffAccess).not.toHaveBeenCalled();
  });
});
