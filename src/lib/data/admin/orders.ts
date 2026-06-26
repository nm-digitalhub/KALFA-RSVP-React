import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: ALL orders (read-only). Authorized by the request-scoped session under
// the `orders_admin_all` RLS policy plus a server-side requireAdmin() gate.
// No insert/update here — purchase/payment mutations are a separate, gated
// phase. The package name/tier and event name are embedded via FK so the list
// is readable without per-row lookups (no N+1).

type OrderRow = Database['public']['Tables']['orders']['Row'];

// Embedded related rows. PostgREST returns a single object (or null) for a
// many-to-one embed; we project only the safe display columns.
export interface OrderEmbeddedPackage {
  name: string;
  tier: string;
}
export interface OrderEmbeddedEvent {
  name: string;
}

// A `processing` order is considered stuck when it has been locked for longer
// than this — the server likely crashed between the atomic pay lock and the
// outcome handler. The window also protects in-flight charges: a `processing`
// row younger than this must NEVER be offered a reset. Derived at request time
// in this server-only module (never in a React render path).
const STUCK_PROCESSING_MS = 10 * 60 * 1000;

export type AdminOrder = Pick<
  OrderRow,
  | 'id'
  | 'status'
  | 'total_with_vat'
  | 'vat_rate'
  | 'with_ai_addon'
  | 'event_id'
  | 'package_id'
  | 'created_at'
  | 'payment_processing_started_at'
> & {
  package: OrderEmbeddedPackage | null;
  event: OrderEmbeddedEvent | null;
  // Computed server-side from payment_processing_started_at + the current clock,
  // so the page can render the "stuck" badge and reset CTA without reading the
  // clock during render (which would violate the React purity rule).
  isStuckProcessing: boolean;
};

// Column projection including the embedded resources. The embed aliases
// (`package:packages`, `event:events`) disambiguate the relationship and shape
// the returned key names. This string IS the DTO contract.
export const ADMIN_ORDER_COLUMNS =
  'id, status, total_with_vat, vat_rate, with_ai_addon, event_id, package_id, created_at, payment_processing_started_at, package:packages(name, tier), event:events(name)';

// List all orders, newest first, with exact total for pagination.
export async function listAllOrders(
  { page }: PageParams = {},
): Promise<PageResult<AdminOrder>> {
  await requireAdmin();

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from('orders')
    .select(ADMIN_ORDER_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error('טעינת ההזמנות נכשלה');
  }

  // The embed types are inferred loosely by the generated client; the select
  // string above pins the exact shape, so we assert it through unknown. The
  // projected columns are display-only and contain no PII beyond order metadata.
  // Inject the request-time `isStuckProcessing` flag via .map() (not a blanket
  // cast) so the derived field actually exists at runtime.
  const now = Date.now();
  const items = (data ?? []).map((order) => {
    const row = order as unknown as Omit<AdminOrder, 'isStuckProcessing'>;
    return {
      ...row,
      isStuckProcessing:
        row.status === 'processing' &&
        row.payment_processing_started_at != null &&
        now - new Date(row.payment_processing_started_at).getTime() >
          STUCK_PROCESSING_MS,
    } satisfies AdminOrder;
  });

  return {
    items,
    total: count ?? 0,
    page: safePage,
    pageSize,
  };
}
