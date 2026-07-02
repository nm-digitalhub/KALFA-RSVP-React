import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  validateOutreachScheduleForPackage,
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
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));
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
    price_per_reached: null,
    channels: [],
    outreach_schedule: [],
    min_hold_floor: 0,
    hold_buffer_pct: 0,
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

// Non-campaign-enabled by default (price_per_reached: null) — the common
// case for §1.6's "package that isn't a campaign template" state.
const operational: OperationalFieldsInput = {
  price_per_reached: null,
  channels: [],
  outreach_schedule: [],
  min_hold_floor: 0,
  hold_buffer_pct: 0,
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
  price_per_reached: 4,
  channels: ['whatsapp', 'call'],
  outreach_schedule: fullSchedule,
  min_hold_floor: 50,
  hold_buffer_pct: 0.1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminUser());
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

    expect(requireAdmin).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledWith('packages');
    expect(builder.select).toHaveBeenCalledWith(PACKAGE_COLUMNS);
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
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

  it('returns the 5 operational fields unchanged (round-trip shape guard, plan §5.5#1/#3)', async () => {
    const stored = row({
      price_per_reached: 4,
      channels: ['whatsapp', 'call'],
      outreach_schedule: fullSchedule,
      min_hold_floor: 50,
      hold_buffer_pct: 0.1,
    });
    const { client } = createMockSupabase<AdminPackage>({
      data: stored,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const pkg = await getPackage('p-1');

    expect(pkg.price_per_reached).toBe(4);
    // Exact deep equality on both arrays: same order, same keys, no
    // wrapping/stringification anywhere on the read path.
    expect(pkg.channels).toEqual(['whatsapp', 'call']);
    expect(pkg.outreach_schedule).toEqual(fullSchedule);
    expect(pkg.min_hold_floor).toBe(50);
    expect(pkg.hold_buffer_pct).toBe(0.1);
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

  it('persists all 5 operational fields with exact array shapes (plan §5.5#1/#3)', async () => {
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
    expect(payload.price_per_reached).toBe(4);
    expect(payload.channels).toEqual(['whatsapp', 'call']);
    expect(payload.outreach_schedule).toEqual(fullSchedule);
    expect(payload.min_hold_floor).toBe(50);
    expect(payload.hold_buffer_pct).toBe(0.1);
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

  it('persists all 5 operational fields in the update payload (plan §5.5#1/#3)', async () => {
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
    expect(payload.price_per_reached).toBe(4);
    expect(payload.channels).toEqual(['whatsapp', 'call']);
    expect(payload.outreach_schedule).toEqual(fullSchedule);
    expect(payload.min_hold_floor).toBe(50);
    expect(payload.hold_buffer_pct).toBe(0.1);
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

    expect(requireAdmin).toHaveBeenCalled();
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
  // Template rows as the batched select returns them (the columns picked in
  // packages.ts mirror getTemplateByKey's message_templates shape).
  type TemplateRow = {
    message_key: string;
    name: string;
    language: string;
    channel: string;
  };

  const k1: TemplateRow = { message_key: 'k1', name: 'x', language: 'he', channel: 'whatsapp' };
  const k2: TemplateRow = { message_key: 'k2', name: 'x', language: 'he', channel: 'whatsapp' };

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

    expect(requireAdmin).toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledWith('message_templates');
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(builder.select).toHaveBeenCalledWith('message_key, name, language, channel');
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
    wireAdmin([{ message_key: 'k1', name: 'x', language: 'he', channel: 'call' }]);

    const errors = await validateOutreachScheduleForPackage([
      { days_before: 7, channel: 'whatsapp', message_key: 'k1' },
    ]);

    expect(errors).toEqual([{ index: 0, message: 'תבנית "k1" מיועדת לערוץ אחר' }]);
  });

  it('treats a row with empty name/language as not found (getTemplateByKey semantics)', async () => {
    wireAdmin([{ message_key: 'k1', name: '', language: '', channel: 'whatsapp' }]);

    const errors = await validateOutreachScheduleForPackage([
      { days_before: 7, channel: 'whatsapp', message_key: 'k1' },
    ]);

    expect(errors).toEqual([
      { index: 0, message: 'תבנית "k1" לא נמצאה או אינה פעילה' },
    ]);
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
