import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  findEventsForSupport,
  getEventForSupportView,
  listGuestsForSupportView,
} from './support';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const VALID_REASON = 'פנייה בנושא הזמנה מספר 1234 — בירור סטטוס';

function staffUser(): User {
  return { id: 'staff-1' } as unknown as User;
}

const EVENT_ROW = {
  id: EVENT_ID,
  name: 'חתונה של דנה ויוסי',
  event_type: 'wedding' as const,
  event_date: '2026-08-01T18:00:00+03:00',
  venue_name: 'אולם הגן',
  venue_address: 'רחוב הפרחים 1',
  celebrants: { groom: 'יוסי', bride: 'דנה' },
  status: 'active' as const,
  owner_id: 'owner-1',
};

// Wires createAdminClient() to route .from(table) to a per-table builder, plus
// auth.admin.getUserById for the owner email. Each builder resolves to its own
// configured result so events/profiles/support_access_log/guests can differ
// within the same test.
type Result = { data: unknown; error: { message: string } | null };

function wireAdminClient(opts: {
  events?: Result;
  profiles?: Result;
  logInsert?: Result;
  guests?: Result;
  authUser?: { data: unknown; error: unknown };
}) {
  const events = createMockSupabase(opts.events ?? { data: EVENT_ROW, error: null });
  const profiles = createMockSupabase(
    opts.profiles ?? { data: { full_name: 'דנה כהן', phone: '0501234567' }, error: null },
  );
  const logTable = createMockSupabase(opts.logInsert ?? { data: null, error: null });
  const guests = createMockSupabase(opts.guests ?? { data: [], error: null });

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'events') return events.builder;
      if (table === 'profiles') return profiles.builder;
      if (table === 'support_access_log') return logTable.builder;
      if (table === 'guests') return guests.builder;
      throw new Error(`unexpected table in test: ${table}`);
    }),
    auth: {
      admin: {
        getUserById: vi.fn(
          async () =>
            opts.authUser ?? { data: { user: { email: 'dana@example.com' } }, error: null },
        ),
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  };

  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );

  return { events, profiles, logTable, guests, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(staffUser());
});

describe('gate ordering — every reader calls requirePlatformPermission first', () => {
  it('getEventForSupportView: a rejected gate throws before any read', async () => {
    const { events } = wireAdminClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(
      getEventForSupportView(EVENT_ID, 'פנייה בנושא הזמנה מספר 1234'),
    ).rejects.toThrow('redirect');

    expect(events.client.from).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('listGuestsForSupportView: a rejected gate throws before any read', async () => {
    const { guests } = wireAdminClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(listGuestsForSupportView(EVENT_ID)).rejects.toThrow('redirect');
    expect(guests.client.from).not.toHaveBeenCalled();
  });

  it('findEventsForSupport: a rejected gate throws before any read', async () => {
    const { events } = wireAdminClient({});
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('redirect'));

    await expect(findEventsForSupport({ eventId: EVENT_ID }, VALID_REASON)).rejects.toThrow(
      'redirect',
    );
    expect(events.client.from).not.toHaveBeenCalled();
  });
});

describe('required break-glass reason', () => {
  it('rejects a blank reason — no read, no log', async () => {
    const { events, logTable } = wireAdminClient({});

    await expect(getEventForSupportView(EVENT_ID, '')).rejects.toThrow('סיבה');

    expect(events.client.from).not.toHaveBeenCalled();
    expect(logTable.builder.insert).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('rejects a too-short reason — no read, no log', async () => {
    const { events, logTable } = wireAdminClient({});

    await expect(getEventForSupportView(EVENT_ID, 'קצר')).rejects.toThrow('סיבה');

    expect(events.client.from).not.toHaveBeenCalled();
    expect(logTable.builder.insert).not.toHaveBeenCalled();
  });
});

describe('happy path', () => {
  it('reads the event, writes exactly one audit row, logs activity + a Slack alert', async () => {
    const { logTable } = wireAdminClient({});

    const result = await getEventForSupportView(
      EVENT_ID,
      'פנייה בנושא הזמנה מספר 1234 — בירור סטטוס',
    );

    expect(result.id).toBe(EVENT_ID);
    expect(result.name).toBe('חתונה של דנה ויוסי');
    expect(result.owner.fullName).toBe('דנה כהן');
    expect(result.owner.email).toBe('dana@example.com');

    expect(logTable.builder.insert).toHaveBeenCalledTimes(1);
    expect(logTable.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        staff_id: 'staff-1',
        event_id: EVENT_ID,
        owner_id: 'owner-1',
        reason: 'פנייה בנושא הזמנה מספר 1234 — בירור סטטוס',
      }),
    );

    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.support.event_viewed', eventId: EVENT_ID }),
    );

    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        category: 'security',
        title: 'צפיית תמיכה בנתוני לקוח',
        fields: { staffId: 'staff-1', eventId: EVENT_ID },
      }),
    );
  });

  it('fails closed if the audit insert errors — no data is returned', async () => {
    wireAdminClient({ logInsert: { data: null, error: { message: 'insert failed' } } });

    await expect(
      getEventForSupportView(EVENT_ID, 'פנייה בנושא הזמנה מספר 1234'),
    ).rejects.toThrow('רישום הביקורת נכשל');

    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('listGuestsForSupportView returns support-relevant fields only', async () => {
    wireAdminClient({
      guests: {
        data: [
          {
            id: 'g1',
            full_name: 'אורח א',
            phone: '0501112222',
            status: 'attending',
            confirmed_adults: 2,
            confirmed_kids: 1,
            rsvp_note: 'ללא גלוטן',
            meal_pref: 'צמחוני',
          },
        ],
        error: null,
      },
    });

    const guests = await listGuestsForSupportView(EVENT_ID);
    expect(guests).toEqual([
      expect.objectContaining({
        id: 'g1',
        fullName: 'אורח א',
        phone: '0501112222',
        status: 'attending',
        statusLabel: 'מגיע',
        confirmedAdults: 2,
        confirmedKids: 1,
        rsvpNote: 'ללא גלוטן',
        mealPref: 'צמחוני',
      }),
    ]);
  });
});

describe('read-only proof — no mutation on customer tables', () => {
  it('getEventForSupportView never calls update/insert/delete on events, profiles, or guests', async () => {
    const { events, profiles, guests } = wireAdminClient({});

    await getEventForSupportView(EVENT_ID, 'פנייה בנושא הזמנה מספר 1234');

    for (const b of [events.builder, profiles.builder, guests.builder]) {
      expect(b.update).not.toHaveBeenCalled();
      expect(b.insert).not.toHaveBeenCalled();
      expect(b.delete).not.toHaveBeenCalled();
    }
  });

  it('listGuestsForSupportView never calls update/insert/delete on guests', async () => {
    const { guests } = wireAdminClient({});

    await listGuestsForSupportView(EVENT_ID);

    expect(guests.builder.update).not.toHaveBeenCalled();
    expect(guests.builder.insert).not.toHaveBeenCalled();
    expect(guests.builder.delete).not.toHaveBeenCalled();
  });

  it('findEventsForSupport never calls update/insert/delete on events or profiles', async () => {
    const { events, profiles } = wireAdminClient({});

    await findEventsForSupport({ eventId: EVENT_ID }, VALID_REASON);

    for (const b of [events.builder, profiles.builder]) {
      expect(b.update).not.toHaveBeenCalled();
      expect(b.insert).not.toHaveBeenCalled();
      expect(b.delete).not.toHaveBeenCalled();
    }
  });
});

// The lookup surfaces customer PII (event + owner name) and can enumerate real
// customers, so it is reason-gated + audited exactly like a view.
describe('findEventsForSupport — reason required + audited', () => {
  it('rejects a blank reason — no read, no audit', async () => {
    const { events, logTable } = wireAdminClient({});

    await expect(findEventsForSupport({ eventId: EVENT_ID }, '')).rejects.toThrow('סיבה');

    expect(events.client.from).not.toHaveBeenCalled();
    expect(logTable.builder.insert).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('rejects a too-short reason — no read, no audit', async () => {
    const { events, logTable } = wireAdminClient({});

    await expect(findEventsForSupport({ eventId: EVENT_ID }, 'קצר')).rejects.toThrow('סיבה');

    expect(events.client.from).not.toHaveBeenCalled();
    expect(logTable.builder.insert).not.toHaveBeenCalled();
  });

  it('writes one audit row per matched event on a successful lookup', async () => {
    const { logTable } = wireAdminClient({
      events: {
        data: { id: EVENT_ID, name: 'האירוע', event_date: '2026-09-01', owner_id: 'owner-1' },
        error: null,
      },
      profiles: { data: { full_name: 'בעל האירוע' }, error: null },
    });

    const results = await findEventsForSupport({ eventId: EVENT_ID }, VALID_REASON);

    expect(results).toEqual([
      { id: EVENT_ID, name: 'האירוע', eventDate: '2026-09-01', ownerFullName: 'בעל האירוע' },
    ]);
    expect(logTable.builder.insert).toHaveBeenCalledTimes(1);
    expect(logTable.builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        staff_id: 'staff-1',
        event_id: EVENT_ID,
        owner_id: 'owner-1',
        reason: VALID_REASON,
      }),
    ]);
    // Structured activity entry carries counts/ids only — never the raw contact.
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.support.search' }),
    );
    const activityCall = vi.mocked(logActivity).mock.calls[0]?.[0];
    expect(JSON.stringify(activityCall)).not.toContain('בעל האירוע');
    // Slack alert is ids/counts only.
    const slackCall = vi.mocked(sendSlackAlert).mock.calls[0]?.[0];
    expect(JSON.stringify(slackCall)).not.toContain('בעל האירוע');
  });

  it('logs a zero-result probe (activity) but writes no audit row', async () => {
    const { logTable } = wireAdminClient({
      events: { data: null, error: null },
    });

    const results = await findEventsForSupport({ eventId: EVENT_ID }, VALID_REASON);

    expect(results).toEqual([]);
    expect(logTable.builder.insert).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.support.search',
        meta: expect.objectContaining({ resultCount: 0 }),
      }),
    );
  });
});
