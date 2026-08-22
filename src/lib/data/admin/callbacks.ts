import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  applyCallOutcome,
  closeCallbackAppointment,
  rescheduleCallbackRequest,
  type RescheduleOutcome,
} from '@/lib/data/callback-scheduling';
import type { Database } from '@/lib/supabase/types';
import type { CallOutcome } from '@/lib/validation/admin';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: callback (call-me-back) requests. Authorized by the request-scoped
// session under the `cb_admin_all` RLS policy, plus a server-side requireAdmin()
// gate. `status` and `call_outcome` are free text in the DB; the UI constrains
// writes to the closed vocabularies in validation/admin.ts and renders
// unknown stored values via fallback.
//
// Two independent dimensions since the 2026-08-19/20 redesign (see
// validation/admin.ts for the full reasoning): `status` is the SCHEDULER's
// state (system-driven, admin only ever sets 'cancelled' — see
// cancelCallback), `call_outcome` is what the OWNER recorded after making the
// call (admin-set — see updateCallOutcome). Never conflate the two again.

type CallbackRow = Database['public']['Tables']['callback_requests']['Row'];

export type CallbackRequest = Pick<
  CallbackRow,
  | 'id'
  | 'full_name'
  | 'phone'
  | 'topic'
  | 'note'
  | 'status'
  | 'call_outcome'
  | 'scheduled_at'
  | 'created_at'
  | 'updated_at'
>;

export const CALLBACK_COLUMNS =
  'id, full_name, phone, topic, note, status, call_outcome, scheduled_at, created_at, updated_at';

// The detail view adds the scheduling columns the list deliberately omits: a
// list is for triage, this is the screen the calendar item links to while the
// phone is already ringing.
export type CallbackRequestDetail = CallbackRequest &
  Pick<
    CallbackRow,
    | 'requested_at'
    | 'calendar_item_id'
    | 'attempt_count'
    | 'scheduling_failure_reason'
    | 'consecutive_no_answer_count'
  >;

const CALLBACK_DETAIL_COLUMNS = `${CALLBACK_COLUMNS}, requested_at, calendar_item_id, attempt_count, scheduling_failure_reason, consecutive_no_answer_count`;

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

// Cancel a request outright — the ONE scheduling-status transition an admin
// makes directly (every other `status` value is system-driven; see
// validation/admin.ts). The `updated_at` column is maintained by a DB
// trigger; we don't set it explicitly here, unlike the pre-redesign version
// of this function — cb_set_updated_at (migration
// 20260819212112_callback_status_outcome_split.sql) handles it on every
// UPDATE now, so a second explicit write would just be redundant.
export async function cancelCallback(id: string): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('callback_requests')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('ביטול הבקשה נכשל');
  }

  const { error } = await supabase
    .from('callback_requests')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) {
    throw new Error('ביטול הבקשה נכשל');
  }

  // A cancelled request needs no future call — its calendar appointment is
  // archived (never deleted; see closeCallbackAppointment) so there's still a
  // record it existed and was cancelled, not just silence. Best-effort and
  // never blocks the cancellation itself.
  const calendarAppointmentArchived = (
    await closeCallbackAppointment(id, { reason: 'cancelled' })
  ).archived;

  await logActivity({
    action: 'callback.cancelled',
    meta: {
      callbackRequestId: id,
      previousStatus: current?.status ?? null,
      calendarAppointmentArchived,
    },
  });
}

// Records what happened when the owner actually made the call — independent
// of `status` (the scheduler's own state; see cancelCallback above and
// validation/admin.ts). Delegates the actual state machine (archive the
// appointment, decide whether the REQUEST closes or re-enters scheduling,
// the three-strikes no-contact auto-close + SMS) to applyCallOutcome — same
// gate-wraps-logic split as rescheduleCallback below wrapping
// rescheduleCallbackRequest.
export async function updateCallOutcome(
  id: string,
  callOutcome: CallOutcome,
): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('callback_requests')
    .select('call_outcome')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('עדכון תוצאת השיחה נכשל');
  }

  const result = await applyCallOutcome(id, callOutcome);

  await logActivity({
    action: 'callback.outcome_updated',
    meta: {
      callbackRequestId: id,
      previousOutcome: current?.call_outcome ?? null,
      callOutcome,
      calendarAppointmentArchived: result.archived,
      requestClosed: result.requestClosed,
    },
  });
}

/**
 * Admin-gated wrapper around rescheduleCallbackRequest — mirrors how
 * cancelCallback above gates its own write and then calls the request-free
 * closeCallbackAppointment. rescheduleCallbackRequest lives in
 * callback-scheduling.ts REQUEST-FREE (no requireUser/cookies, so the worker
 * bundle can import that module), so it carries no authorization of its own;
 * this is the only path a browser request can reach it through.
 */
export async function rescheduleCallback(
  id: string,
  exactIso: string,
): Promise<RescheduleOutcome> {
  await requirePlatformPermission('view_customer_data');

  const outcome = await rescheduleCallbackRequest(id, exactIso);

  await logActivity({
    action: 'callback.rescheduled',
    meta: { callbackRequestId: id, ok: outcome.ok, ...(outcome.ok ? {} : { reason: outcome.reason }) },
  });

  return outcome;
}
