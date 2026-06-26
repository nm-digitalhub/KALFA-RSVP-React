import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import {
  listAllOrders,
  ADMIN_ORDER_COLUMNS,
  type AdminOrder,
} from './orders';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

function row(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'o-1',
    status: 'paid',
    total_with_vat: 1234.5,
    vat_rate: 0.18,
    with_ai_addon: false,
    event_id: 'e-1',
    package_id: 'p-1',
    created_at: '2026-06-20T10:00:00.000Z',
    payment_processing_started_at: null,
    isStuckProcessing: false,
    package: { name: 'בסיס', tier: 'basic' },
    event: { name: 'חתונה' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminUser());
});

describe('listAllOrders', () => {
  it('selects the DTO columns (with embeds) from orders with a count', async () => {
    const { client, builder } = createMockSupabase<AdminOrder[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await listAllOrders();

    expect(client.from).toHaveBeenCalledWith('orders');
    expect(builder.select).toHaveBeenCalledWith(ADMIN_ORDER_COLUMNS, {
      count: 'exact',
    });
    // The select string embeds the package and event relationships (no N+1).
    expect(ADMIN_ORDER_COLUMNS).toContain('package:packages(name, tier)');
    expect(ADMIN_ORDER_COLUMNS).toContain('event:events(name)');
    expect(result.items[0]?.package?.name).toBe('בסיס');
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<AdminOrder[]>({
      data: [],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listAllOrders()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error on failure', async () => {
    const { client } = createMockSupabase<AdminOrder[]>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listAllOrders()).rejects.toThrow('טעינת ההזמנות נכשלה');
  });
});
