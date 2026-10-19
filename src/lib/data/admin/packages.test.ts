import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission, requireUser } from '@/lib/auth/dal';
import { requireAnyPlatformAction, requirePlatformAction } from '@/lib/auth/platform-ability';
import { logActivity } from '@/lib/data/activity';
import {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  validateOutreachScheduleForPackage,
  getScheduleStepOptions,
  getSuggestedSchedule,
  PACKAGE_COLUMNS,
  type AdminPackage,
} from './packages';
import type {
  PackageInput,
  OperationalFieldsInput,
  OutreachTouchpointInput,
} from '@/lib/validation/admin';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformPermission: vi.fn(),
  requireUser: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));
// The real action gates, wrapped so the pair each function asks for can be asserted. They still delegate to the
// mocked requirePlatformPermission above, so every existing case keeps testing the same refusal.
vi.mock('@/lib/auth/platform-ability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/platform-ability')>();
  return {
    ...actual,
    requirePlatformAction: vi.fn(actual.requirePlatformAction),
    requireAnyPlatformAction: vi.fn(actual.requireAnyPlatformAction),
  };
});
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
// notFound throws a distinguishable error so we can assert it.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

function row(overrides: Partial<AdminPackage> = {}): AdminPackage {
  return {
    id: 'p-1',
    name: 'בסיס',
    tier: 'basic',
    category: 'digital',
    description: null,
    price_with_vat: 100,
    includes: ['א', 'ב'],
    active: true,
    sort_order: 0,
    created_at: '2026-06-20T10:00:00.000Z',
    channels: [],
    outreach_schedule: [],
    contact_quota: null,
    ...overrides,
  };
}

const input: PackageInput = {
  name: 'חבילה',
  tier: 'gold',
  category: 'digital',
  description: '',
  price_with_vat: 250,
  includes: ['פריט 1', 'פריט 2'],
  active: true,
  sort_order: 0,
};

// Non-campaign-enabled by default (no contact quota) — a package that is not sold as a campaign.
const operational: OperationalFieldsInput = {
  contact_quota: null,
  channels: [],
  outreach_schedule: [],
};

// Fully-populated campaign-enabled shape (plan §5.5#1/#3). A distinctive
// multi-row schedule + 2-element channels array so the round-trip assertions
// below catch any dropped field or shape change (wrapping/stringification)
// slipping through toWritable()'s `as unknown as Json` casts.
const fullSchedule = [
  { days_before: 7, channel: 'whatsapp', message_key: 'rsvp_1' },
  { days_before: 2, channel: 'call', message_key: 'call_1' },
] satisfies OutreachTouchpointInput[];

const fullOperational: OperationalFieldsInput = {
  channels: ['whatsapp', 'call'],
  outreach_schedule: fullSchedule,
  contact_quota: 40,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
  vi.mocked(requireUser).mockResolvedValue(adminUser());
});

describe('listPackages', () => {
  it('selects the DTO columns from packages', async () => {
    const { client, builder } = createMockSupabase<AdminPackage[]>({
      data: [row()],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listPackages();

    expect(requirePlatformPermission).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledWith('packages');
    expect(builder.select).toHaveBeenCalledWith(PACKAGE_COLUMNS);
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<AdminPackage[]>({
      data: [],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listPackages()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('getPackage', () => {
  it('returns the row by id', async () => {
    const { client, builder } = createMockSupabase<AdminPackage>({
      data: row(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const pkg = await getPackage('p-1');

    expect(builder.eq).toHaveBeenCalledWith('id', 'p-1');
    expect(pkg.id).toBe('p-1');
  });

  it('returns the operational fields unchanged (round-trip shape guard)', async () => {
    const stored = row({
      contact_quota: 40,
      channels: ['whatsapp', 'call'],
      outreach_schedule: fullSchedule,
    });
    const { client } = createMockSupabase<AdminPackage>({
      data: stored,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const pkg = await getPackage('p-1');

    expect(pkg.contact_quota).toBe(40);
    // Exact deep equality on both arrays: same order, same keys, no
    // wrapping/stringification anywhere on the read path.
    expect(pkg.channels).toEqual(['whatsapp', 'call']);
    expect(pkg.outreach_schedule).toEqual(fullSchedule);
  });

  it('calls notFound() when the package is missing', async () => {
    const { client } = createMockSupabase<AdminPackage>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getPackage('missing')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('createPackage', () => {
  it('inserts the validated writable payload and returns the new id', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'new-id' },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await createPackage(input, operational);

    expect(client.from).toHaveBeenCalledWith('packages');
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'חבילה',
        tier: 'gold',
        category: 'digital',
        price_with_vat: 250,
        active: true,
        // empty description normalised to null
        description: null,
      }),
    );
    expect(result).toEqual({ id: 'new-id' });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'package.created',
      }),
    );
  });

  it('persists the operational fields with exact array shapes, and no per-result or hold column', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({
      data: { id: 'new-id' },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await createPackage(input, fullOperational);

    // Capture the raw insert payload: the arrays must survive toWritable()'s
    // Json casts untouched — exact toEqual, not objectContaining, so any
    // wrapping/stringification regression fails here.
    const payload = builder.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.contact_quota).toBe(40);
    expect(payload.channels).toEqual(['whatsapp', 'call']);
    expect(payload.outreach_schedule).toEqual(fullSchedule);
    for (const old of ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct']) {
      expect(payload, old).not.toHaveProperty(old);
    }
  });

  it('throws a safe error when the insert fails', async () => {
    const { client } = createMockSupabase<{ id: string }>({
      data: null,
      error: { message: 'dup' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(createPackage(input, operational)).rejects.toThrow('יצירת החבילה נכשלה');
  });
});

describe('contact_quota — the fixed-price package\'s quota', () => {
  const quotaOperational: OperationalFieldsInput = {
    ...operational,
    contact_quota: 40,
    channels: ['whatsapp'],
    outreach_schedule: [{ days_before: 7, channel: 'whatsapp', message_key: 'rsvp_1' }],
  };

  it('is written on create and on update, and is part of what the admin reads back', async () => {
    const { client, builder } = createMockSupabase<{ id: string }>({ data: { id: 'new-id' }, error: null });
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
    await createPackage(input, quotaOperational);
    expect((builder.insert.mock.calls[0]?.[0] as Record<string, unknown>).contact_quota).toBe(40);
    expect(PACKAGE_COLUMNS).toContain('contact_quota');
  });

  it('a change of the quota is named in the audit row, and so is clearing it', async () => {
    const { client } = createMockSupabase<AdminPackage>({ data: row({ contact_quota: 40 }), error: null });
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    await updatePackage('p-1', input, { ...quotaOperational, contact_quota: 60 });
    expect(logActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ changedFields: expect.arrayContaining(['contact_quota']) }) }),
    );

    await updatePackage('p-1', input, { ...quotaOperational, contact_quota: null });
    expect(logActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ changedFields: expect.arrayContaining(['contact_quota']) }) }),
    );
  });

  it('an unchanged quota is not reported as a change', async () => {
    const { client } = createMockSupabase<AdminPackage>({
      data: row({ contact_quota: 40, channels: ['whatsapp'], outreach_schedule: quotaOperational.outreach_schedule as never }),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    await updatePackage('p-1', input, quotaOperational);
    const meta = vi.mocked(logActivity).mock.calls.at(-1)?.[0].meta as { changedFields: string[] };
    expect(meta.changedFields).not.toContain('contact_quota');
  });
});

describe('updatePackage', () => {
  it('updates the matching row with the writable payload', async () => {
    const { client, builder } = createMockSupabase<AdminPackage>({
      data: row(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updatePackage('p-1', input, operational);

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'חבילה', price_with_vat: 250 }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'p-1');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'package.updated',
      }),
    );
  });

  it('persists the operational fields in the update payload, and no per-result or hold column', async () => {
    // The shared result serves both awaits in sequence: updatePackage first
    // awaits getPackage (select → row()), then the update itself (error: null).
    const { client, builder } = createMockSupabase<AdminPackage>({
      data: row(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updatePackage('p-1', input, fullOperational);

    // Same exact-shape contract as the createPackage twin above.
    const payload = builder.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.contact_quota).toBe(40);
    expect(payload.channels).toEqual(['whatsapp', 'call']);
    expect(payload.outreach_schedule).toEqual(fullSchedule);
    for (const old of ['price_per_reached', 'base_price', 'included_reached', 'min_hold_floor', 'hold_buffer_pct']) {
      expect(payload, old).not.toHaveProperty(old);
    }
  });
});

describe('deletePackage', () => {
  it('deletes the matching row under the admin gate', async () => {
    const { client, builder } = createMockSupabase<AdminPackage>({
      data: row(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await deletePackage('p-1');

    expect(requirePlatformPermission).toHaveBeenCalled();
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'p-1');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'package.deleted',
      }),
    );
  });

  it('throws a safe error when the delete fails', async () => {
    const { client, builder } = createMockSupabase<AdminPackage>({
      data: row(),
      error: null,
    });
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((onFulfilled) =>
        onFulfilled({ data: row(), error: null }),
      )
      .mockImplementationOnce((onFulfilled) =>
        onFulfilled({ data: null, error: { message: 'fk' } }),
      );
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>, 
    );

    await expect(deletePackage('p-1')).rejects.toThrow('מחיקת החבילה נכשלה');
  });

  it('throws the specific FK message when a campaign still references the package (23503, plan §5.5 round-4(א))', async () => {
    const { client, builder } = createMockSupabase<AdminPackage>({
      data: row(),
      error: null,
    });
    // First await: the getPackage preload → row(); second: the delete failing
    // with Postgres foreign_key_violation, which maps to the specific Hebrew
    // message instead of the generic one.
    const fkViolation = { code: '23503', message: 'violates foreign key constraint' };
    vi.spyOn(builder, 'then')
      .mockImplementationOnce((onFulfilled) =>
        onFulfilled({ data: row(), error: null }),
      )
      .mockImplementationOnce((onFulfilled) =>
        onFulfilled({ data: null, error: fkViolation }),
      );
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(deletePackage('p-1')).rejects.toThrow(
      'לא ניתן למחוק חבילה שמשויכת לקמפיין קיים (גם קמפיין ישן/סגור)',
    );
  });
});

describe('validateOutreachScheduleForPackage', () => {
  // Template rows as the batched select in packages.ts returns them.
  type RouteRow = {
    event_type: string | null;
    with_media: boolean;
    whatsapp_message_templates: { status: string | null } | null;
  };
  type TemplateRow = {
    message_key: string;
    channel: string;
    message_template_routes: RouteRow[];
  };

  const APPROVED_DEFAULT: RouteRow[] = [
    { event_type: null, with_media: false, whatsapp_message_templates: { status: 'APPROVED' } },
  ];
  const k1: TemplateRow = { message_key: 'k1', channel: 'whatsapp', message_template_routes: APPROVED_DEFAULT };
  const k2: TemplateRow = { message_key: 'k2', channel: 'whatsapp', message_template_routes: APPROVED_DEFAULT };

  // Interleaved schedule — whatsapp(k1), call(c1), whatsapp(k1 dup),
  // whatsapp(k2) — exercises key dedup, call-touchpoint exclusion, and
  // ORIGINAL-index preservation in a single fixture.
  const mixedSchedule = [
    { days_before: 7, channel: 'whatsapp', message_key: 'k1' },
    { days_before: 5, channel: 'call', message_key: 'c1' },
    { days_before: 3, channel: 'whatsapp', message_key: 'k1' },
    { days_before: 1, channel: 'whatsapp', message_key: 'k2' },
  ] satisfies OutreachTouchpointInput[];

  // Wire createAdminClient (service-role client, separate from the cookie
  // client mocked elsewhere in this file) to resolve with `data`.
  function wireAdmin(data: TemplateRow[] | null) {
    const { client, builder } = createMockSupabase<TemplateRow[]>({
      data,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  }

  it('batches one deduped whatsapp-only query against message_templates', async () => {
    const { client, builder } = wireAdmin([k1, k2]);

    const errors = await validateOutreachScheduleForPackage(mixedSchedule);

    expect(requirePlatformPermission).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledWith('message_templates');
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(builder.select).toHaveBeenCalledWith(
      'message_key, channel, message_template_routes(event_type, with_media, whatsapp_message_templates(status))',
    );
    // Deduped (k1 appears twice) and call keys (c1) excluded.
    expect(builder.in).toHaveBeenCalledWith('message_key', ['k1', 'k2']);
    expect(builder.eq).toHaveBeenCalledWith('active', true);
    expect(errors).toEqual([]);
  });

  it('reports a missing template at its ORIGINAL schedule index', async () => {
    wireAdmin([k1]);

    const errors = await validateOutreachScheduleForPackage(mixedSchedule);

    // Index 3, not 2: positions are preserved across the interleaved call
    // touchpoint (map-before-filter), so the form flags the right row.
    expect(errors).toEqual([
      { index: 3, message: 'תבנית "k2" לא נמצאה או אינה פעילה' },
    ]);
  });

  it('reports a channel mismatch when the template belongs to another channel', async () => {
    wireAdmin([{ message_key: 'k1', channel: 'call', message_template_routes: [] }]);

    const errors = await validateOutreachScheduleForPackage([
      { days_before: 7, channel: 'whatsapp', message_key: 'k1' },
    ]);

    expect(errors).toEqual([{ index: 0, message: 'תבנית "k1" מיועדת לערוץ אחר' }]);
  });

  // Valid = what resolveWhatsAppSend needs to send: a default text route to a
  // template Meta has APPROVED.
  it.each([
    ['no routes', []],
    ['only an image route', [{ event_type: null, with_media: true, whatsapp_message_templates: { status: 'APPROVED' } }]],
    ['only an event-type route', [{ event_type: 'brit', with_media: false, whatsapp_message_templates: { status: 'APPROVED' } }]],
    ['a paused default template', [{ event_type: null, with_media: false, whatsapp_message_templates: { status: 'PAUSED' } }]],
  ])('reports a step with no approved default template (%s)', async (_label, routes) => {
    wireAdmin([{ message_key: 'k1', channel: 'whatsapp', message_template_routes: routes }]);

    const errors = await validateOutreachScheduleForPackage([
      { days_before: 7, channel: 'whatsapp', message_key: 'k1' },
    ]);

    expect(errors).toEqual([{ index: 0, message: 'לשלב "k1" אין תבנית מאושרת ב-Meta' }]);
  });

  it('returns [] for a call-only schedule without querying at all', async () => {
    const { client } = wireAdmin([]);

    const errors = await validateOutreachScheduleForPackage([
      { days_before: 7, channel: 'call', message_key: 'c1' },
    ]);

    // Early return before any query: no client is even constructed.
    expect(errors).toEqual([]);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('getScheduleStepOptions — what the schedule form offers instead of a text field', () => {
  const approved = { event_type: null, with_media: false, whatsapp_message_templates: { status: 'APPROVED' } };

  function wire(result: { data: unknown; error: unknown }) {
    const { client, builder } = createMockSupabase<unknown>(result as never);
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
    return { client, builder };
  }

  it('is behind manage_billing and reads the steps with their routes', async () => {
    const { client, builder } = wire({ data: [], error: null });
    await getScheduleStepOptions();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(client.from).toHaveBeenCalledWith('message_templates');
    expect(String(builder.select.mock.calls[0][0])).toContain('message_template_routes(');
  });

  it('does not read anything when the gate refuses', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }));
    wire({ data: [], error: null });
    await expect(getScheduleStepOptions()).rejects.toThrow('NEXT_REDIRECT');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('turns the rows into options: ready steps pickable, a step without an approved template shown with its reason', async () => {
    wire({
      data: [
        { message_key: 'invite', channel: 'whatsapp', label: 'הזמנה', active: true, message_template_routes: [approved] },
        { message_key: 'final', channel: 'whatsapp', label: 'אחרונה', active: true, message_template_routes: [] },
        { message_key: 'call_1', channel: 'call', label: null, active: false, message_template_routes: [] },
        { message_key: 'thankyou', channel: 'whatsapp', label: 'תודה', active: true, message_template_routes: [approved] },
      ],
      error: null,
    });
    expect(await getScheduleStepOptions()).toEqual([
      { channel: 'call', messageKey: 'call_1', label: 'call_1', problem: null },
      { channel: 'whatsapp', messageKey: 'invite', label: 'הזמנה', problem: null },
      { channel: 'whatsapp', messageKey: 'final', label: 'אחרונה', problem: 'אין תבנית מאושרת ב-Meta' },
    ]);
  });

  it('a database failure is a safe message', async () => {
    wire({ data: null, error: { message: 'permission denied' } });
    await expect(getScheduleStepOptions()).rejects.toThrow('טעינת תבניות ההודעות נכשלה');
  });
});

describe('getSuggestedSchedule — what a NEW package starts with', () => {
  const good = [
    { days_before: 10, channel: 'whatsapp', message_key: 'invite' },
    { days_before: 2, channel: 'call', message_key: 'call_1' },
  ];

  function wire(result: { data: unknown; error: unknown }) {
    const { client, builder } = createMockSupabase<unknown>(result as never);
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
    return { client, builder };
  }

  it('is behind manage_billing and looks only at ACTIVE packages, in catalogue order', async () => {
    const { builder } = wire({ data: [], error: null });
    await getSuggestedSchedule();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(builder.eq).toHaveBeenCalledWith('active', true);
    expect(builder.order).toHaveBeenNthCalledWith(1, 'sort_order', { ascending: true });
    expect(builder.order).toHaveBeenNthCalledWith(2, 'name', { ascending: true });
  });

  it('takes the schedule of the first package that has a valid one, naming it, with the channels the steps need', async () => {
    wire({
      data: [
        { name: 'ריקה', channels: ['whatsapp'], outreach_schedule: [] },
        { name: 'פגומה', channels: ['whatsapp'], outreach_schedule: [{ days_before: 'x', channel: 'whatsapp', message_key: 'invite' }] },
        { name: 'הראשית', channels: ['whatsapp'], outreach_schedule: good },
        { name: 'אחרת', channels: ['whatsapp'], outreach_schedule: [{ days_before: 5, channel: 'whatsapp', message_key: 'final' }] },
      ],
      error: null,
    });
    expect(await getSuggestedSchedule()).toEqual({
      fromName: 'הראשית',
      // the stored channel list lacks 'call', but a step uses it: the form would refuse the schedule without it
      channels: ['whatsapp', 'call'],
      schedule: good,
    });
  });

  it.each([
    ['no packages', []],
    ['packages with no schedule', [{ name: 'א', channels: [], outreach_schedule: [] }]],
    ['a value that is not a list', [{ name: 'א', channels: [], outreach_schedule: { x: 1 } }]],
    ['a channel the system does not know', [{ name: 'א', channels: [], outreach_schedule: [{ days_before: 1, channel: 'fax', message_key: 'invite' }] }]],
  ])('suggests nothing for %s — an empty form, never a half-filled one', async (_label, data) => {
    wire({ data, error: null });
    expect(await getSuggestedSchedule()).toBeNull();
  });

  it('a database failure is a safe message', async () => {
    wire({ data: null, error: { message: 'boom' } });
    await expect(getSuggestedSchedule()).rejects.toThrow('טעינת החבילות נכשלה');
  });
});

// pilot-casl-package-permissions, design D4: every package function asks for its action through the shared action
// map (src/lib/casl.ts) instead of naming a key, and refuses before it builds any database client.
describe('the action gate of every package function', () => {
  const redirectSignal = () =>
    Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/access-denied;307;' });
  const whatsappStep = [
    { days_before: 7, channel: 'whatsapp', message_key: 'k1' },
  ] satisfies OutreachTouchpointInput[];
  const FORM_HELPER = [
    { action: 'create', subject: 'Package' },
    { action: 'update', subject: 'Package' },
  ];

  type Case = {
    name: string;
    run: () => Promise<unknown>;
    single?: readonly [string, string];
    any?: typeof FORM_HELPER;
  };
  const CASES: Case[] = [
    { name: 'listPackages', run: () => listPackages(), single: ['read', 'Package'] },
    { name: 'getPackage', run: () => getPackage('p-1'), single: ['read', 'Package'] },
    { name: 'createPackage', run: () => createPackage(input, operational), single: ['create', 'Package'] },
    { name: 'updatePackage', run: () => updatePackage('p-1', input, operational), single: ['update', 'Package'] },
    { name: 'deletePackage', run: () => deletePackage('p-1'), single: ['delete', 'Package'] },
    { name: 'getSuggestedSchedule', run: () => getSuggestedSchedule(), single: ['create', 'Package'] },
    { name: 'getScheduleStepOptions', run: () => getScheduleStepOptions(), any: FORM_HELPER },
    {
      name: 'validateOutreachScheduleForPackage',
      run: () => validateOutreachScheduleForPackage(whatsappStep),
      any: FORM_HELPER,
    },
  ];

  beforeEach(() => {
    const { client } = createMockSupabase<AdminPackage>({ data: row(), error: null });
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  });

  for (const c of CASES) {
    it(`${c.name} asks for ${c.single ? c.single.join(' ') : 'create or update Package'}`, async () => {
      // Only the gate is asserted here; each function's own behaviour is covered by its suite above.
      await c.run().catch(() => undefined);
      if (c.single) {
        expect(requirePlatformAction).toHaveBeenCalledWith(...c.single);
      } else {
        expect(requireAnyPlatformAction).toHaveBeenCalledWith(c.any);
      }
    });

    it(`${c.name} refuses before it creates a database client`, async () => {
      vi.mocked(requirePlatformPermission).mockRejectedValue(redirectSignal());
      await expect(c.run()).rejects.toMatchObject({ digest: expect.stringContaining('/access-denied') });
      expect(createClient).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
    });
  }
});
