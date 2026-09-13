import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));
// The media path goes through the SDK. These spies are what let the tests below
// assert that the lookup is SCOPED to the number the message arrived at.
const retrieveMedia = vi.fn();
const fetchMedia = vi.fn();
vi.mock('whatsapp-api-js', () => ({
  WhatsAppAPI: vi.fn(function MockApi(this: Record<string, unknown>) {
    this.retrieveMedia = retrieveMedia;
    this.fetchMedia = fetchMedia;
  }),
}));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/whatsapp/client';
import { createMockSupabase } from '@/test/supabase-mock';
import type { WhatsAppChannel } from '@/lib/data/outreach-config';
import {
  buildAmbiguousEventReply,
  buildImportPointerReply,
  buildSingleEventReply,
  contactsToStagedRows,
  eventImportLabel,
  parseCsvToStagedRows,
  resolveOwnerActiveEvents,
  replyImportPointer,
  resolveReplyOrigin,
  stageWhatsAppImport,
} from './whatsapp-import';

// The channel as the router resolves it. LEGACY is how this ships: the
// `whatsapp_import_sender` role is unassigned, so importPhoneNumberId is null
// and the RSVP number both stages lists and answers them — today's behaviour.
// SPLIT is the state after the owner assigns the role.
const LEGACY: WhatsAppChannel = {
  phoneNumberId: 'p1',
  wabaId: null,
  accessToken: 't',
  appSecret: null,
  verifyToken: null,
  importPhoneNumberId: null,
  importDisplayNumber: null,
};
const SPLIT: WhatsAppChannel = {
  ...LEGACY,
  importPhoneNumberId: 'imp-1',
  importDisplayNumber: '+97233301505',
};

describe('contactsToStagedRows', () => {
  it('maps the REAL Cloud API contacts payload shape (name + first phone)', () => {
    const rows = contactsToStagedRows({
      contacts: [
        {
          name: { first_name: 'Jane', formatted_name: 'Jane Doe', last_name: 'Doe' },
          phones: [{ phone: '+972 50-123-4567', type: 'MOBILE', wa_id: '972501234567' }],
          vcard: '...',
        },
        { name: { formatted_name: 'בלי טלפון' }, phones: [] },
        { phones: [{ phone: '0521111111' }] }, // no name → skipped
      ],
    } as never);

    expect(rows).toEqual([
      { full_name: 'Jane Doe', phone: '0501234567', expected_count: null, group: '' },
      { full_name: 'בלי טלפון', phone: null, expected_count: null, group: '' },
    ]);
  });
});

describe('parseCsvToStagedRows', () => {
  it('parses with the shared header aliases, phone repair and per-row errors', () => {
    const csv = 'שם מלא,טלפון,כמות\nמשפחת כהן,501234567,4\nריק,12345,\n';
    const out = parseCsvToStagedRows(new TextEncoder().encode(csv));
    if ('error' in out) throw new Error('unexpected');
    expect(out.rows).toEqual([
      { full_name: 'משפחת כהן', phone: '0501234567', expected_count: 4, group: '' },
    ]);
    expect(out.errors).toHaveLength(1);
  });

  it('rejects an xlsx binary with a Hebrew instruction', () => {
    const out = parseCsvToStagedRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect('error' in out && out.error).toContain('CSV UTF-8');
  });
});

describe('eventImportLabel', () => {
  it('prefers the owner title, falls back to the Hebrew type label', () => {
    expect(eventImportLabel({ id: 'e1', name: 'החתונה שלנו', event_type: 'wedding' })).toBe('החתונה שלנו');
    expect(eventImportLabel({ id: 'e1', name: '   ', event_type: 'brit' })).toBe('ברית');
    expect(eventImportLabel({ id: 'e1', name: null, event_type: 'wedding' })).toBe('חתונה');
  });
});

describe('buildSingleEventReply', () => {
  it('names the target event and links to its review screen', () => {
    const body = buildSingleEventReply(
      { id: 'abc', name: 'ברית של נועם', event_type: 'brit' },
      40,
      2,
      'https://beta.kalfa.me',
    );
    expect(body).toContain('ברית של נועם');
    expect(body).toContain('40');
    expect(body).toContain('2 עם שגיאות');
    expect(body).toContain('https://beta.kalfa.me/app/events/abc/guests/import/whatsapp');
  });

  it('omits the error clause when there are no row errors', () => {
    const body = buildSingleEventReply({ id: 'abc', name: 'x', event_type: 'brit' }, 5, 0, 'https://beta.kalfa.me');
    expect(body).not.toMatch(/שגיא/);
  });
});

describe('buildAmbiguousEventReply', () => {
  it('lists EVERY active event with its own import link and picks none', () => {
    const body = buildAmbiguousEventReply(
      [
        { id: 'a', name: 'ברית', event_type: 'brit' },
        { id: 'b', name: null, event_type: 'wedding' },
      ],
      'https://beta.kalfa.me',
    );
    // both events named (second via the type-label fallback)
    expect(body).toContain('ברית');
    expect(body).toContain('חתונה');
    // one distinct import link per event, and NOT a whatsapp review link
    expect(body).toContain('https://beta.kalfa.me/app/events/a/guests/import');
    expect(body).toContain('https://beta.kalfa.me/app/events/b/guests/import');
    expect(body).not.toContain('/guests/import/whatsapp');
  });
});

// Phase 2 regression: permissions moved from a single global `role_permissions`
// table to a per-(organization_id, role_id) `organization_role_permissions`
// table. The OLD code built one global `Set<role_id>` of "roles that may
// guests.create" and tested `okRoles.has(role_id)` alone — safe only while a
// role id meant the same thing everywhere. These tests drive
// resolveOwnerActiveEvents() with a sender who shares the SAME global role
// (`role-member`) across TWO different orgs, one of which has customized
// guests.create OFF for that role — a single-org test cannot catch a
// regression back to the global-set bug (it would still pass).
describe('resolveOwnerActiveEvents — per-org composite key (Phase 2 regression)', () => {
  type EventLike = { id: string; name: string | null; event_type: string; created_at: string };

  // Builds a from()-router double: `profiles` resolves the sender, `events` is
  // stateful per call (owned-by-owner_id vs shared-by-org_id, since the module
  // queries the SAME table twice with different filters), `organization_members`
  // resolves the sender's memberships, and `organization_role_permissions`
  // resolves ONLY the tuples in `grantedOrgIds` — modeling an owner having
  // customized one org's matrix without touching the other's.
  function wireClient(opts: {
    ownedEvents: EventLike[];
    eventsByOrg: Record<string, EventLike[]>;
    grantedOrgIds: string[];
    memberships: { organization_id: string; role_id: string }[];
    // guest_import_staging double: which inbound wamids were ALREADY staged
    // (source_message_id lookup) + a spy on insert.
    stagedWamids?: string[];
    stagingInsert?: ReturnType<typeof vi.fn>;
  }) {
    const from = vi.fn((table: string) => {
      if (table === 'guest_import_staging') {
        const state: { wamid: string | null } = { wamid: null };
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            if (col === 'source_message_id') state.wamid = val;
            return builder;
          }),
          maybeSingle: vi.fn(async () => ({
            data:
              state.wamid && (opts.stagedWamids ?? []).includes(state.wamid)
                ? { id: 'staging-existing' }
                : null,
            error: null,
          })),
          insert: opts.stagingInsert ?? vi.fn(async () => ({ error: null })),
          then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }),
        };
        return builder;
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          then: (ok: (v: unknown) => unknown) =>
            ok({ data: [{ id: 'user-1', phone: '0501234567' }], error: null }),
        };
      }
      if (table === 'events') {
        const state: { mode: 'owned' | 'shared' | null; orgIds: string[] } = {
          mode: null,
          orgIds: [],
        };
        const builder: Record<string, unknown> = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string) => {
            if (col === 'owner_id') state.mode = 'owned';
            return builder;
          }),
          in: vi.fn((col: string, vals: string[]) => {
            if (col === 'org_id') {
              state.mode = 'shared';
              state.orgIds = vals;
            }
            return builder;
          }),
          then: (ok: (v: unknown) => unknown) => {
            if (state.mode === 'owned') return ok({ data: opts.ownedEvents, error: null });
            if (state.mode === 'shared') {
              const rows = state.orgIds.flatMap((id) => opts.eventsByOrg[id] ?? []);
              return ok({ data: rows, error: null });
            }
            return ok({ data: [], error: null });
          },
        };
        return builder;
      }
      if (table === 'organization_members') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (ok: (v: unknown) => unknown) => ok({ data: opts.memberships, error: null }),
        };
      }
      if (table === 'organization_role_permissions') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (ok: (v: unknown) => unknown) => {
            const rows = opts.memberships
              .filter((m) => opts.grantedOrgIds.includes(m.organization_id))
              .map((m) => ({
                organization_id: m.organization_id,
                role_id: m.role_id,
                permission_definitions: { resource: 'guests', action: 'create' },
              }));
            return ok({ data: rows, error: null });
          },
        };
      }
      throw new Error(`unexpected table in resolveOwnerActiveEvents test: ${table}`);
    });
    vi.mocked(createAdminClient).mockReturnValue(
      { from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
    );
  }

  const memberships = [
    { organization_id: 'org-a', role_id: 'role-member' },
    { organization_id: 'org-b', role_id: 'role-member' },
  ];
  const eventsByOrg = {
    'org-a': [{ id: 'evt-a', name: 'A', event_type: 'wedding', created_at: '2026-01-01T00:00:00Z' }],
    'org-b': [{ id: 'evt-b', name: 'B', event_type: 'wedding', created_at: '2026-01-02T00:00:00Z' }],
  };

  it('routes each org independently: org-b customized guests.create OFF for the shared role', async () => {
    wireClient({ ownedEvents: [], eventsByOrg, grantedOrgIds: ['org-a'], memberships });

    const events = await resolveOwnerActiveEvents('+972501234567');
    expect(events.map((e) => e.id)).toEqual(['evt-a']);
  });

  it('stageWhatsAppImport is idempotent by inbound wamid: an already-staged message is a no-op (no insert, no reply)', async () => {
    const stagingInsert = vi.fn(async () => ({ error: null }));
    wireClient({
      ownedEvents: [{ id: 'evt-a', name: 'A', event_type: 'wedding', created_at: '2026-01-01T00:00:00Z' }],
      eventsByOrg: {},
      grantedOrgIds: [],
      memberships: [],
      stagedWamids: ['wamid.already'],
      stagingInsert,
    });
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';

    const consumed = await stageWhatsAppImport(
      {
        phone_number_id: 'p1',
        payload: {
          id: 'wamid.already',
          type: 'contacts',
          from: '972501234567',
          contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972501234567' }] }],
        } as never,
      },
      LEGACY,
    );

    expect(consumed).toBe(true);
    expect(stagingInsert).not.toHaveBeenCalled();
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('stageWhatsAppImport stamps the inbound wamid on the staged list (source_message_id)', async () => {
    const stagingInsert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    wireClient({
      ownedEvents: [{ id: 'evt-a', name: 'A', event_type: 'wedding', created_at: '2026-01-01T00:00:00Z' }],
      eventsByOrg: {},
      grantedOrgIds: [],
      memberships: [],
      stagedWamids: [],
      stagingInsert,
    });
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';

    await stageWhatsAppImport(
      {
        phone_number_id: 'p1',
        payload: {
          id: 'wamid.fresh',
          type: 'contacts',
          from: '972501234567',
          contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972501234567' }] }],
        } as never,
      },
      LEGACY,
    );

    expect(stagingInsert).toHaveBeenCalledTimes(1);
    expect(stagingInsert.mock.calls[0][0]).toMatchObject({
      event_id: 'evt-a',
      source: 'whatsapp_contacts',
      source_message_id: 'wamid.fresh',
      row_count: 1,
    });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it('reflects a customization change: when BOTH orgs grant the permission, BOTH events route', async () => {
    // Same shared role, same memberships — only the matrix differs from the
    // test above. Proves the composite key reads each org's ACTUAL matrix
    // rather than a hardcoded "org-b always denied".
    wireClient({ ownedEvents: [], eventsByOrg, grantedOrgIds: ['org-a', 'org-b'], memberships });

    const events = await resolveOwnerActiveEvents('+972501234567');
    expect(events.map((e) => e.id).sort()).toEqual(['evt-a', 'evt-b']);
  });
});

describe('resolveReplyOrigin', () => {
  const stub = (value: string | undefined) => {
    if (value === undefined) vi.stubEnv('APP_ORIGIN', '');
    else vi.stubEnv('APP_ORIGIN', value);
  };
  afterEach(() => vi.unstubAllEnvs());

  it('sanitizes an inline comment/whitespace out of the env value (live incident)', () => {
    stub('https://example.org # production origin');
    expect(resolveReplyOrigin()).toBe('https://example.org');
  });

  it('throws (no hardcoded fallback) when APP_ORIGIN is unset — Phase 0 #1', () => {
    stub(undefined);
    expect(() => resolveReplyOrigin()).toThrow(/APP_ORIGIN/);
  });
});

describe('stageWhatsAppImport', () => {
  it('ignores non-import message types without touching the DB', async () => {
    expect(
      await stageWhatsAppImport(
        { phone_number_id: 'p1', payload: { type: 'text', from: '972501111111' } as never },
        LEGACY,
      ),
    ).toBe(false);
  });

  it('ignores an import from an UNKNOWN sender (no matching owner profile)', async () => {
    // Every query resolves to [] → no profile matches → not an import.
    const { client } = createMockSupabase<never[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await stageWhatsAppImport(
      {
        phone_number_id: 'p1',
        payload: { type: 'document', from: '972500000000', document: { id: 'm1', filename: 'x.csv' } } as never,
      },
      LEGACY,
    );
    expect(res).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The two-number split. These cover the two things the split has to guarantee:
// the import module never stages a list that arrived somewhere else, and the
// reply leaves from the number that received it.

// One verified owner with exactly ONE active event and an empty staging table —
// the minimum for a reply to be composed. A standalone double (the router
// double above is scoped to its own describe).
function wireOneOwner(stagingInsert = vi.fn(async () => ({ error: null }))) {
  const from = vi.fn((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        then: (ok: (v: unknown) => unknown) =>
          ok({ data: [{ id: 'user-1', phone: '0501234567' }], error: null }),
      };
    }
    if (table === 'events') {
      const state: { owned: boolean } = { owned: false };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        eq: vi.fn((col: string) => {
          if (col === 'owner_id') state.owned = true;
          return builder;
        }),
        in: vi.fn(() => builder),
        then: (ok: (v: unknown) => unknown) =>
          ok({
            data: state.owned
              ? [{ id: 'evt-a', name: 'A', event_type: 'wedding', created_at: '2026-01-01T00:00:00Z' }]
              : [],
            error: null,
          }),
      };
      return builder;
    }
    if (table === 'organization_members' || table === 'organization_role_permissions') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }),
      };
    }
    if (table === 'guest_import_staging') {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        insert: stagingInsert,
        then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }),
      };
      return builder;
    }
    throw new Error(`unexpected table in split test: ${table}`);
  });
  vi.mocked(createAdminClient).mockReturnValue(
    { from, rpc: vi.fn() } as unknown as ReturnType<typeof createAdminClient>,
  );
  return stagingInsert;
}

beforeEach(() => vi.clearAllMocks());
describe('buildImportPointerReply', () => {
  it('names the import number and its wa.me link', () => {
    const body = buildImportPointerReply('+97233301505');
    expect(body).toContain('+97233301505');
    expect(body).toContain('https://wa.me/97233301505');
  });

  it('null when no display number is known — nothing useful to say', () => {
    expect(buildImportPointerReply(null)).toBeNull();
  });

  it('still names the number when it does not normalize, just without a link', () => {
    const body = buildImportPointerReply('not-a-number');
    expect(body).toContain('not-a-number');
    expect(body).not.toContain('wa.me');
  });
});

describe('stageWhatsAppImport — the self-guard under the split', () => {
  it('refuses a list that arrived on ANY number other than the import number', async () => {
    // No DB double is wired: reaching the database at all would fail this test,
    // which is the point — the guard fires before resolveOwnerActiveEvents.
    vi.mocked(createAdminClient).mockReturnValue(
      undefined as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await stageWhatsAppImport(
      {
        phone_number_id: 'p1', // the RSVP number
        payload: {
          id: 'wamid.x',
          type: 'contacts',
          from: '972501234567',
          contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972501234567' }] }],
        } as never,
      },
      SPLIT,
    );
    expect(res).toBe(false);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('answers from the IMPORT number when the list arrived there', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';

    await stageWhatsAppImport(
      {
        phone_number_id: 'imp-1',
        payload: {
          id: 'wamid.imp',
          type: 'contacts',
          from: '972501234567',
          contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972501234567' }] }],
        } as never,
      },
      SPLIT,
    );

    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][0]).toMatchObject({
      phoneNumberId: 'imp-1',
      accessToken: 't',
    });
  });

  it('legacy (role unassigned): the reply still leaves from the RSVP number', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';

    await stageWhatsAppImport(
      {
        phone_number_id: 'p1',
        payload: {
          id: 'wamid.leg',
          type: 'contacts',
          from: '972501234567',
          contacts: [{ name: { formatted_name: 'Jane Doe' }, phones: [{ phone: '+972501234567' }] }],
        } as never,
      },
      LEGACY,
    );

    expect(vi.mocked(sendWhatsAppText).mock.calls[0][0]).toMatchObject({
      phoneNumberId: 'p1',
    });
  });
});

describe('replyImportPointer — a list sent to the RSVP number under the split', () => {
  it('points a VERIFIED owner at the import number, from the RSVP number, and stages nothing', async () => {
    const stagingInsert = wireOneOwner();

    const res = await replyImportPointer(
      {
        phone_number_id: 'p1',
        payload: {
          id: 'wamid.p',
          type: 'document',
          from: '972501234567',
          document: { id: 'm1', filename: 'guests.csv' },
        } as never,
      },
      SPLIT,
    );

    expect(res).toBe(true);
    expect(stagingInsert).not.toHaveBeenCalled();
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const [sender, message] = vi.mocked(sendWhatsAppText).mock.calls[0];
    expect(sender).toMatchObject({ phoneNumberId: 'p1' });
    expect(message.body).toContain('+97233301505');
  });

  it('says nothing to a stranger (same rule as staging) and does not consume the row', async () => {
    const { client } = createMockSupabase<never[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await replyImportPointer(
      {
        phone_number_id: 'p1',
        payload: {
          type: 'document',
          from: '972500000000',
          document: { id: 'm1', filename: 'x.csv' },
        } as never,
      },
      SPLIT,
    );
    expect(res).toBe(false);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('ignores a non-import message entirely (plain text is not a list)', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      undefined as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await replyImportPointer(
      { phone_number_id: 'p1', payload: { type: 'text', from: '972501234567' } as never },
      SPLIT,
    );
    expect(res).toBe(false);
  });
});

describe('downloadDocument — scoped to the number that received the file', () => {
  const CSV = 'full_name,phone\nדנה כהן,0501234567\n';

  function docRow(phoneNumberId: string | null) {
    return {
      phone_number_id: phoneNumberId,
      payload: {
        id: 'wamid.doc',
        type: 'document',
        from: '972501234567',
        document: { id: 'media-1', filename: 'guests.csv' },
      } as never,
    };
  }

  it('passes the row’s phone_number_id to retrieveMedia (a foreign media id cannot be read)', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';
    retrieveMedia.mockResolvedValue({ url: 'https://cdn/x', file_size: '42' });
    fetchMedia.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(CSV).buffer,
    });

    await stageWhatsAppImport(docRow('imp-1'), SPLIT);

    expect(retrieveMedia).toHaveBeenCalledWith('media-1', 'imp-1');
    expect(fetchMedia).toHaveBeenCalledWith('https://cdn/x');
  });

  it('refuses a file Meta reports as larger than the 1MB cap — without fetching it', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';
    retrieveMedia.mockResolvedValue({ url: 'https://cdn/big', file_size: '2000000' });

    await stageWhatsAppImport(docRow('p1'), LEGACY);

    expect(fetchMedia).not.toHaveBeenCalled();
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1].body).toContain('עד 1MB');
  });

  it('refuses a body that exceeds the cap even when file_size lied', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';
    retrieveMedia.mockResolvedValue({ url: 'https://cdn/lie', file_size: '10' });
    fetchMedia.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array(1_000_001).buffer,
    });

    await stageWhatsAppImport(docRow('p1'), LEGACY);

    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1].body).toContain('עד 1MB');
  });

  it('an error response (no url) is a failed read, not a crash', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';
    retrieveMedia.mockResolvedValue({ error: { message: 'Unsupported get request', code: 100 } });

    await stageWhatsAppImport(docRow('p1'), LEGACY);

    expect(fetchMedia).not.toHaveBeenCalled();
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1].body).toContain('עד 1MB');
  });

  it('a timeout (aborted fetch) is a failed read, not a thrown row', async () => {
    wireOneOwner();
    process.env.APP_ORIGIN = 'https://beta.kalfa.me';
    retrieveMedia.mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));

    await expect(stageWhatsAppImport(docRow('p1'), LEGACY)).resolves.toBe(true);
    expect(vi.mocked(sendWhatsAppText).mock.calls[0][1].body).toContain('עד 1MB');
  });
});
