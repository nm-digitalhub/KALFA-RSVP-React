import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  listContactMessages,
  CONTACT_COLUMNS,
  type ContactMessage,
} from './contacts';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));

const ADMIN_ID = 'admin-1';
function adminUser(): User {
  return { id: ADMIN_ID } as unknown as User;
}

function row(overrides: Partial<ContactMessage> = {}): ContactMessage {
  return {
    id: 'c-1',
    name: 'דנה',
    email: 'dana@example.com',
    phone: '0501234567',
    message: 'שלום',
    created_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
});

describe('listContactMessages', () => {
  it('enforces the admin gate before querying', async () => {
    const { client } = createMockSupabase<ContactMessage[]>({
      data: [],
      error: null,
      count: 0,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await listContactMessages();

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
  });

  it('does NOT query when the admin gate redirects (throws)', async () => {
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/app;307;',
    });
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(redirectErr);
    const { client } = createMockSupabase<ContactMessage[]>({
      data: [],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listContactMessages()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('requests exactly the DTO columns with an exact count', async () => {
    const { client, builder } = createMockSupabase<ContactMessage[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await listContactMessages();

    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.select).toHaveBeenCalledWith(CONTACT_COLUMNS, {
      count: 'exact',
    });
    expect(result.items).toEqual([row()]);
    expect(result.total).toBe(1);
  });

  it('paginates: page 2 ranges over the second page window', async () => {
    const { client, builder } = createMockSupabase<ContactMessage[]>({
      data: [],
      error: null,
      count: 100,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await listContactMessages({ page: 2 });

    // Default ADMIN_PAGE_SIZE is 25 → page 2 = rows 25..49.
    expect(builder.range).toHaveBeenCalledWith(25, 49);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(25);
  });

  it('throws a safe error and leaks no DB detail on failure', async () => {
    const { client } = createMockSupabase<ContactMessage[]>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listContactMessages()).rejects.toThrow('טעינת הפניות נכשלה');
  });
});
