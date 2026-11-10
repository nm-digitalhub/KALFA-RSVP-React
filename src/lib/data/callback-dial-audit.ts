import 'server-only';

import type { CallbackPolicy } from '@/lib/callbacks/schedule-policy';
import { CONSOLE_DIAL_AUDIT_ACTION } from '@/lib/data/console-calls';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TablesInsert } from '@/lib/supabase/types';

// The dial budget every AI dispatcher of a callback_requests row shares with
// human console dials: activity_log rows with action=CONSOLE_DIAL_AUDIT_ACTION
// and meta->>callback_request_id. Used by callback-request-attempts.ts
// (meeting-confirm) and sales-call-attempts.ts (sales-closing).

// Audited dials for this request inside the policy's attempt window.
// cap/window are admin-editable (CallbackPolicy.maxAttempts/attemptWindowMs,
// /admin/callbacks/policy) — the caller fetches the policy once and passes it
// in, rather than this function re-fetching it per call.
export async function countRecentAuditedCallbackDials(
  callbackRequestId: string,
  nowMs: number,
  policy: CallbackPolicy,
): Promise<number> {
  const admin = createAdminClient();
  const sinceIso = new Date(nowMs - policy.attemptWindowMs).toISOString();
  const { count, error } = await admin
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', CONSOLE_DIAL_AUDIT_ACTION)
    .eq('meta->>callback_request_id', callbackRequestId)
    .gte('created_at', sinceIso);
  if (error) return policy.maxAttempts; // unreadable ⇒ treat as capped (fail-closed, matches console-calls.ts)
  return count ?? 0;
}

// Write the SAME audit action a human console dial writes
// (recordConsoleDialAudit in console-calls.ts), so an AI-dispatched call
// becomes visible to whatever already reads CONSOLE_DIAL_AUDIT_ACTION rows
// for this callback_request_id — including countRecentAuditedCallbackDials
// above. user_id is null (no human agent chose this dial; a null user_id is
// the same convention recordRsvpFromCall/recordManualDialOutcome already use
// for a system-initiated activity_log row). Best-effort: a lost write
// degrades a cap's visibility for future dials, never the call that already
// happened.
export async function recordSystemCallbackDialAudit(callbackRequestId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    type ActivityLogInsert = TablesInsert<'activity_log'>;
    const row: ActivityLogInsert = {
      event_id: null,
      user_id: null,
      action: CONSOLE_DIAL_AUDIT_ACTION,
      meta: { callback_request_id: callbackRequestId } as ActivityLogInsert['meta'],
    };
    await admin.from('activity_log').insert(row);
  } catch {
    // Deliberately swallowed — see doc comment.
  }
}
