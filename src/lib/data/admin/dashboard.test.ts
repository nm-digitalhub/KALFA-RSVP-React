import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import { getDashboardCounts } from './dashboard';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminUser());
});

describe('getDashboardCounts', () => {
  it('issues head-only count queries for each admin table', async () => {
    const { client, builder } = createMockSupabase<null>({
      data: null,
      error: null,
      count: 7,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const counts = await getDashboardCounts();

    expect(requireAdmin).toHaveBeenCalled();
    const tables = client.from.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'contact_messages',
        'callback_requests',
        'packages',
      ]),
    );
    // Count-only: head true, exact count.
    expect(builder.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(counts).toEqual({
      contacts: 7,
      callbacks: 7,
      packages: 7,
    });
  });

  it('returns 0 for a table whose count query errors (resilient)', async () => {
    const { client } = createMockSupabase<null>({
      data: null,
      error: { message: 'boom' },
      count: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const counts = await getDashboardCounts();

    expect(counts).toEqual({
      contacts: 0,
      callbacks: 0,
      packages: 0,
    });
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<null>({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getDashboardCounts()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });
});
