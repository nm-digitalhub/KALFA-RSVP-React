import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getSalesRequestForAttempt } from '@/lib/data/sales-call-attempts';
import { rescheduleCallbackRequest } from '@/lib/data/callback-scheduling';
import { insertContactMessage } from '@/lib/data/inquiry-intake';
import { INQUIRY_TOPICS } from '@/lib/validation/inquiries';
import type { Database } from '@/lib/supabase/types';
import type {
  VoxNotifyOwner,
  VoxRequestReschedule,
  VoxSalesEscalate,
} from '@/lib/validation/voximplant';

// Processing functions for the sales-closing agent's 3 REUSED tools
// (mark_dnc / notify_owner / schedule_callback — sales-closing-agent-script-
// draft.md §3: "reused unchanged from RSVPAgent's existing registered
// tools"). Same isolation discipline as callback-voice-processing.ts (which
// this mirrors): every identity resolution goes through
// getSalesRequestForAttempt, never call_attempts — a bug here structurally
// cannot reach RSVP/billing state.
//
// get_pricing / apply_discount_tier / send_signup_link / escalate_to_human /
// log_outcome (the 5 genuinely NEW tools) live in their own route files —
// each is a single small operation, not worth a shared processing module.

// `mark_dnc`: upserts into call_dnc_list — the SAME table/key
// processCallDnc (RSVP) and processMeetingOptOut (meeting-confirm) already
// use. Durably queued by the route (webhook_inbox), same real spam-law
// weight as those two.
export async function processSalesOptOut(attemptId: string): Promise<{ ok: boolean }> {
  const ref = await getSalesRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const admin = createAdminClient();
  const { error } = await admin.from('call_dnc_list').upsert(
    { normalized_phone: ref.phone, reason: 'בקשת ליד בשיחת מכירה' },
    { onConflict: 'normalized_phone' },
  );
  if (error) return { ok: false };
  return { ok: true };
}

export async function processSalesOptOutRow(
  row: Database['public']['Tables']['webhook_inbox']['Row'],
): Promise<void> {
  if (!row.message_id) return;
  await processSalesOptOut(row.message_id);
}

// `notify_owner`: relay an unanswerable question/flag. Same mechanism as
// escalate_to_human below (insertContactMessage → the existing
// TOPIC_TO_QUEUE_KEY routing + Slack alert) — the two tools differ only in
// urgency/wording on the agent's own side, not in the server mechanism,
// exactly like meeting-confirm's escalate_to_queue.
export async function processSalesNotifyOwner(
  attemptId: string,
  body: VoxNotifyOwner,
): Promise<{ ok: boolean }> {
  const ref = await getSalesRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const topic = (INQUIRY_TOPICS as readonly string[]).includes(ref.topic ?? '')
    ? (ref.topic as (typeof INQUIRY_TOPICS)[number])
    : 'אחר';

  return insertContactMessage(
    { name: ref.fullName, phone: ref.phone, topic, message: body.text },
    null,
  );
}

// `escalate_to_human`: no live-transfer mechanism in v1 (route's own
// header) — raises the same contact_messages/Slack queue notify_owner uses,
// with an urgency-flavored message so the admin queue can tell the two
// apart even though the mechanism is identical.
export async function processSalesEscalate(
  attemptId: string,
  body: VoxSalesEscalate,
): Promise<{ ok: boolean }> {
  const ref = await getSalesRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const topic = (INQUIRY_TOPICS as readonly string[]).includes(ref.topic ?? '')
    ? (ref.topic as (typeof INQUIRY_TOPICS)[number])
    : 'אחר';

  return insertContactMessage(
    { name: ref.fullName, phone: ref.phone, topic, message: `בקשה לנציג אנושי בשיחת מכירה — ${body.reason}` },
    null,
  );
}

// `schedule_callback`: reuses rescheduleCallbackRequest verbatim — same
// mechanism processMeetingReschedule already uses. No confirmation-status
// claim (sales_call_attempts has no such column; a repeat call in the same
// conversation is just another reschedule, harmless).
export async function processSalesScheduleCallback(
  attemptId: string,
  body: VoxRequestReschedule,
): Promise<{ ok: boolean }> {
  const iso = body.callback_iso;
  const isValidFutureIso =
    typeof iso === 'string' && iso.length > 0 && Number.isFinite(Date.parse(iso)) && Date.parse(iso) > Date.now();
  if (!isValidFutureIso) return { ok: false };

  const ref = await getSalesRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const outcome = await rescheduleCallbackRequest(ref.callbackRequestId, iso);
  return { ok: outcome.ok };
}
