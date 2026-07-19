import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPlatformPermission, requireAdmin } from '@/lib/auth/dal';
import { getDashboardCounts } from './dashboard';

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

describe('getDashboardCounts — per-domain permission gating', () => {
  it('with both view_customer_data + view_billing → all three counts', async () => {
    grant('view_customer_data', 'view_billing');
    const { client, builder } = createMockSupabase<null>({
      data: null,
      error: null,
      count: 7,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getDashboardCounts();

    expect(requireAdmin).toHaveBeenCalled();
    // Count-only: head true, exact count.
    expect(builder.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(counts).toEqual({ contacts: 7, callbacks: 7, packages: 7 });
  });

  it('support agent (view_customer_data only) → packages is null and is NOT queried', async () => {
    grant('view_customer_data');
    const { client } = createMockSupabase<null>({
      data: null,
      error: null,
      count: 3,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getDashboardCounts();

    expect(counts).toEqual({ contacts: 3, callbacks: 3, packages: null });
    // The forbidden domain must not even be counted — no leak of its volume.
    const tables = client.from.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('packages');
    expect(tables).toEqual(
      expect.arrayContaining(['contact_messages', 'callback_requests']),
    );
  });

  it('billing-only viewer → only packages is counted, customer counts null', async () => {
    grant('view_billing');
    const { client } = createMockSupabase<null>({
      data: null,
      error: null,
      count: 5,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getDashboardCounts();

    expect(counts).toEqual({ contacts: null, callbacks: null, packages: 5 });
    const tables = client.from.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(['packages']);
  });

  it('no domain permissions → all null, zero queries', async () => {
    grant();
    const { client } = createMockSupabase<null>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getDashboardCounts();

    expect(counts).toEqual({ contacts: null, callbacks: null, packages: null });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns 0 (not null) for a permitted table whose count query errors', async () => {
    grant('view_customer_data', 'view_billing');
    const { client } = createMockSupabase<null>({
      data: null,
      error: { message: 'boom' },
      count: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const counts = await getDashboardCounts();

    // A failed count is a resilient 0 (dashboard must not crash); null is reserved
    // strictly for "not permitted to see".
    expect(counts).toEqual({ contacts: 0, callbacks: 0, packages: 0 });
  });

  it('does NOT touch data when the admin gate redirects', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<null>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(getDashboardCounts()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
    expect(hasPlatformPermission).not.toHaveBeenCalled();
  });
});
