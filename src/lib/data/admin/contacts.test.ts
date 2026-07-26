import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  listContactMessages,
  updateContactStatus,
  CONTACT_COLUMNS,
  type ContactMessage,
} from './contacts';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

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
    status: 'new',
    topic: null,
    user_id: null,
    handled_at: null,
    draft_reply: null,
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

describe('updateContactStatus', () => {
  it('updates status, stamps handled_at for terminal statuses, logs previous status', async () => {
    const { client, builder } = createMockSupabase<{ status: string }>({
      data: { status: 'new' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await updateContactStatus('11111111-1111-4111-8111-111111111111', 'done');

    expect(client.from).toHaveBeenCalledWith('contact_messages');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done', handled_at: expect.any(String) }),
    );
    expect(logActivity).toHaveBeenCalledWith({
      action: 'contact.status_updated',
      meta: expect.objectContaining({
        contactMessageId: '11111111-1111-4111-8111-111111111111',
        previousStatus: 'new',
        status: 'done',
      }),
    });
  });

  it('clears handled_at when moving back to a non-terminal status', async () => {
    const { client, builder } = createMockSupabase<{ status: string }>({
      data: { status: 'done' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await updateContactStatus('11111111-1111-4111-8111-111111111111', 'in_progress');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', handled_at: null }),
    );
  });
});
