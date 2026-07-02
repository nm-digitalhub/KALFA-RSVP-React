import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Keep the real unstable_rethrow (via importOriginal) so it genuinely
// recognizes a NEXT_REDIRECT digest exactly as it would in production —
// only redirect() itself is stubbed, matching the pattern used by
// guests-actions.test.ts / campaign-actions.test.ts.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn() };
});
vi.mock('@/lib/data/orders', () => ({
  listOrders: vi.fn(),
  ORDER_STATUS_LABELS: {},
}));
vi.mock('@/lib/data/payments', () => ({ getPaymentsEnabled: vi.fn() }));

import { listOrders } from '@/lib/data/orders';
import { getPaymentsEnabled } from '@/lib/data/payments';
import OrdersPage from './page';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/auth/login;307;',
});

// OrdersPage returns an unrendered React element tree (plain {type, props}
// objects) -- no DOM/rendering library needed to inspect it, matching this
// codebase's convention of not depending on @testing-library/react.
function findByRole(node: unknown, role: string): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => findByRole(n, role));
  const el = node as { props?: { role?: string; children?: unknown } };
  if (el.props?.role === role) return true;
  return findByRole(el.props?.children, role);
}

describe('OrdersPage', () => {
  it('propagates a NEXT_REDIRECT from listOrders (unauthenticated -> login) instead of rendering loadError', async () => {
    vi.mocked(getPaymentsEnabled).mockResolvedValue(false);
    vi.mocked(listOrders).mockRejectedValue(NEXT_REDIRECT);

    await expect(
      OrdersPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });

  it('converts a genuine load failure into the loadError UI, not a thrown error', async () => {
    vi.mocked(getPaymentsEnabled).mockResolvedValue(false);
    vi.mocked(listOrders).mockRejectedValue(new Error('טעינת ההזמנות נכשלה'));

    const tree = (await OrdersPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;

    expect(findByRole(tree, 'alert')).toBe(true);
  });

  it('renders the order list (no alert) on success', async () => {
    vi.mocked(getPaymentsEnabled).mockResolvedValue(false);
    vi.mocked(listOrders).mockResolvedValue([]);

    const tree = (await OrdersPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;

    expect(findByRole(tree, 'alert')).toBe(false);
  });
});
