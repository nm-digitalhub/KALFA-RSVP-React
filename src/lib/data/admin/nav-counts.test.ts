import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requireAdmin } from '@/lib/auth/dal';
import { getAdminNavCounts } from './nav-counts';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({
  requireAdmin: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

// Grant a set of permission keys; anything not listed resolves false.
function grant(...keys: string[]) {
  vi.mocked(hasPlatformPermission).mockImplementation(async (k: string) =>
    keys.includes(k),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminUser());
});

describe('getAdminNavCounts — per-domain permission gating', () => {
  it('with every platform permission → all four counts, correct predicates', async () => {
    grant('view_customer_data', 'manage_billing', 'manage_settings');
    const { client, builder } = createMockSupabase<null>({
      data: null,
      error: null,
      count: 4,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getAdminNavCounts();

    expect(requireAdmin).toHaveBeenCalled();
    expect(counts).toEqual({ contacts: 4, callbacks: 4, campaigns: 4, fleet: 4 });

    const tables = client.from.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'contact_messages',
        'callback_requests',
        'campaigns',
        'fleet_requests',
      ]),
    );
    // Count-only: head true, exact count, no rows transferred.
    expect(builder.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    // contacts/callbacks/fleet each filter on a single status value; campaigns
    // filters on the WINDDOWN_STATUSES list (the same predicate
    // listCampaignsForAdmin() itself uses).
    expect(builder.eq).toHaveBeenCalledWith('status', 'new');
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending');
    expect(builder.in).toHaveBeenCalledWith('status', ['active', 'paused', 'closed']);
  });

  it('only view_customer_data → contacts/callbacks counted, campaigns/fleet null and NOT queried', async () => {
    grant('view_customer_data');
    const { client } = createMockSupabase<null>({
      data: null,
      error: null,
      count: 2,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getAdminNavCounts();

    expect(counts).toEqual({ contacts: 2, callbacks: 2, campaigns: null, fleet: null });
    const tables = client.from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('campaigns');
    expect(tables).not.toContain('fleet_requests');
  });

  it('no platform permissions → all null, zero queries (admin with only has_role(admin))', async () => {
    grant();
    const { client } = createMockSupabase<null>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getAdminNavCounts();

    expect(counts).toEqual({ contacts: null, callbacks: null, campaigns: null, fleet: null });
    expect(client.from).not.toHaveBeenCalled();
    // Must gate with the non-throwing check, never the redirecting one — a
    // platform-permission-less admin must still see every OTHER /admin page.
    expect(hasPlatformPermission).toHaveBeenCalled();
  });

  it('returns 0 (not null) for a permitted table whose count query errors', async () => {
    grant('view_customer_data', 'manage_billing', 'manage_settings');
    const { client } = createMockSupabase<null>({
      data: null,
      error: { message: 'boom' },
      count: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getAdminNavCounts();

    // A failed count is a resilient 0 (the sidebar must not crash); null is
    // reserved strictly for "not permitted to see".
    expect(counts).toEqual({ contacts: 0, callbacks: 0, campaigns: 0, fleet: 0 });
  });

  it('does NOT touch data when the admin gate redirects', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<null>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(getAdminNavCounts()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
    expect(hasPlatformPermission).not.toHaveBeenCalled();
  });
});
