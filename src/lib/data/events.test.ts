import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { EventDetail, EventListItem } from '@/lib/data/events';
import { createEvent, getEvent, listEvents, updateEvent } from '@/lib/data/events';

// `events.ts` and `dal.ts` begin with `import 'server-only'`, which throws
// outside Next's React Server Component context. Vitest does not set that
// export condition, so stub it. Mocked here rather than in the shared config.
vi.mock('server-only', () => ({}));

// Factories are hoisted above imports; keep them free of outer references
// (bare vi.fn()), then configure resolved values in beforeEach.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

// notFound() (used by getEvent and the requireOwnedEvent gate) throws in real
// Next; outside an RSC request we stub it to a tagged error we can assert on.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// The exact column projection `events.ts` requests. This string IS the DTO
// contract — `listEvents` returns rows as-is (data ?? []), it does not map or
// transform — so asserting the select columns is what locks the DTO shape in.
const LIST_COLUMNS =
  'id, name, event_type, event_date, status, venue_name, created_at';

const DETAIL_COLUMNS =
  'id, name, event_type, event_date, venue_name, venue_address, rsvp_deadline, status, created_at';

const USER_ID = 'user-123';

function mockUser(): User {
  return { id: USER_ID } as unknown as User;
}

function sampleRow(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: 'event-1',
    name: 'Test Wedding',
    event_type: 'wedding',
    event_date: '2026-09-01',
    status: 'draft',
    venue_name: 'Test Venue',
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

function detailRow(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'event-1',
    name: 'Test Wedding',
    event_type: 'wedding',
    event_date: '2026-09-01T00:00:00+00:00',
    venue_name: 'Test Venue',
    venue_address: 'Tel Aviv',
    rsvp_deadline: '2026-08-15',
    status: 'draft',
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(mockUser());
});

describe('listEvents', () => {
  it('applies an explicit owner_id filter scoped to the current user', async () => {
    const rows = [sampleRow()];
    const { client, builder } = createMockSupabase<EventListItem[]>({
      data: rows,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listEvents();

    // Core ownership-scoping assertion: the query is filtered by the verified
    // user's id server-side, not by any browser-supplied identifier.
    expect(builder.eq).toHaveBeenCalledWith('owner_id', USER_ID);
    expect(client.from).toHaveBeenCalledWith('events');
  });

  it('requests exactly the DTO columns and returns the rows pass-through', async () => {
    const rows = [sampleRow(), sampleRow({ id: 'event-2', name: 'Second' })];
    const { client, builder } = createMockSupabase<EventListItem[]>({
      data: rows,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await listEvents();

    // The select column string is the DTO contract.
    expect(builder.select).toHaveBeenCalledWith(LIST_COLUMNS);
    // No transform: rows are returned as received.
    expect(result).toEqual(rows);
  });

  it('returns an empty array when the query yields no data', async () => {
    const { client } = createMockSupabase<EventListItem[]>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listEvents()).resolves.toEqual([]);
  });

  it('throws a safe error when the query fails', async () => {
    const { client } = createMockSupabase<EventListItem[]>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    // User-facing error must not leak the underlying DB message.
    await expect(listEvents()).rejects.toThrow('טעינת האירועים נכשלה');
  });
});

describe('createEvent', () => {
  const input = {
    name: 'New Event',
    event_type: 'birthday' as const,
    event_date: '2026-12-01',
    venue_name: 'Somewhere',
  };

  it('sets owner_id to the current user on insert', async () => {
    const { client, builder } = createMockSupabase<EventListItem>({
      data: sampleRow({ name: input.name }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await createEvent(input);

    // Ownership is assigned server-side from the verified user, including the
    // caller's input fields.
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ ...input, owner_id: USER_ID }),
    );
    expect(client.from).toHaveBeenCalledWith('events');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        action: 'event.created',
      }),
    );
  });

  it('returns the created row', async () => {
    const created = sampleRow({ name: input.name });
    const { client } = createMockSupabase<EventListItem>({
      data: created,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(createEvent(input)).resolves.toEqual(created);
  });

  it('throws a safe error when the insert fails', async () => {
    const { client } = createMockSupabase<EventListItem>({
      data: null,
      error: { message: 'insert failed' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(createEvent(input)).rejects.toThrow('יצירת האירוע נכשלה');
  });
});

describe('getEvent', () => {
  it('fetches the detail DTO scoped to the owner and event id', async () => {
    const row = detailRow();
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getEvent('event-1');

    expect(client.from).toHaveBeenCalledWith('events');
    expect(builder.select).toHaveBeenCalledWith(DETAIL_COLUMNS);
    expect(builder.eq).toHaveBeenCalledWith('owner_id', USER_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', 'event-1');
    expect(result).toEqual(row);
  });

  it('calls notFound() when the event is missing or not owned', async () => {
    const { client } = createMockSupabase<EventDetail>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getEvent('event-x')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('throws a safe error when the query fails', async () => {
    const { client } = createMockSupabase<EventDetail>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getEvent('event-1')).rejects.toThrow('טעינת האירוע נכשלה');
  });
});

describe('updateEvent', () => {
  const input = {
    name: 'Renamed',
    event_type: 'birthday' as const,
    event_date: '2026-12-01',
    venue_name: 'Hall',
    venue_address: 'Haifa',
    rsvp_deadline: '2026-11-20',
    status: 'active' as const,
  };

  it('updates only the allow-listed fields, scoped to owner + id, and logs', async () => {
    const row = detailRow({ name: input.name, status: 'active' });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await updateEvent('event-1', input);

    // The patch carries exactly the editable fields — never id/owner_id.
    expect(builder.update).toHaveBeenCalledWith(input);
    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('owner_id');
    // Update is scoped by the verified owner and the event id.
    expect(builder.eq).toHaveBeenCalledWith('owner_id', USER_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', 'event-1');
    expect(builder.select).toHaveBeenCalledWith(DETAIL_COLUMNS);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1', action: 'event.updated' }),
    );
    expect(result).toEqual(row);
  });

  it('refuses (via the ownership gate) and does not write when not owned', async () => {
    // requireOwnedEvent reads first; a null row triggers notFound() before any
    // update or activity write happens.
    const { client, builder } = createMockSupabase<EventDetail>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(updateEvent('event-x', input)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(builder.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
