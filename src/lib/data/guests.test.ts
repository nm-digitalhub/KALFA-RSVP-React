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
  computeImportMatches,
  type GuestListItem,
} from '@/lib/data/guests';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
// logActivity is best-effort and uses its own client; stub it so the guest
// tests assert only on the guest queries.
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
import { logActivity } from '@/lib/data/activity';

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
    client.rpc.mockResolvedValue({ data: true, error: null });
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

  it('returns mapped items, total, page and pageSize', async () => {
    // A guest with no contact: op_status/removal/delivery flatten to null and
    // NO batched delivery query runs (contactIds is empty).
    const rows = [{ id: GUEST_ID, contact_id: null, contacts: null }];
    const { builder } = createMockSupabase({
      data: rows,
      error: null,
      count: 42,
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue({
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: true, error: null })),
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await listGuests(EVENT_ID, { page: 2 });
    expect(result.items).toEqual([
      {
        id: GUEST_ID,
        contact_id: null,
        over_invited: false,
        op_status: null,
        removal_requested: null,
        delivery_status: null,
      },
    ]);
    // No delivery lookup for a page with no linked contacts.
    expect(builder.in).not.toHaveBeenCalled();
    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBeGreaterThan(0);
  });

  // B6: op_status/removal flatten from the embed; delivery_status is the LATEST
  // per-CONTACT outbound state, fetched in ONE batched query (no N+1). Two guests
  // sharing a contact get the same delivery; a contactless guest gets null.
  it('merges the latest delivery status per contact in a single batched query', async () => {
    const guestRows = [
      {
        id: 'g1',
        contact_id: 'c1',
        contacts: { op_status: 'reached_billed', removal_requested: false },
      },
      {
        id: 'g2',
        contact_id: 'c1',
        contacts: { op_status: 'reached_billed', removal_requested: false },
      },
      { id: 'g3', contact_id: null, contacts: null },
    ];
    // c1 has two deliveries; the newer ('read') must win over the older ('sent').
    const interactionRows = [
      { contact_id: 'c1', delivery_status: 'read', created_at: '2026-06-30T10:00:00Z' },
      { contact_id: 'c1', delivery_status: 'sent', created_at: '2026-06-30T09:00:00Z' },
    ];

    const guests = createMockSupabase({
      data: guestRows,
      error: null,
      count: guestRows.length,
    });
    const interactions = createMockSupabase({
      data: interactionRows,
      error: null,
      count: interactionRows.length,
    });
    passGate(guests.builder);

    // Dispatch by table: the ownership gate + guest list hit the guests builder;
    // the delivery lookup hits the contact_interactions builder.
    guests.client.from.mockImplementation((table: string) =>
      table === 'contact_interactions' ? interactions.builder : guests.builder,
    );
    vi.mocked(createClient).mockResolvedValue(
      guests.client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    guests.client.rpc.mockResolvedValue({ data: true, error: null });

    const result = await listGuests(EVENT_ID, {});

    // ONE batched query keyed on the DEDUPED contact_ids — never per-guest.
    expect(interactions.builder.in).toHaveBeenCalledTimes(1);
    expect(interactions.builder.in).toHaveBeenCalledWith('contact_id', ['c1']);

    const byId = new Map(result.items.map((i) => [i.id, i]));
    // Latest delivery ('read') applies to both guests sharing c1.
    expect(byId.get('g1')?.delivery_status).toBe('read');
    expect(byId.get('g2')?.delivery_status).toBe('read');
    // op_status/removal flattened from the embed.
    expect(byId.get('g1')?.op_status).toBe('reached_billed');
    expect(byId.get('g1')?.removal_requested).toBe(false);
    // Contactless guest: no delivery, no op_status.
    expect(byId.get('g3')?.delivery_status).toBeNull();
    expect(byId.get('g3')?.op_status).toBeNull();
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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });

    await createGuest(EVENT_ID, { full_name: 'דנה' });

    const payload = builder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event_id).toBe(EVENT_ID);
    expect(payload).not.toHaveProperty('rsvp_token');
    expect(payload).not.toHaveProperty('extras');
    expect(payload).not.toHaveProperty('id');
  });

  it('maps a 23505 on guests_event_phone_key to the friendly phone-taken error', async () => {
    const { client, builder } = createMockSupabase({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "guests_event_phone_key"',
      },
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      createGuest(EVENT_ID, { full_name: 'דנה', phone: '0501234567' }),
    ).rejects.toThrow('מספר הטלפון כבר קיים אצל מוזמן אחר באירוע');
  });

  it('keeps the generic failure message for non-unique-violation errors', async () => {
    const { client, builder } = createMockSupabase({
      data: null,
      error: { message: 'connection reset' },
    });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      createGuest(EVENT_ID, { full_name: 'דנה' }),
    ).rejects.toThrow('יצירת המוזמן נכשלה');
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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });
    await deleteGuest(EVENT_ID, GUEST_ID);
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', GUEST_ID);
  });
});

describe('updateContactStatus', () => {
  function mockAllowedWrite() {
    const { client, builder } = createMockSupabase({ data: null, error: null });
    passGate(builder);
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    return { client, builder };
  }

  it('owner may update contact_status (can_access_event allows guests.edit)', async () => {
    const { client, builder } = mockAllowedWrite();

    await updateContactStatus(EVENT_ID, GUEST_ID, 'contacted');

    expect(builder.update).toHaveBeenCalledWith({ contact_status: 'contacted' });
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', GUEST_ID);
    expect(client.rpc).toHaveBeenCalledWith('can_access_event', {
      _event_id: EVENT_ID,
      _resource: 'guests',
      _action: 'edit',
    });
  });

  it('org member with guests.edit may update contact_status', async () => {
    // At the app boundary both owner (owner_id bypass) and a delegated member
    // surface as can_access_event(..., 'guests', 'edit') = true — the gate is
    // requireEventAccess, not requireOwnedEvent.
    const { client, builder } = mockAllowedWrite();

    await updateContactStatus(EVENT_ID, GUEST_ID, 'unavailable');

    expect(builder.update).toHaveBeenCalledWith({ contact_status: 'unavailable' });
    expect(client.rpc).toHaveBeenCalledWith('can_access_event', {
      _event_id: EVENT_ID,
      _resource: 'guests',
      _action: 'edit',
    });
  });

  it('viewer without guests.edit is rejected (404) before any write', async () => {
    const { client, builder } = createMockSupabase({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: OWNED_EVENT, error: null }),
    );
    client.rpc.mockResolvedValue({ data: false, error: null });

    await expect(
      updateContactStatus(EVENT_ID, GUEST_ID, 'contacted'),
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(builder.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('can_access_event', {
      _event_id: EVENT_ID,
      _resource: 'guests',
      _action: 'edit',
    });
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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });
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
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(listGuests(EVENT_ID, {})).rejects.toThrow();
    // `from` was called for the events ownership check, but never for guests.
    expect(client.from).toHaveBeenCalledWith('events');
    expect(client.from).not.toHaveBeenCalledWith('guests');
  });
});

describe('computeImportMatches', () => {
  const existing = [
    // phone-less, ASCII apostrophe name → a name-merge target
    {
      id: 'g1',
      full_name: "ג'קלין ושלמה טויטו",
      phone: null,
      expected_count: null,
      group_name: null,
    },
    // has a phone, short name, in a group → a phone-merge target
    {
      id: 'g2',
      full_name: 'זהבה',
      phone: '0501112222',
      expected_count: null,
      group_name: 'משפחה',
    },
  ];

  it('name-match: a phoned row ↔ a phone-less existing guest (geresh vs apostrophe)', () => {
    const rows = [
      { full_name: 'ג׳קלין ושלמה טויטו', phone: '0529466618', group: '', expected_count: null },
    ];
    const m = computeImportMatches(existing, rows);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      direction: 'name',
      rowIndex: 0,
      existingGuestId: 'g1',
      addsPhone: '0529466618',
    });
    // names normalize-equal → no full_name field diff offered
    expect(m[0].fields).toEqual([]);
  });

  it('phone-match: same phone, fuller name + new count → phone direction with field diffs', () => {
    const rows = [
      { full_name: 'זהבה טויטו', phone: '050-111-2222', group: '', expected_count: 4 },
    ];
    const m = computeImportMatches(existing, rows);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ direction: 'phone', existingGuestId: 'g2', addsPhone: null });
    const byField = Object.fromEntries(m[0].fields.map((f) => [f.field, f]));
    // existing name non-empty & differs → overwrite (default OFF)
    expect(byField.full_name).toMatchObject({ incoming: 'זהבה טויטו', existing: 'זהבה', fill: false });
    // existing count empty → fill (default ON)
    expect(byField.expected_count).toMatchObject({ incoming: '4', existing: '', fill: true });
    // incoming group empty → hidden
    expect(byField.group).toBeUndefined();
  });

  it('hides fields that are equal or whose incoming value is empty', () => {
    const rows = [
      { full_name: 'זהבה', phone: '0501112222', group: 'משפחה', expected_count: null },
    ];
    const m = computeImportMatches(existing, rows);
    expect(m[0].direction).toBe('phone');
    expect(m[0].fields).toEqual([]);
  });

  it('phone identity beats name, and each existing guest is claimed once', () => {
    const rows = [
      { full_name: 'זהבה', phone: '0501112222', group: '', expected_count: null },
      { full_name: 'זהבה', phone: '0501112222', group: '', expected_count: null },
    ];
    const m = computeImportMatches(existing, rows);
    expect(m).toHaveLength(1);
    expect(m[0].existingGuestId).toBe('g2');
    expect(m[0].rowIndex).toBe(0);
  });
});
