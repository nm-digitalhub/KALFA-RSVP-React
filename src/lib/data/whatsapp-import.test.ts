import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsAppText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import {
  buildAmbiguousEventReply,
  buildSingleEventReply,
  contactsToStagedRows,
  eventImportLabel,
  parseCsvToStagedRows,
  resolveOwnerActiveEvents,
  stageWhatsAppImport,
} from './whatsapp-import';

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
  }) {
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

  it('reflects a customization change: when BOTH orgs grant the permission, BOTH events route', async () => {
    // Same shared role, same memberships — only the matrix differs from the
    // test above. Proves the composite key reads each org's ACTUAL matrix
    // rather than a hardcoded "org-b always denied".
    wireClient({ ownedEvents: [], eventsByOrg, grantedOrgIds: ['org-a', 'org-b'], memberships });

    const events = await resolveOwnerActiveEvents('+972501234567');
    expect(events.map((e) => e.id).sort()).toEqual(['evt-a', 'evt-b']);
  });
});

describe('stageWhatsAppImport', () => {
  it('ignores non-import message types without touching the DB', async () => {
    expect(await stageWhatsAppImport({ payload: { type: 'text', from: '972501111111' } as never })).toBe(false);
  });

  it('ignores an import from an UNKNOWN sender (no matching owner profile)', async () => {
    // Every query resolves to [] → no profile matches → not an import.
    const { client } = createMockSupabase<never[]>({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await stageWhatsAppImport({
      payload: { type: 'document', from: '972500000000', document: { id: 'm1', filename: 'x.csv' } } as never,
    });
    expect(res).toBe(false);
  });
});
