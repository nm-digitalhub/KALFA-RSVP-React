import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  listCallbackRequests,
  updateCallbackStatus,
  CALLBACK_COLUMNS,
  type CallbackRequest,
} from './callbacks';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

function row(overrides: Partial<CallbackRequest> = {}): CallbackRequest {
  return {
    id: 'cb-1',
    full_name: 'יוסי',
    phone: '0521112222',
    topic: 'מחירים',
    note: null,
    status: 'new',
    created_at: '2026-06-20T10:00:00.000Z',
    updated_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
});

describe('listCallbackRequests', () => {
  it('requests the DTO columns from the right table with a count', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await listCallbackRequests();

    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.select).toHaveBeenCalledWith(CALLBACK_COLUMNS, {
      count: 'exact',
    });
    expect(result.total).toBe(1);
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: [],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listCallbackRequests()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error on failure', async () => {
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listCallbackRequests()).rejects.toThrow(
      'טעינת בקשות החזרה נכשלה',
    );
  });
});

describe('updateCallbackStatus', () => {
  it('enforces the admin gate and updates the matching row', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await updateCallbackStatus('cb-1', 'done');

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'cb-1');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'callback.status_updated',
      }),
    );
  });

  it('does NOT update when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(updateCallbackStatus('cb-1', 'done')).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error when the update fails', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: { message: 'nope' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(updateCallbackStatus('cb-1', 'done')).rejects.toThrow(
      'עדכון הסטטוס נכשל',
    );
  });
});
