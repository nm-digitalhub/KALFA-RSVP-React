import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  getCallbackRequestByCalendarItem,
  listCallbackRequests,
  updateCallbackStatus,
  CALLBACK_COLUMNS,
  type CallbackRequest,
} from './callbacks';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
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

// The calendar dialog renders a dialable number and a working link from THIS
// lookup rather than from the appointment's description. If it silently
// returned nothing, the dialog would fall back to showing prose with dead
// links — the exact regression this replaced.
describe('getCallbackRequestByCalendarItem', () => {
  function mockClient(data: unknown, error: unknown = null) {
    const { client, builder } = createMockSupabase<unknown>({
      data: data as never,
      error: error as never,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  }

  it('is gated on customer-data access before it reads anything', async () => {
    mockClient(null);
    await getCallbackRequestByCalendarItem('item-1');
    expect(requirePlatformPermission).toHaveBeenCalledWith('view_customer_data');
  });

  it('looks the request up by the calendar item the owner clicked', async () => {
    const { client, builder } = mockClient(row());

    await getCallbackRequestByCalendarItem('item-1');

    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.eq).toHaveBeenCalledWith('calendar_item_id', 'item-1');
    // maybeSingle, not single: an ordinary meeting matches no row at all.
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it('returns null for an appointment this system never scheduled', async () => {
    mockClient(null);
    await expect(getCallbackRequestByCalendarItem('item-1')).resolves.toBeNull();
  });

  it('raises a safe Hebrew error instead of leaking the database one', async () => {
    mockClient(null, { message: 'relation "callback_requests" does not exist' });
    await expect(getCallbackRequestByCalendarItem('item-1')).rejects.toThrow(
      'טעינת בקשת החזרה נכשלה',
    );
  });
});

describe('listCallbackRequests', () => {
  it('requests the DTO columns from the right table with a count', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listCallbackRequests()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error on failure', async () => {
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
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
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(updateCallbackStatus('cb-1', 'done')).rejects.toThrow(
      'עדכון הסטטוס נכשל',
    );
  });
});
