import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { setPlatformAdmin, setUserSuspended } from './users';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

// Wire createAdminClient() to a double whose awaited chains resolve to `result`
// (including the `count` used by the last-admin guard).
function wireAdminClient(result: { data: unknown; error: unknown; count?: number }) {
  const { client } = createMockSupabase(result as never);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminUser());
});

describe('setPlatformAdmin', () => {
  it('blocks revoking the last platform admin', async () => {
    wireAdminClient({ data: null, error: null, count: 1 });
    await expect(setPlatformAdmin('u-2', false)).rejects.toThrow('חייב להישאר');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('allows revoking when more than one admin exists', async () => {
    wireAdminClient({ data: null, error: null, count: 3 });
    await expect(setPlatformAdmin('u-2', false)).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalled();
  });

  it('grants admin to a user that does not have it', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setPlatformAdmin('u-2', true)).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalled();
  });
});

describe('setUserSuspended', () => {
  it('blocks suspending yourself', async () => {
    wireAdminClient({ data: null, error: null });
    await expect(setUserSuspended('admin-1', true)).rejects.toThrow('עצמך');
    expect(logActivity).not.toHaveBeenCalled();
  });
});
