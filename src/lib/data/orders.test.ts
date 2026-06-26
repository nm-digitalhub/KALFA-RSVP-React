import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { notFound } from 'next/navigation';

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { getOrdersPageSize } from '@/lib/constants';
import type { OrderDetail, OrderListItem } from '@/lib/data/orders';
import { getOrder, listOrders } from '@/lib/data/orders';

// `orders.ts` and `dal.ts` begin with `import 'server-only'`, which throws
// outside Next's RSC context. Vitest does not set that export condition.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));

// getOrder calls notFound() when the row is missing or not owned; in real Next
// that throws. Outside an RSC request we stub it to a tagged error we can both
// assert on (rejects.toThrow) and verify was invoked.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// The exact column projection orders.ts requests — this string IS the DTO
// contract; listOrders returns rows pass-through. Note: no updated_at/paid_at
// (those columns do not exist on the orders table).
const ORDER_COLUMNS =
  'id, status, total_with_vat, vat_rate, with_ai_addon, event_id, package_id, created_at';

// The exact column projection getOrder requests — this string IS the detail DTO
// contract; getOrder casts the row through pass-through.
const ORDER_DETAIL_COLUMNS =
  'id, status, total_with_vat, vat_rate, with_ai_addon, event_id, package_id, ' +
  'sumit_document_id, paid_at, payment_attempt_ref, created_at';

const USER_ID = 'user-123';

function mockUser(): User {
  return { id: USER_ID } as unknown as User;
}

function sampleRow(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: 'order-1',
    status: 'paid',
    total_with_vat: 1170,
    vat_rate: 0.17,
    with_ai_addon: false,
    event_id: 'event-1',
    package_id: 'package-1',
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

function detailRow(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-1',
    status: 'pending',
    total_with_vat: 1170,
    vat_rate: 0.17,
    with_ai_addon: false,
    event_id: 'event-1',
    package_id: 'package-1',
    sumit_document_id: null,
    paid_at: null,
    payment_attempt_ref: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(mockUser());
});

describe('listOrders', () => {
  it('filters by the verified user id (user_id = user.id)', async () => {
    const { client, builder } = createMockSupabase<OrderListItem[]>({
      data: [sampleRow()],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listOrders();

    expect(client.from).toHaveBeenCalledWith('orders');
    expect(builder.eq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('requests exactly the DTO columns and returns rows pass-through', async () => {
    const rows = [sampleRow(), sampleRow({ id: 'order-2' })];
    const { client, builder } = createMockSupabase<OrderListItem[]>({
      data: rows,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await listOrders();

    expect(builder.select).toHaveBeenCalledWith(ORDER_COLUMNS);
    expect(result).toEqual(rows);
  });

  it('orders by created_at descending and paginates by the configured page size', async () => {
    const { client, builder } = createMockSupabase<OrderListItem[]>({
      data: [sampleRow()],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await listOrders();

    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.range).toHaveBeenCalledWith(0, getOrdersPageSize() - 1);
  });

  it('returns an empty array when the query yields no data', async () => {
    const { client } = createMockSupabase<OrderListItem[]>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listOrders()).resolves.toEqual([]);
  });

  it('throws a safe Hebrew error when the query fails', async () => {
    const { client } = createMockSupabase<OrderListItem[]>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(listOrders()).rejects.toThrow('טעינת ההזמנות נכשלה');
  });
});

describe('getOrder', () => {
  it('fetches the detail DTO scoped to the owner and order id', async () => {
    const row = detailRow();
    const { client, builder } = createMockSupabase<OrderDetail>({
      data: row,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const result = await getOrder('order-1');

    expect(client.from).toHaveBeenCalledWith('orders');
    expect(builder.select).toHaveBeenCalledWith(ORDER_DETAIL_COLUMNS);
    expect(builder.eq).toHaveBeenCalledWith('id', 'order-1');
    expect(builder.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual(row);
  });

  it('calls notFound() when the order is missing or not owned', async () => {
    const { client } = createMockSupabase<OrderDetail>({
      data: null,
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getOrder('order-x')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(vi.mocked(notFound)).toHaveBeenCalled();
  });

  it('throws a safe Hebrew error when the query fails', async () => {
    const { client } = createMockSupabase<OrderDetail>({
      data: null,
      error: { message: 'db exploded' },
    });
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    await expect(getOrder('order-1')).rejects.toThrow('טעינת ההזמנה נכשלה');
  });
});
