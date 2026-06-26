import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import {
  GUEST_LIST_COLUMNS,
  GUEST_DETAIL_COLUMNS,
  GROUP_COLUMNS,
  listGuests,
  getGuest,
  createGuest,
  updateGuest,
  deleteGuest,
  updateContactStatus,
  bulkInsertGuests,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  type GuestListItem,
} from '@/lib/data/guests';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
// logActivity is best-effort and uses its own client; stub it so the guest
// tests assert only on the guest queries.
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

const USER_ID = 'user-123';
const EVENT_ID = 'event-1';
const GUEST_ID = 'guest-1';

function mockUser(): User {
  return { id: USER_ID } as unknown as User;
}

// requireOwnedEvent (in events.ts) calls requireUser + a maybeSingle() that
// must resolve to the owned event row, otherwise it triggers notFound(). The
// shared mock returns one result for the whole chain, but the ownership gate
// reads via `.maybeSingle()`, so we override that spy to always yield the owned
// event — the gate passes and the operation's own awaited result stands.
const OWNED_EVENT = {
  id: EVENT_ID,
  name: 'Wedding',
  status: 'active',
  event_date: null,
  rsvp_deadline: null,
};

type AnyBuilder = { maybeSingle: ReturnType<typeof vi.fn> };

function passGate(builder: AnyBuilder) {
  builder.maybeSingle.mockResolvedValue({ data: OWNED_EVENT, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(mockUser());
});

// ---------------------------------------------------------------------------
// SECURITY: rsvp_token / extras must never appear in any column projection.
// ---------------------------------------------------------------------------
describe('column secrecy (rsvp_token / extras)', () => {
  it('GUEST_LIST_COLUMNS excludes rsvp_token and extras', () => {
    expect(GUEST_LIST_COLUMNS).not.toContain('rsvp_token');
    expect(GUEST_LIST_COLUMNS).not.toContain('extras');
  });

  it('GUEST_DETAIL_COLUMNS excludes rsvp_token and extras', () => {
    expect(GUEST_DETAIL_COLUMNS).not.toContain('rsvp_token');
    expect(GUEST_DETAIL_COLUMNS).not.toContain('extras');
  });

  it('GROUP_COLUMNS excludes rsvp_token and extras', () => {
    expect(GROUP_COLUMNS).not.toContain('rsvp_token');
    expect(GROUP_COLUMNS).not.toContain('extras');
  });
});

describe('listGuests', () => {
  function wire(rows: GuestListItem[], count = rows.length) {
    const { client, builder } = createMockSupabase<GuestListItem[]>({
      data: rows,
      error: null,
      count,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    return { client, builder };
  }

  it('scopes the query to the event and requests the DTO columns with an exact count', async () => {
    const { client, builder } = wire([]);
    await listGuests(EVENT_ID, {});

    expect(client.from).toHaveBeenCalledWith('guests');
    expect(builder.select).toHaveBeenCalledWith(GUEST_LIST_COLUMNS, {
      count: 'exact',
    });
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
  });

  it('returns items, total, page and pageSize', async () => {
    const rows = [{ id: GUEST_ID } as GuestListItem];
    wire(rows, 42);
    const result = await listGuests(EVENT_ID, { page: 2 });
    expect(result.items).toEqual(rows);
    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBeGreaterThan(0);
  });

  // SECURITY: off-whitelist sort columns must never be passed raw.
  it('falls back to created_at desc for an unknown sort column', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { sort: 'rsvp_token); drop table guests;--' });
    expect(builder.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
  });

  it('maps the whitelisted sort key "name" to full_name', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { sort: 'name', dir: 'asc' });
    expect(builder.order).toHaveBeenCalledWith('full_name', {
      ascending: true,
    });
  });

  it('only ever passes asc/desc for direction (off-list dir => desc)', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { sort: 'name', dir: 'sideways' });
    expect(builder.order).toHaveBeenCalledWith('full_name', {
      ascending: false,
    });
  });

  // SECURITY: the search term must produce exactly two ilike clauses with no
  // injected condition, even when it contains PostgREST metacharacters.
  it('sanitises a search term into exactly two ilike clauses (no injection)', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { search: 'a,b)c*%"d' });

    expect(builder.or).toHaveBeenCalledTimes(1);
    const filter = builder.or.mock.calls[0][0] as string;
    // Metacharacters stripped -> "abcd"; wrapped in * for contains-match.
    expect(filter).toBe('full_name.ilike.*abcd*,phone.ilike.*abcd*');
    // No extra clause was injected: the two known clauses account for the only
    // commas in the string.
    expect(filter.split(',')).toHaveLength(2);
  });

  it('does not call .or when the sanitised search is empty', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { search: '(),*%' });
    expect(builder.or).not.toHaveBeenCalled();
  });

  // SECURITY: enum filters validate against the DB enum; invalid is ignored.
  it('applies a valid status filter', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { status: 'maybe' });
    expect(builder.eq).toHaveBeenCalledWith('status', 'maybe');
  });

  it('ignores an invalid status filter (not forwarded to the query)', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { status: 'bogus' });
    const statusCalls = builder.eq.mock.calls.filter((c) => c[0] === 'status');
    expect(statusCalls).toHaveLength(0);
  });

  it('applies a valid contact_status filter and ignores an invalid one', async () => {
    const { builder } = wire([]);
    await listGuests(EVENT_ID, { contactStatus: 'contacted' });
    expect(builder.eq).toHaveBeenCalledWith('contact_status', 'contacted');

    builder.eq.mockClear();
    await listGuests(EVENT_ID, { contactStatus: 'nope' });
    const calls = builder.eq.mock.calls.filter((c) => c[0] === 'contact_status');
    expect(calls).toHaveLength(0);
  });

  it('throws a safe error when the query fails', async () => {
    const { client, builder } = createMockSupabase<GuestListItem[]>({
      data: null,
      error: { message: 'db boom' },
      count: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await expect(listGuests(EVENT_ID, {})).rejects.toThrow(
      'טעינת המוזמנים נכשלה',
    );
  });
});

describe('getGuest', () => {
  it('scopes by both event_id and id and requests detail columns', async () => {
    const { client, builder } = createMockSupabase({
      data: { id: GUEST_ID },
      error: null,
    });
    // The gate uses maybeSingle (override), then getGuest's own maybeSingle
    // returns the same override — fine, the test asserts on spies, not value.
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await getGuest(EVENT_ID, GUEST_ID);
    expect(builder.select).toHaveBeenCalledWith(GUEST_DETAIL_COLUMNS);
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', GUEST_ID);
  });
});

describe('createGuest', () => {
  it('sets event_id from the gate and never sets rsvp_token', async () => {
    const { client, builder } = createMockSupabase({
      data: { id: GUEST_ID },
      error: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await createGuest(EVENT_ID, { full_name: 'דנה' });

    const payload = builder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event_id).toBe(EVENT_ID);
    expect(payload).not.toHaveProperty('rsvp_token');
    expect(payload).not.toHaveProperty('extras');
    expect(payload).not.toHaveProperty('id');
  });
});

describe('updateGuest', () => {
  it('scopes by event_id and id and cannot change event_id/rsvp_token/id', async () => {
    const { client, builder } = createMockSupabase({
      data: { id: GUEST_ID },
      error: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    // Cast through unknown: the smuggled keys are deliberately not on the type,
    // proving the function ignores them even if they reach it at runtime.
    await updateGuest(EVENT_ID, GUEST_ID, {
      full_name: 'חדש',
      event_id: 'other-event',
      rsvp_token: 'stolen',
      id: 'other-id',
    } as unknown as Parameters<typeof updateGuest>[2]);

    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ full_name: 'חדש' });
    expect(payload).not.toHaveProperty('event_id');
    expect(payload).not.toHaveProperty('rsvp_token');
    expect(payload).not.toHaveProperty('id');
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', GUEST_ID);
  });
});

describe('deleteGuest', () => {
  it('scopes the delete by event_id and id', async () => {
    const { client, builder } = createMockSupabase({ data: null, error: null });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await deleteGuest(EVENT_ID, GUEST_ID);
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', GUEST_ID);
  });
});

describe('updateContactStatus', () => {
  it('updates only contact_status, scoped to event_id and id', async () => {
    const { client, builder } = createMockSupabase({ data: null, error: null });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await updateContactStatus(EVENT_ID, GUEST_ID, 'contacted');
    expect(builder.update).toHaveBeenCalledWith({ contact_status: 'contacted' });
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', GUEST_ID);
  });
});

describe('bulkInsertGuests', () => {
  it('inserts in a single statement with event_id on every row and no rsvp_token', async () => {
    const { client, builder } = createMockSupabase<{ id: string }[]>({
      data: [{ id: 'g1' }, { id: 'g2' }],
      error: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const inserted = await bulkInsertGuests(EVENT_ID, [
      { full_name: 'א' },
      { full_name: 'ב' },
    ]);

    expect(inserted).toBe(2);
    expect(builder.insert).toHaveBeenCalledTimes(1);
    const rows = builder.insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.event_id).toBe(EVENT_ID);
      expect(r).not.toHaveProperty('rsvp_token');
      expect(r).not.toHaveProperty('extras');
    }
  });

  it('returns 0 and does not insert for an empty list', async () => {
    const { client, builder } = createMockSupabase({ data: [], error: null });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const inserted = await bulkInsertGuests(EVENT_ID, []);
    expect(inserted).toBe(0);
    expect(builder.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Guest groups (guest_groups) CRUD — all scoped to the owned event.
// ---------------------------------------------------------------------------
describe('listGroups', () => {
  it('queries guest_groups with GROUP_COLUMNS scoped to the event', async () => {
    const { client, builder } = createMockSupabase({
      data: [{ id: 'grp-1' }],
      error: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await listGroups(EVENT_ID);
    expect(client.from).toHaveBeenCalledWith('guest_groups');
    expect(builder.select).toHaveBeenCalledWith(GROUP_COLUMNS);
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
  });
});

describe('createGroup', () => {
  it('sets event_id from the gate on insert', async () => {
    const { client, builder } = createMockSupabase({
      data: { id: 'grp-1' },
      error: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await createGroup(EVENT_ID, { name: 'משפחה' });
    expect(client.from).toHaveBeenCalledWith('guest_groups');
    const payload = builder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event_id).toBe(EVENT_ID);
    expect(payload.name).toBe('משפחה');
    expect(payload).not.toHaveProperty('id');
  });
});

describe('updateGroup', () => {
  it('scopes the update by event_id and id and only sets provided fields', async () => {
    const { client, builder } = createMockSupabase({
      data: { id: 'grp-1' },
      error: null,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await updateGroup(EVENT_ID, 'grp-1', { name: 'חברים' });
    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ name: 'חברים' });
    expect(payload).not.toHaveProperty('event_id');
    expect(payload).not.toHaveProperty('id');
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', 'grp-1');
  });
});

describe('deleteGroup', () => {
  it('scopes the delete by event_id and id', async () => {
    const { client, builder } = createMockSupabase({ data: null, error: null });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await deleteGroup(EVENT_ID, 'grp-1');
    expect(client.from).toHaveBeenCalledWith('guest_groups');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', 'grp-1');
  });
});

// ---------------------------------------------------------------------------
// Ownership gate: when requireOwnedEvent triggers notFound() (mocked here as a
// thrown NEXT_NOT_FOUND), the guest query must NOT run.
// ---------------------------------------------------------------------------
describe('ownership gate', () => {
  it('does not query guests when the event is not owned', async () => {
    // The owned-event lookup returns null -> requireOwnedEvent calls notFound().
    const { client } = createMockSupabase({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listGuests(EVENT_ID, {})).rejects.toThrow();
    // `from` was called for the events ownership check, but never for guests.
    expect(client.from).toHaveBeenCalledWith('events');
    expect(client.from).not.toHaveBeenCalledWith('guests');
  });
});
