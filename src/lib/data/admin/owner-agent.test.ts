// The owner-agent data layer: who may touch it (the platform owner, and nobody else
// whatever permissions they hold), what it refuses to store, and what it refuses to
// let out — a raw phone number, or any column that could carry question text.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { requirePlatformOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import {
  OWNER_AGENT_AUDIT_COLUMNS,
  addOwnerAgentAllowlistEntry,
  getOwnerAgentSettings,
  listOwnerAgentAllowlist,
  listOwnerAgentAudit,
  listOwnerAgentNumbers,
  listOwnerAgentStaff,
  relabelOwnerAgentAllowlistEntry,
  removeOwnerAgentAllowlistEntry,
  setOwnerAgentAllowlistEnabled,
  setOwnerAgentDailyCap,
  setOwnerAgentEnabled,
  setOwnerAgentPhoneNumber,
} from './owner-agent';

// Real v4 UUIDs — Zod 4's z.uuid() rejects the all-ones placeholder shape.
const OWNER_ID = '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';
const STAFF_ID = '0b7e1f2a-3c4d-4e5f-9a6b-7c8d9e0f1a2b';
const OTHER_STAFF_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ENTRY_ID = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';

const OWNER_PHONE = '+972501234567';
const STAFF_PHONE = '+972521112233';
const WABA_REF = '1234567890123456';

type Result = QueryResult<unknown>;
type Builder = ReturnType<typeof createMockSupabase>['builder'];

/** A client whose from(table) answers per table; unknown tables answer `{ data: null }`. */
function routedClient(tables: Record<string, Result>) {
  const builders: Record<string, Builder> = {};
  for (const [table, result] of Object.entries(tables)) {
    builders[table] = createMockSupabase(result as never).builder;
  }
  const fallback = createMockSupabase({ data: null, error: null } as never).builder;
  const from = vi.fn((table: string) => builders[table] ?? fallback);
  return { client: { from, rpc: vi.fn() }, builders, from };
}

function wireCookie(tables: Record<string, Result>) {
  const wired = routedClient(tables);
  vi.mocked(createClient).mockResolvedValue(wired.client as never);
  return wired;
}

function wireAdmin(tables: Record<string, Result>) {
  const wired = routedClient(tables);
  vi.mocked(createAdminClient).mockReturnValue(wired.client as never);
  return wired;
}

// platform_staff (with its platform_roles embed) is read through the owner's session;
// only profiles needs service role. Kept as two maps so each test wires them to the
// client that must serve them — a read on the wrong client then finds no table.
const STAFF_ROWS = {
  platform_staff: {
    data: [
      { user_id: OWNER_ID, platform_roles: { label: 'בעלים', is_owner_role: true } },
      { user_id: STAFF_ID, platform_roles: { label: 'תפעול', is_owner_role: false } },
    ],
    error: null,
  },
};

const PROFILE_ROWS = {
  profiles: {
    data: [
      { id: OWNER_ID, full_name: 'בעל המערכת', phone_verified_e164: OWNER_PHONE },
      // Staff member whose verified phone differs from the one on the allow-list.
      { id: STAFF_ID, full_name: null, phone_verified_e164: '+972539998877' },
    ],
    error: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformOwner).mockResolvedValue({ id: OWNER_ID } as User);
  vi.mocked(logActivity).mockResolvedValue(undefined);
});

describe('the owner gate', () => {
  // requirePlatformOwner REDIRECTS a non-owner — it throws. Every export must reach it
  // before creating a client, so a refused caller costs no query at all.
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['getOwnerAgentSettings', () => getOwnerAgentSettings()],
    ['listOwnerAgentNumbers', () => listOwnerAgentNumbers()],
    ['listOwnerAgentStaff', () => listOwnerAgentStaff()],
    ['listOwnerAgentAllowlist', () => listOwnerAgentAllowlist()],
    ['listOwnerAgentAudit', () => listOwnerAgentAudit()],
    ['setOwnerAgentEnabled', () => setOwnerAgentEnabled(true)],
    ['setOwnerAgentPhoneNumber', () => setOwnerAgentPhoneNumber(WABA_REF)],
    ['setOwnerAgentDailyCap', () => setOwnerAgentDailyCap(10)],
    [
      'addOwnerAgentAllowlistEntry',
      () => addOwnerAgentAllowlistEntry({ e164: OWNER_PHONE, staffUserId: OWNER_ID, label: '' }),
    ],
    ['setOwnerAgentAllowlistEnabled', () => setOwnerAgentAllowlistEnabled(ENTRY_ID, false)],
    ['relabelOwnerAgentAllowlistEntry', () => relabelOwnerAgentAllowlistEntry(ENTRY_ID, 'x')],
    ['removeOwnerAgentAllowlistEntry', () => removeOwnerAgentAllowlistEntry(ENTRY_ID)],
  ];

  for (const [name, call] of calls) {
    it(`${name} refuses a non-owner before touching the database`, async () => {
      vi.mocked(requirePlatformOwner).mockRejectedValue(new Error('NEXT_REDIRECT'));
      await expect(call()).rejects.toThrow('NEXT_REDIRECT');
      expect(createClient).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(logActivity).not.toHaveBeenCalled();
    });
  }
});

describe('reads', () => {
  it('getOwnerAgentSettings maps the three app_settings columns', async () => {
    const { builders } = wireCookie({
      app_settings: {
        data: {
          owner_agent_enabled: true,
          owner_agent_phone_number_id: WABA_REF,
          owner_agent_daily_cap: 25,
        },
        error: null,
      },
    });
    await expect(getOwnerAgentSettings()).resolves.toEqual({
      enabled: true,
      phoneNumberId: WABA_REF,
      dailyCap: 25,
    });
    expect(builders.app_settings.select).toHaveBeenCalledWith(
      'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap',
    );
  });

  it('getOwnerAgentSettings throws a Hebrew message on a failed read, never the driver error', async () => {
    wireCookie({ app_settings: { data: null, error: { message: 'relation does not exist' } } });
    await expect(getOwnerAgentSettings()).rejects.toThrow('טעינת הגדרות הסוכן נכשלה');
  });

  it('lists EVERY Meta number — guest-serving and inactive included — masked, with roles', async () => {
    const { builders } = wireCookie({
      provider_numbers: {
        data: [
          {
            provider_ref: WABA_REF,
            e164: '+97233301505',
            display_label: 'אישורי הגעה',
            is_active: true,
            provider_number_roles: [{ role: 'whatsapp_rsvp_sender' }],
          },
          {
            provider_ref: '6543210987654321',
            e164: '+97233301506',
            display_label: null,
            is_active: false,
            provider_number_roles: [],
          },
        ],
        error: null,
      },
    });

    const numbers = await listOwnerAgentNumbers();

    expect(builders.provider_numbers.eq).toHaveBeenCalledWith('provider', 'meta_whatsapp');
    expect(numbers).toEqual([
      {
        providerRef: WABA_REF,
        label: 'אישורי הגעה',
        maskedNumber: '033***1505',
        isActive: true,
        roles: ['whatsapp_rsvp_sender'],
      },
      {
        providerRef: '6543210987654321',
        label: null,
        maskedNumber: '033***1506',
        isActive: false,
        roles: [],
      },
    ]);
    expect(JSON.stringify(numbers)).not.toContain('+972');
  });

  it('flags the allow-list row whose number equals the staff member\'s VERIFIED phone', async () => {
    wireCookie({
      owner_agent_allowlist: {
        data: [
          {
            id: ENTRY_ID,
            e164: OWNER_PHONE,
            staff_user_id: OWNER_ID,
            enabled: true,
            label: 'נייד',
            created_at: '2026-09-24T08:00:00Z',
          },
          {
            id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f',
            e164: STAFF_PHONE,
            staff_user_id: STAFF_ID,
            enabled: false,
            label: null,
            created_at: '2026-09-24T09:00:00Z',
          },
          {
            // A row whose staff member has since left (read defensively).
            id: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a',
            e164: '+972541234567',
            staff_user_id: OTHER_STAFF_ID,
            enabled: true,
            label: null,
            created_at: '2026-09-24T10:00:00Z',
          },
        ],
        error: null,
      },
      ...STAFF_ROWS,
    });
    wireAdmin(PROFILE_ROWS);

    const entries = await listOwnerAgentAllowlist();

    expect(entries.map((e) => [e.verifiedMatch, e.isStaff])).toEqual([
      [true, true],
      [false, true], // verified phone is a different number
      [false, false], // no longer staff
    ]);
    expect(entries[0]).toMatchObject({ maskedNumber: '050***4567', staffName: 'בעל המערכת' });
    // Neither the listed number nor the verified phone crosses to the page.
    const json = JSON.stringify(entries);
    expect(json).not.toContain(OWNER_PHONE);
    expect(json).not.toContain(STAFF_PHONE);
    expect(json).not.toContain('+972539998877');
  });

  it('reads the allow-list and platform_staff through the session; only profiles via service role', async () => {
    const cookie = wireCookie({ owner_agent_allowlist: { data: [], error: null }, ...STAFF_ROWS });
    const admin = wireAdmin(PROFILE_ROWS);
    await listOwnerAgentAllowlist();
    expect(cookie.from).toHaveBeenCalledWith('owner_agent_allowlist');
    expect(cookie.from).toHaveBeenCalledWith('platform_staff');
    // Least privilege: service role touches profiles and nothing else.
    expect(admin.from.mock.calls.map((c) => c[0])).toEqual(['profiles']);
  });

  it('lists every staff member for the picker, with a verified-phone BOOLEAN only', async () => {
    wireCookie(STAFF_ROWS);
    wireAdmin(PROFILE_ROWS);
    const staff = await listOwnerAgentStaff();
    expect(staff).toEqual([
      { userId: OWNER_ID, name: 'בעל המערכת', roleLabel: 'בעלים', isOwnerRole: true, hasVerifiedPhone: true },
      { userId: STAFF_ID, name: null, roleLabel: 'תפעול', isOwnerRole: false, hasVerifiedPhone: true },
    ]);
    expect(JSON.stringify(staff)).not.toContain('+972');
  });

  it('audit rows: an explicit ids-and-codes column list, newest first, never message_text', async () => {
    const { builders, from } = wireCookie({
      owner_agent_audit: {
        data: [
          {
            id: ENTRY_ID,
            occurred_at: '2026-09-24T08:00:00Z',
            staff_user_id: OWNER_ID,
            stage: 'route',
            outcome: 'gated',
            reason_code: 'kill_switch_off',
            tool_names: null,
            steps: null,
            latency_ms: null,
          },
        ],
        error: null,
      },
    });

    const rows = await listOwnerAgentAudit();

    const selected = builders.owner_agent_audit.select.mock.calls[0][0] as string;
    expect(selected).toBe(OWNER_AGENT_AUDIT_COLUMNS);
    expect(selected).not.toContain('message_text');
    expect(selected).not.toContain('*');
    // The one table holding question text is never read by this screen.
    expect(from).not.toHaveBeenCalledWith('owner_agent_intake');
    expect(builders.owner_agent_audit.order).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(builders.owner_agent_audit.limit).toHaveBeenCalledWith(50);
    expect(rows[0]).toMatchObject({ outcome: 'gated', reasonCode: 'kill_switch_off', toolNames: [] });
  });

  it('the audit column constant itself carries no text-bearing column', () => {
    expect(OWNER_AGENT_AUDIT_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'id',
      'occurred_at',
      'staff_user_id',
      'stage',
      'outcome',
      'reason_code',
      'tool_names',
      'steps',
      'latency_ms',
    ]);
  });
});

describe('app_settings writes', () => {
  it('setOwnerAgentEnabled writes the switch and records it', async () => {
    const { builders } = wireCookie({ app_settings: { data: null, error: null } });
    await setOwnerAgentEnabled(true);
    expect(builders.app_settings.update).toHaveBeenCalledWith({ owner_agent_enabled: true });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.enabled_set',
      meta: { enabled: true },
    });
  });

  it('refuses a number that is not one of our WABA numbers, and writes nothing', async () => {
    const { builders } = wireCookie({
      provider_numbers: { data: null, error: null }, // lookup found no such provider_ref
      app_settings: { data: null, error: null },
    });
    await expect(setOwnerAgentPhoneNumber('9999999999999999')).rejects.toThrow(
      'המספר שנבחר אינו מספר WhatsApp מחובר',
    );
    expect(builders.provider_numbers.eq).toHaveBeenCalledWith('provider', 'meta_whatsapp');
    expect(builders.provider_numbers.eq).toHaveBeenCalledWith('provider_ref', '9999999999999999');
    expect(builders.app_settings.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('stores a number that IS on the WABA, including a guest-serving one', async () => {
    const { builders } = wireCookie({
      provider_numbers: { data: { provider_ref: WABA_REF }, error: null },
      app_settings: { data: null, error: null },
    });
    await setOwnerAgentPhoneNumber(WABA_REF);
    expect(builders.app_settings.update).toHaveBeenCalledWith({
      owner_agent_phone_number_id: WABA_REF,
    });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.number_set',
      meta: { phoneNumberId: WABA_REF },
    });
  });

  it('"none" stores null without a lookup', async () => {
    const { builders, from } = wireCookie({ app_settings: { data: null, error: null } });
    await setOwnerAgentPhoneNumber(null);
    expect(from).not.toHaveBeenCalledWith('provider_numbers');
    expect(builders.app_settings.update).toHaveBeenCalledWith({ owner_agent_phone_number_id: null });
  });

  it('refuses an E.164 pasted where the Meta id belongs, before any query', async () => {
    const { from } = wireCookie({});
    await expect(setOwnerAgentPhoneNumber('+972501234567')).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it.each([-1, 10001, 1.5])('refuses a daily cap of %s', async (cap) => {
    const { from } = wireCookie({});
    await expect(setOwnerAgentDailyCap(cap)).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it('accepts 0 and 10000 as the bounds of the table CHECK', async () => {
    const { builders } = wireCookie({ app_settings: { data: null, error: null } });
    await setOwnerAgentDailyCap(0);
    await setOwnerAgentDailyCap(10000);
    expect(builders.app_settings.update).toHaveBeenCalledWith({ owner_agent_daily_cap: 0 });
    expect(builders.app_settings.update).toHaveBeenCalledWith({ owner_agent_daily_cap: 10000 });
  });
});

describe('allow-list writes (service role)', () => {
  it('adds a row for a staff member, normalised to E.164, created_by = the acting owner', async () => {
    const cookie = wireCookie({ platform_staff: { data: { user_id: STAFF_ID }, error: null } });
    const { builders, from } = wireAdmin({
      owner_agent_allowlist: { data: { id: ENTRY_ID }, error: null },
    });

    await expect(
      addOwnerAgentAllowlistEntry({ e164: '052-111-2233', staffUserId: STAFF_ID, label: '  נייד  ' }),
    ).resolves.toBe(ENTRY_ID);

    expect(builders.owner_agent_allowlist.insert).toHaveBeenCalledWith({
      e164: STAFF_PHONE,
      staff_user_id: STAFF_ID,
      label: 'נייד',
      created_by: OWNER_ID,
    });
    // The staff check runs on the owner's session; service role only inserts.
    expect(cookie.from).toHaveBeenCalledWith('platform_staff');
    expect(from.mock.calls.map((c) => c[0])).toEqual(['owner_agent_allowlist']);
  });

  it('records the addition with ids only — no phone, no label', async () => {
    wireCookie({ platform_staff: { data: { user_id: STAFF_ID }, error: null } });
    wireAdmin({ owner_agent_allowlist: { data: { id: ENTRY_ID }, error: null } });
    await addOwnerAgentAllowlistEntry({ e164: STAFF_PHONE, staffUserId: STAFF_ID, label: 'נייד' });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.allowlist_added',
      meta: { entryId: ENTRY_ID, staffUserId: STAFF_ID },
    });
    const logged = JSON.stringify(vi.mocked(logActivity).mock.calls);
    expect(logged).not.toContain('972');
    expect(logged).not.toContain('נייד');
  });

  it('refuses a user who is not platform staff, and inserts nothing', async () => {
    wireCookie({ platform_staff: { data: null, error: null } });
    const { builders } = wireAdmin({
      owner_agent_allowlist: { data: { id: ENTRY_ID }, error: null },
    });
    await expect(
      addOwnerAgentAllowlistEntry({ e164: STAFF_PHONE, staffUserId: STAFF_ID, label: '' }),
    ).rejects.toThrow('רק איש צוות פלטפורמה יכול להופיע ברשימת ההיתר');
    expect(builders.owner_agent_allowlist.insert).not.toHaveBeenCalled();
  });

  it('refuses bare foreign digits that would parse as a DIFFERENT Israeli number', async () => {
    // '15417543010' (US) reads as +97215417543010 under the IL default.
    const cookie = wireCookie({});
    const { from } = wireAdmin({});
    await expect(
      addOwnerAgentAllowlistEntry({ e164: '15417543010', staffUserId: STAFF_ID, label: '' }),
    ).rejects.toThrow();
    expect(cookie.from).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ['23505', 'המספר הזה כבר ברשימת ההיתר'],
    ['23514', 'מספר לא תקין — נדרש פורמט E.164'],
    ['23503', 'רק איש צוות פלטפורמה יכול להופיע ברשימת ההיתר'],
    ['XX000', 'הוספת המספר נכשלה'],
  ])('maps insert error %s to a Hebrew message', async (code, message) => {
    wireCookie({ platform_staff: { data: { user_id: STAFF_ID }, error: null } });
    wireAdmin({
      owner_agent_allowlist: { data: null, error: { message: 'raw driver text', code } },
    });
    await expect(
      addOwnerAgentAllowlistEntry({ e164: STAFF_PHONE, staffUserId: STAFF_ID, label: '' }),
    ).rejects.toThrow(message);
  });

  it('suspends and re-enables a row by id', async () => {
    const { builders } = wireAdmin({ owner_agent_allowlist: { data: [{ id: ENTRY_ID }], error: null } });
    await setOwnerAgentAllowlistEnabled(ENTRY_ID, false);
    expect(builders.owner_agent_allowlist.update).toHaveBeenCalledWith({ enabled: false });
    expect(builders.owner_agent_allowlist.eq).toHaveBeenCalledWith('id', ENTRY_ID);
  });

  it('reports a missing row rather than a silent success', async () => {
    wireAdmin({ owner_agent_allowlist: { data: [], error: null } });
    await expect(setOwnerAgentAllowlistEnabled(ENTRY_ID, true)).rejects.toThrow('הרשומה לא נמצאה');
    await expect(removeOwnerAgentAllowlistEntry(ENTRY_ID)).rejects.toThrow('הרשומה לא נמצאה');
    await expect(relabelOwnerAgentAllowlistEntry(ENTRY_ID, 'x')).rejects.toThrow('הרשומה לא נמצאה');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('relabels ("" clears the label) and does not record the label text', async () => {
    const { builders } = wireAdmin({ owner_agent_allowlist: { data: [{ id: ENTRY_ID }], error: null } });
    await relabelOwnerAgentAllowlistEntry(ENTRY_ID, '   ');
    expect(builders.owner_agent_allowlist.update).toHaveBeenCalledWith({ label: null });
    await relabelOwnerAgentAllowlistEntry(ENTRY_ID, 'הנייד של דנה');
    expect(JSON.stringify(vi.mocked(logActivity).mock.calls)).not.toContain('דנה');
  });

  it('refuses a label longer than the table allows', async () => {
    const { from } = wireAdmin({});
    await expect(relabelOwnerAgentAllowlistEntry(ENTRY_ID, 'א'.repeat(121))).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it('removes a row and records which staff member it belonged to', async () => {
    const { builders } = wireAdmin({
      owner_agent_allowlist: { data: [{ id: ENTRY_ID, staff_user_id: STAFF_ID }], error: null },
    });
    await removeOwnerAgentAllowlistEntry(ENTRY_ID);
    expect(builders.owner_agent_allowlist.delete).toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.allowlist_removed',
      meta: { entryId: ENTRY_ID, staffUserId: STAFF_ID },
    });
  });

  it('refuses a non-uuid id before any query', async () => {
    const { from } = wireAdmin({});
    await expect(removeOwnerAgentAllowlistEntry('not-an-id')).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});
