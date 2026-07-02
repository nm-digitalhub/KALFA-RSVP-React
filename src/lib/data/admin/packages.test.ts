import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  PACKAGE_COLUMNS,
  type AdminPackage,
} from './packages';
import type { PackageInput, OperationalFieldsInput } from '@/lib/validation/admin';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
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
});
