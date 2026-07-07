import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { EventDetail, EventListItem } from '@/lib/data/events';
import { OPERATIONAL_CAMPAIGN_STATUSES } from '@/lib/data/campaign-status';
import {
  assertEventNotPast,
  CELEBRANTS_LOCKED_ERROR,
  closeEvent,
  createEvent,
  EVENT_TYPE_LOCKED_ERROR,
  getEvent,
  isBeforeTomorrowIL,
  isPastEventDay,
  listEvents,
  publishEvent,
  todayIL,
  updateEvent,
  VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR,
} from '@/lib/data/events';

// S2.3 — relative-to-real-time date strings (Israel calendar day), reusing the
// SAME production helper the data-layer guards call (todayIL).
function ilDate(offsetDays: number): string {
  return todayIL(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
}
import { ensurePersonalOrg } from '@/lib/data/orgs';

// `events.ts` and `dal.ts` begin with `import 'server-only'`, which throws
// outside Next's React Server Component context. Vitest does not set that
// export condition, so stub it. Mocked here rather than in the shared config.
vi.mock('server-only', () => ({}));

// Factories are hoisted above imports; keep them free of outer references
// (bare vi.fn()), then configure resolved values in beforeEach.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
// createEvent now anchors the event to the caller's active org; stub the
// org-resolution helper so these tests stay focused on event ownership.
vi.mock('@/lib/data/orgs', () => ({ ensurePersonalOrg: vi.fn() }));

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
  'id, name, event_type, event_date, venue_name, venue_address, gift_payment_url, invite_image_path, rsvp_deadline, celebrants, show_meal_pref, status, created_at';

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
    celebrants: null,
    gift_payment_url: null,
    invite_image_path: null,
    show_meal_pref: true,
    status: 'draft',
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(mockUser());
  vi.mocked(ensurePersonalOrg).mockResolvedValue('org-1');
});

describe('listEvents', () => {
  it('relies on RLS for scoping — no app-side owner filter (org members see shared events)', async () => {
    const rows = [sampleRow()];
    const { client, builder } = createMockSupabase<EventListItem[]>({
      data: rows,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await listEvents();

    // Core ownership-scoping assertion: the query is filtered by the verified
    // user's id server-side, not by any browser-supplied identifier.
    expect(builder.eq).not.toHaveBeenCalledWith('owner_id', expect.anything());
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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    celebrants: null,
  };

  it('sets owner_id to the current user on insert', async () => {
    const { client, builder } = createMockSupabase<EventListItem>({
      data: sampleRow({ name: input.name }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(createEvent(input)).rejects.toThrow('יצירת האירוע נכשלה');
  });

  // S2.3 (round-3) — createEvent's own data-layer guard, mirroring R2 the same
  // way updateEvent's draft path does (isBeforeTomorrowIL). Defense-in-depth on
  // top of the DB trigger (events_before_insert) and the Zod refine (S2.2).
  it('allows event_date: null (a date-less draft)', async () => {
    const { client } = createMockSupabase<EventListItem>({
      data: sampleRow({ event_date: null }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      createEvent({ ...input, event_date: null }),
    ).resolves.toBeDefined();
  });

  it('rejects event_date: today, before touching the DB', async () => {
    const { client, builder } = createMockSupabase<EventListItem>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      createEvent({ ...input, event_date: ilDate(0) }),
    ).rejects.toThrow('מועד האירוע חייב להיות החל ממחר');
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('rejects event_date: yesterday', async () => {
    const { client } = createMockSupabase<EventListItem>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      createEvent({ ...input, event_date: ilDate(-1) }),
    ).rejects.toThrow('מועד האירוע חייב להיות החל ממחר');
  });

  it('allows event_date: tomorrow (the earliest legal date)', async () => {
    const { client } = createMockSupabase<EventListItem>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      createEvent({ ...input, event_date: ilDate(1) }),
    ).resolves.toBeDefined();
  });

  // Celebrants (בעלי שמחה) — pass-through of the caller's already-validated
  // shape (the action parsed it per event_type); the data layer never
  // reshapes it, it only writes the jsonb value (or SQL NULL) as given.
  it('passes celebrants through to the insert as-is', async () => {
    const { client, builder } = createMockSupabase<EventListItem>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await createEvent({ ...input, celebrants: { name: 'איתי' } });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ celebrants: { name: 'איתי' } }),
    );
  });

  it('writes celebrants: null (SQL NULL, never {}) when none were given', async () => {
    const { client, builder } = createMockSupabase<EventListItem>({
      data: sampleRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    await createEvent({ ...input, celebrants: null });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ celebrants: null }),
    );
  });
});

describe('getEvent', () => {
  it('fetches the detail DTO by id — visibility scoped by RLS, not an owner filter', async () => {
    const row = detailRow();
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });

    const result = await getEvent('event-1');

    expect(client.from).toHaveBeenCalledWith('events');
    expect(builder.select).toHaveBeenCalledWith(DETAIL_COLUMNS);
    expect(builder.eq).not.toHaveBeenCalledWith('owner_id', expect.anything());
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
    client.rpc.mockResolvedValue({ data: true, error: null });

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
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(getEvent('event-1')).rejects.toThrow('טעינת האירוע נכשלה');
  });
});

describe('updateEvent', () => {
  // S2.3 (round-2 design): event_date/rsvp_deadline are OPTIONAL keys — key
  // ABSENCE means "don't touch" (the only legal shape on a non-draft event);
  // key PRESENCE (even null) means "set/clear it" (legal only while draft).
  // `status` is no longer part of the input at all (publishEvent/closeEvent own
  // status transitions exclusively).
  const baseInput = {
    name: 'Renamed',
    event_type: 'birthday' as const,
    venue_name: 'Hall',
    venue_address: 'Haifa',
    celebrants: null,
  };

  // Sequences every awaited builder read in order. With baseInput's INCOMPLETE
  // celebrants (birthday + null) the celebrants lock adds a campaigns lookup
  // between the ownership read and the final update-select, so most tests pass
  // three results: ownership → campaigns (null = no operational campaign) → update.
  function mockReads<Row>(builder: ReturnType<typeof createMockSupabase<Row>>['builder'], ...results: unknown[]) {
    const spy = vi.spyOn(builder, 'then');
    for (const r of results) {
      spy.mockImplementationOnce((f) => (f as (v: unknown) => unknown)(r));
    }
  }
  const NO_LIVE_CAMPAIGN = { data: null, error: null };
  // The ownership read (requireEventAccess, which now selects event_type too)
  // supplies cur.event_type — the source for the event_type lock. Default it to
  // baseInput's type ('birthday') so a normal save shows no spurious "re-type".
  const owned = (over: Partial<EventDetail> = {}) => ({
    data: detailRow({ event_type: 'birthday', ...over }),
    error: null,
  });

  it('never writes a status key (status is owned exclusively by publishEvent/closeEvent)', async () => {
    const row = detailRow({ name: baseInput.name });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(builder, owned({ status: 'draft' }), NO_LIVE_CAMPAIGN, { data: row, error: null });

    await updateEvent('event-1', baseInput);

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('status');
  });

  it('on a non-draft event, with NEITHER date key present, omits both keys from the patch (not null)', async () => {
    const row = detailRow({ name: baseInput.name, status: 'active' });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(builder, owned({ status: 'active' }), NO_LIVE_CAMPAIGN, { data: row, error: null });

    await updateEvent('event-1', baseInput); // no event_date/rsvp_deadline key at all

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect('event_date' in patch).toBe(false);
    expect('rsvp_deadline' in patch).toBe(false);
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('owner_id');
    expect(builder.eq).toHaveBeenCalledWith('owner_id', USER_ID);
    expect(builder.eq).toHaveBeenCalledWith('id', 'event-1');
    expect(builder.select).toHaveBeenCalledWith(DETAIL_COLUMNS);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1', action: 'event.updated' }),
    );
  });

  it('on a non-draft event, an explicit date key present is a forged-request REJECT (no DB write)', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow({ status: 'active' }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: detailRow({ status: 'active' }), error: null }),
    );

    await expect(
      updateEvent('event-1', { ...baseInput, event_date: '2026-12-01' }),
    ).rejects.toThrow('לא ניתן לשנות מועד לאחר פרסום האירוע');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('on a draft event, a past/today event_date is rejected (R2 mirror)', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow({ status: 'draft' }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.spyOn(builder, 'then').mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: detailRow({ status: 'draft' }), error: null }),
    );

    await expect(
      updateEvent('event-1', { ...baseInput, event_date: ilDate(0) }),
    ).rejects.toThrow('מועד האירוע חייב להיות החל ממחר');
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('on a draft event, a present date key within bounds is included in the patch', async () => {
    const row = detailRow({ name: baseInput.name, event_date: ilDate(5) });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(builder, owned({ status: 'draft' }), NO_LIVE_CAMPAIGN, { data: row, error: null });

    await updateEvent('event-1', { ...baseInput, event_date: ilDate(5) });

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.event_date).toBe(ilDate(5));
  });

  // Celebrants are ALWAYS in the patch (the field group is always rendered and
  // posted) and are NOT date-locked — an active event's owner fills them here
  // before enabling a campaign. The action already reduced the submission to
  // the submitted type's shape (or null); the data layer writes it as-is.
  it('writes the given celebrants shape into the patch (any status)', async () => {
    const row = detailRow({ celebrants: { groom: 'יוסי', bride: 'דנה' } });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(builder, owned({ status: 'active' }), NO_LIVE_CAMPAIGN, { data: row, error: null });

    await updateEvent('event-1', {
      ...baseInput,
      celebrants: { groom: 'יוסי', bride: 'דנה' },
    });

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.celebrants).toEqual({ groom: 'יוסי', bride: 'דנה' });
  });

  it('writes celebrants: null (clearing the column) when the group was all-empty', async () => {
    const row = detailRow({ celebrants: null });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(builder, owned({ status: 'draft' }), NO_LIVE_CAMPAIGN, { data: row, error: null });

    await updateEvent('event-1', { ...baseInput, celebrants: null });

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect('celebrants' in patch).toBe(true);
    expect(patch.celebrants).toBeNull();
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
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(updateEvent('event-x', baseInput)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(builder.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('celebrants lock: incomplete celebrants are REJECTED while an operational campaign exists', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(
      builder,
      owned({ status: 'active' }),
      // the campaigns lookup finds an operational campaign
      { data: { id: 'c-live' }, error: null },
    );

    await expect(
      updateEvent('event-1', { ...baseInput, celebrants: null }),
    ).rejects.toThrow(CELEBRANTS_LOCKED_ERROR);
    expect(builder.update).not.toHaveBeenCalled();
    // The lock branch keys off the OPERATIONAL status set (SSOT), not neq-cancelled.
    expect(builder.in).toHaveBeenCalledWith('status', [...OPERATIONAL_CAMPAIGN_STATUSES]);
  });

  it('celebrants lock: a COMPLETE shape saves without ever querying campaigns', async () => {
    const row = detailRow({ celebrants: { name: 'איתי לוי' } });
    const { client, builder } = createMockSupabase<EventDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    // TWO reads: ownership → update-select. No lock condition trips (complete
    // celebrants, venue present, type unchanged via cur.event_type), so the
    // campaigns lookup is skipped entirely (baseInput.event_type=birthday).
    mockReads(builder, owned({ status: 'active' }), { data: row, error: null });

    await updateEvent('event-1', {
      ...baseInput,
      celebrants: { name: 'איתי לוי' },
    });

    expect(vi.mocked(client.from).mock.calls.flat()).not.toContain('campaigns');
    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.celebrants).toEqual({ name: 'איתי לוי' });
  });

  it('event_type lock: a type change is REJECTED while an operational campaign exists', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    // stored type (from the ownership read) differs from the submitted one →
    // typeChanged; the campaign lookup finds an operational campaign.
    mockReads(
      builder,
      owned({ status: 'active', event_type: 'bar_mitzvah' }),
      { data: { id: 'c-live' }, error: null },
    );

    await expect(
      updateEvent('event-1', { ...baseInput, event_type: 'birthday', celebrants: { name: 'רון' } }),
    ).rejects.toThrow(EVENT_TYPE_LOCKED_ERROR);
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('event_type change with no operational campaign is allowed (re-type stays possible pre-campaign)', async () => {
    const row = detailRow({ event_type: 'birthday' });
    const { client, builder } = createMockSupabase<EventDetail>({ data: row, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(
      builder,
      owned({ status: 'draft', event_type: 'bar_mitzvah' }),
      NO_LIVE_CAMPAIGN,
      { data: row, error: null },
    );

    await updateEvent('event-1', {
      ...baseInput,
      event_type: 'birthday',
      celebrants: { name: 'רון' },
    });

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.event_type).toBe('birthday');
  });

  it('venue lock: emptying venue_name is REJECTED while an operational campaign exists', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(
      builder,
      owned({ status: 'active' }),
      { data: { id: 'c-live' }, error: null },
    );

    await expect(
      updateEvent('event-1', { ...baseInput, venue_name: null, celebrants: { name: 'רון' } }),
    ).rejects.toThrow(VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR);
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('venue lock: changing venue_name to another non-empty value while live is allowed', async () => {
    const row = detailRow({ venue_name: 'אולם חדש' });
    const { client, builder } = createMockSupabase<EventDetail>({ data: row, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    // No lock condition trips (complete celebrants, venue present, type same) →
    // the campaign is never even queried; a legitimate edit is not blocked.
    mockReads(
      builder,
      owned({ status: 'active' }),
      { data: row, error: null },
    );

    await updateEvent('event-1', {
      ...baseInput,
      venue_name: 'אולם חדש',
      celebrants: { name: 'רון' },
    });

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.venue_name).toBe('אולם חדש');
    expect(vi.mocked(client.from).mock.calls.flat()).not.toContain('campaigns');
  });

  it('regression: an unrelated edit while live (complete celebrants, venue present) is NOT falsely blocked', async () => {
    const row = detailRow({ show_meal_pref: false });
    const { client, builder } = createMockSupabase<EventDetail>({ data: row, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    mockReads(
      builder,
      owned({ status: 'active' }),
      { data: row, error: null },
    );

    await updateEvent('event-1', {
      ...baseInput,
      celebrants: { name: 'רון' },
      show_meal_pref: false,
    });

    const patch = vi.mocked(builder.update).mock.calls[0][0] as Record<string, unknown>;
    expect(patch.show_meal_pref).toBe(false);
    expect(vi.mocked(client.from).mock.calls.flat()).not.toContain('campaigns');
  });
});

describe('publishEvent', () => {
  it('updates status only (no date keys in the patch)', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({
          data: detailRow({ status: 'draft', event_date: ilDate(5) }),
          error: null,
        }),
      )
      .mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: null, error: null }));

    await publishEvent('event-1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'active' });
    expect(builder.eq).toHaveBeenCalledWith('status', 'draft');
  });

  it('throws when event_date is null, before any update', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow({ status: 'draft', event_date: null }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(publishEvent('event-1')).rejects.toThrow(
      'יש להגדיר מועד עתידי לפני פרסום',
    );
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('throws when rsvp_deadline has elapsed (R2b re-check at publish time)', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: detailRow({
        status: 'draft',
        event_date: ilDate(5),
        rsvp_deadline: ilDate(-1),
      }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(publishEvent('event-1')).rejects.toThrow(
      'המועד האחרון לאישור הגעה כבר חלף',
    );
    expect(builder.update).not.toHaveBeenCalled();
  });
});

describe('closeEvent', () => {
  it('updates status to closed', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: detailRow({ status: 'active' }), error: null }),
      )
      .mockImplementationOnce((f) => (f as (v: unknown) => unknown)({ data: null, error: null }));

    await closeEvent('event-1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'closed' });
  });

  it('maps a DB raise (blocking campaign) to the Hebrew R7 message', async () => {
    const { client, builder } = createMockSupabase<EventDetail>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    client.rpc.mockResolvedValue({ data: true, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: detailRow({ status: 'active' }), error: null }),
      )
      .mockImplementationOnce((f) =>
        (f as (v: unknown) => unknown)({ data: null, error: { message: 'operational campaign(s)' } }),
      );

    await expect(closeEvent('event-1')).rejects.toThrow(
      'יש לסגור או לבטל את הקמפיין לפני סגירת האירוע',
    );
  });
});

// L1 — the single shared "past event" definition (calendar day in Asia/Jerusalem,
// matching the DB guard `(now() AT TIME ZONE 'Asia/Jerusalem')::date >
// (event_date AT TIME ZONE 'Asia/Jerusalem')::date`). An event is past ONLY after
// the end of its Israel calendar day; an event TODAY is still valid.
describe('isPastEventDay', () => {
  // 2026-06-23T08:00:00Z = 11:00 in Israel (UTC+3, summer) → today_IL = 2026-06-23.
  const NOW = Date.parse('2026-06-23T08:00:00Z');

  it('is false for an event later today (Israel)', () => {
    expect(isPastEventDay('2026-06-23T00:00:00+00:00', NOW)).toBe(false);
  });

  it('is true for an event whose Israel day is before today', () => {
    expect(isPastEventDay('2026-06-22T00:00:00+00:00', NOW)).toBe(true);
  });

  it('is false for a future event', () => {
    expect(isPastEventDay('2026-07-01T00:00:00+00:00', NOW)).toBe(false);
  });

  it('is false for a null event_date (matches the DB NULL semantics)', () => {
    expect(isPastEventDay(null, NOW)).toBe(false);
  });

  it('uses the Israel calendar boundary, not UTC: 22:00Z on the 22nd is the 23rd in Israel', () => {
    // 2026-06-22T22:00:00Z = 2026-06-23 01:00 in Israel → event day = 23rd =
    // today → NOT past. A naive UTC compare (event = 22nd < today 23rd) would
    // wrongly report past.
    expect(isPastEventDay('2026-06-22T22:00:00+00:00', NOW)).toBe(false);
  });
});

describe('assertEventNotPast', () => {
  const NOW = Date.parse('2026-06-23T08:00:00Z');

  it('throws a Hebrew error for a past event', () => {
    expect(() => assertEventNotPast('2026-06-22T00:00:00+00:00', NOW)).toThrow(
      'האירוע כבר חלף',
    );
  });

  it('does not throw for an event today', () => {
    expect(() => assertEventNotPast('2026-06-23T00:00:00+00:00', NOW)).not.toThrow();
  });

  it('does not throw for a null event_date', () => {
    expect(() => assertEventNotPast(null, NOW)).not.toThrow();
  });
});

// S2.1 — R2/R3's "event_date must be at least tomorrow" boundary. Reuses the
// same Israel-calendar-day rule as isPastEventDay, but the boundary is
// inclusive of TODAY (today is rejected, not just the past) — distinct from
// isPastEventDay, where today is still valid (an active event rides through
// its own day, R4).
describe('isBeforeTomorrowIL', () => {
  const NOW = Date.parse('2026-06-23T08:00:00Z'); // today_IL = 2026-06-23

  it('is true for an event today (must be rejected by R2/R3)', () => {
    expect(isBeforeTomorrowIL('2026-06-23T00:00:00+00:00', NOW)).toBe(true);
  });

  it('is true for an event in the past', () => {
    expect(isBeforeTomorrowIL('2026-06-22T00:00:00+00:00', NOW)).toBe(true);
  });

  it('is false for an event tomorrow (the earliest legal date)', () => {
    expect(isBeforeTomorrowIL('2026-06-24T00:00:00+00:00', NOW)).toBe(false);
  });

  it('is false for a null event_date (NULL never gates)', () => {
    expect(isBeforeTomorrowIL(null, NOW)).toBe(false);
  });
});
