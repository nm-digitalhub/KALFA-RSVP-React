import 'server-only';

import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { getOrdersPageSize } from '@/lib/constants';
import type { Database } from '@/lib/supabase/types';

type OrderRow = Database['public']['Tables']['orders']['Row'];
export type OrderStatus = Database['public']['Enums']['order_status'];

// Label map now lives in src/lib/constants.ts (no `server-only`) so client
// components can import it directly; re-exported here for existing callers.
export { ORDER_STATUS_LABELS } from '@/lib/constants';

// DTO: only the columns the orders list needs. The orders table has no
// updated_at / paid_at column, so those are intentionally absent.
export type OrderListItem = Pick<
  OrderRow,
  | 'id'
  | 'status'
  | 'total_with_vat'
  | 'vat_rate'
  | 'with_ai_addon'
  | 'event_id'
  | 'package_id'
  | 'created_at'
>;

// This string IS the DTO contract — listOrders returns rows pass-through.
const ORDER_COLUMNS =
  'id, status, total_with_vat, vat_rate, with_ai_addon, event_id, package_id, created_at';

export interface ListOrdersParams {
  limit?: number;
  offset?: number;
}

// List the current user's orders (read-only). Explicit user_id filter scoped to
// the verified session, in addition to RLS. Newest first.
export async function listOrders(
  { limit = getOrdersPageSize(), offset = 0 }: ListOrdersParams = {},
): Promise<OrderListItem[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error('טעינת ההזמנות נכשלה');
  }

  return data ?? [];
}

export type OrderDetail = Pick<
  OrderRow,
  | 'id' | 'status' | 'total_with_vat' | 'vat_rate' | 'with_ai_addon'
  | 'event_id' | 'package_id' | 'sumit_document_id' | 'paid_at'
  | 'payment_attempt_ref' | 'created_at'
>;

// Single string literal (NOT concatenated): PostgREST's typed .select() infers the
// row type only from a literal. A concatenated string collapses to `string`, yielding
// GenericStringError and breaking the OrderDetail cast (TS2352). Mirrors ORDER_COLUMNS.
const ORDER_DETAIL_COLUMNS =
  'id, status, total_with_vat, vat_rate, with_ai_addon, event_id, package_id, sumit_document_id, paid_at, payment_attempt_ref, created_at';

// Read-only. Uses user client (RLS scoped). No status mutation here.
// [NF] notFound() throws NEXT_HTTP_ERROR_FALLBACK;404 — propagates to callers.
//   In Server Components → renders not-found.tsx. In Route Handler → caught → 303.
// Imports at top: add `notFound` from 'next/navigation'.
export async function getOrder(orderId: string): Promise<OrderDetail> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_DETAIL_COLUMNS)
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new Error('טעינת ההזמנה נכשלה');
  if (!data) notFound();
  return data as OrderDetail;
}
