import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/orders', () => ({ getOrder: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getSumitServerConfig: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
// SumitDeclinedError must stay the real class — the route uses `instanceof`.
vi.mock('@/lib/sumit/charge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sumit/charge')>();
  return { ...actual, chargeSumit: vi.fn() };
});

import { POST } from './route';
import { requireUser } from '@/lib/auth/dal';
import { getOrder } from '@/lib/data/orders';
import { getPaymentsEnabled, getSumitServerConfig } from '@/lib/data/payments';
import { createAdminClient } from '@/lib/supabase/admin';
import { chargeSumit } from '@/lib/sumit/charge';

const APP_ORIGIN = 'https://kalfa.test';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function request(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: APP_ORIGIN },
): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request(`${APP_ORIGIN}/api/orders/${ORDER_ID}/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: form.toString(),
  }) as unknown as NextRequest;
}

function callPost(req: NextRequest) {
  return POST(req, { params: Promise.resolve({ id: ORDER_ID }) });
}

// Minimal chainable stand-in for the supabase-js query builder: every chain
// method returns `this`, and the chain is awaitable directly (as the route
// does for the no-`.select()` update calls) as well as via `.single()` /
// `.maybeSingle()`.
function makeQueryResult(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['update', 'eq', 'in', 'select']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled: (value: typeof result) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

// The route issues two sequential `.from('orders')` calls (lock, then the
// paid/failure update) — return the matching canned result for each call in
// order.
function makeAdminMock(results: Array<{ data?: unknown; error?: unknown }>) {
  let call = 0;
  return {
    from: vi.fn(() => {
      const result = results[Math.min(call, results.length - 1)];
      call += 1;
      return makeQueryResult(result);
    }),
  };
}

describe('POST /api/orders/[id]/pay — CSRF origin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requireUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@test.com',
    } as never);
    vi.mocked(getOrder).mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      total_with_vat: 118,
      vat_rate: 18,
    } as never);
    vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
    vi.mocked(getSumitServerConfig).mockResolvedValue({
      companyId: 1,
      apiKey: 'k',
    });
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminMock([
        {
          data: {
            payment_attempt_ref: 'attempt-1',
            total_with_vat: 118,
            vat_rate: 18,
          },
          error: null,
        },
        { data: { id: ORDER_ID }, error: null },
      ]) as never,
    );
    vi.mocked(chargeSumit).mockResolvedValue({ documentId: 999 });
  });

  it('reaches chargeSumit for a same-origin POST', async () => {
    const res = await callPost(
      request({ 'og-token': 'og-123' }, { Origin: APP_ORIGIN }),
    );
    expect(chargeSumit).toHaveBeenCalled();
    expect(res.status).toBe(303);
  });

  it('rejects a cross-origin POST with 403, without calling chargeSumit', async () => {
    const res = await callPost(
      request({ 'og-token': 'og-123' }, { Origin: 'https://evil.test' }),
    );
    expect(res.status).toBe(403);
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('rejects a POST with no Origin and no Referer with 403, without calling chargeSumit', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }, {}));
    expect(res.status).toBe(403);
    expect(chargeSumit).not.toHaveBeenCalled();
  });
});
