import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
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

// The detail view adds the scheduling columns the list deliberately omits: a
// list is for triage, this is the screen the calendar item links to while the
// phone is already ringing.
export type CallbackRequestDetail = CallbackRequest &
  Pick<CallbackRow, 'requested_at' | 'scheduled_at' | 'calendar_item_id' | 'attempt_count'>;

const CALLBACK_DETAIL_COLUMNS = `${CALLBACK_COLUMNS}, requested_at, scheduled_at, calendar_item_id, attempt_count`;

/**
 * One callback request, or null when the id does not exist.
 *
 * Returns null rather than throwing on a missing row so the page can render a
 * proper not-found instead of a server error — this URL is embedded in calendar
 * items that outlive the request they point at.
 */
export async function getCallbackRequest(id: string): Promise<CallbackRequestDetail | null> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .select(CALLBACK_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('טעינת בקשת החזרה נכשלה');
  return data ?? null;
}

/**
 * The callback request one calendar appointment was created for, or null.
 *
 * Keyed on the calendar item rather than on the request id, because the caller
 * holds an appointment and nothing else: /admin/calendar knows which item the
 * owner clicked. The partial unique index on `calendar_item_id` makes this at
 * most one row, so `maybeSingle` is exact rather than a "first of many".
 *
 * Null is the ordinary answer, not an error — most appointments in the mailbox
 * are the owner's own meetings and were never scheduled by this system.
 */
export async function getCallbackRequestByCalendarItem(
  calendarItemId: string,
): Promise<CallbackRequestDetail | null> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .select(CALLBACK_DETAIL_COLUMNS)
    .eq('calendar_item_id', calendarItemId)
    .maybeSingle();

  if (error) throw new Error('טעינת בקשת החזרה נכשלה');
  return data ?? null;
}

// List callback requests, newest first, with exact total for pagination.
export async function listCallbackRequests(
  { page }: PageParams = {},
): Promise<PageResult<CallbackRequest>> {
  await requirePlatformPermission('view_customer_data');

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = createAdminClient();
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
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
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
