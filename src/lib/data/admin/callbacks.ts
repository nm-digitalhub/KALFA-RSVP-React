import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import type { Database } from '@/lib/supabase/types';
import type { CallbackStatus } from '@/lib/validation/admin';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: callback (call-me-back) requests. Authorized by the request-scoped
// session under the `cb_admin_all` RLS policy, plus a server-side requireAdmin()
// gate. `status` is free text in the DB; the UI constrains writes to the
// CALLBACK_STATUSES vocabulary and renders unknown stored values via fallback.

type CallbackRow = Database['public']['Tables']['callback_requests']['Row'];

export type CallbackRequest = Pick<
  CallbackRow,
  'id' | 'full_name' | 'phone' | 'topic' | 'note' | 'status' | 'created_at' | 'updated_at'
>;

export const CALLBACK_COLUMNS =
  'id, full_name, phone, topic, note, status, created_at, updated_at';

// List callback requests, newest first, with exact total for pagination.
export async function listCallbackRequests(
  { page }: PageParams = {},
): Promise<PageResult<CallbackRequest>> {
  await requireAdmin();

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from('callback_requests')
    .select(CALLBACK_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error('טעינת בקשות החזרה נכשלה');
  }

  return {
    items: data ?? [],
    total: count ?? 0,
    page: safePage,
    pageSize,
  };
}

// Update a single callback request's status. The `status` is validated against
// the closed vocabulary by the caller (Server Action) before this runs. The
// `updated_at` column is maintained by a DB trigger / default; we set it
// explicitly to reflect the change time and keep behavior deterministic.
export async function updateCallbackStatus(
  id: string,
  status: CallbackStatus,
): Promise<void> {
  await requireAdmin();

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from('callback_requests')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  const { error } = await supabase
    .from('callback_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  await logActivity({
    action: 'callback.status_updated',
    meta: {
      callbackRequestId: id,
      previousStatus: current?.status ?? null,
      status,
    },
  });
}
