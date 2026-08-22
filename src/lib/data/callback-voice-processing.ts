import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  claimCallbackVoiceOutcome,
  getCallbackRequestForAttempt,
} from '@/lib/data/callback-request-attempts';
import { rescheduleCallbackRequest } from '@/lib/data/callback-scheduling';
import { createContactMessage } from '@/lib/data/inquiries';
import { INQUIRY_TOPICS } from '@/lib/validation/inquiries';
import type { Database } from '@/lib/supabase/types';
import type {
  VoxMeetingEscalate,
  VoxRequestReschedule,
} from '@/lib/validation/voximplant';

// Processing functions for the meeting-booking agent's 4 tool calls
// (mtg/cb/*/[token] — docs/voice-agent/plans/2026-08-22-meeting-booking-agent-
// plan.md §4). Deliberately a SEPARATE module from call-result-processing.ts:
// that file's functions all resolve identity through call_attempts
// (RSVP/billing); nothing here ever touches that table, so a bug in this file
// structurally cannot reach RSVP or billing state — the isolation the plan's
// §7 explicitly calls for ("לעולם לא ייגע ב-RSVP/חיוב").
//
// All 4 are called SYNCHRONOUSLY from their route (no webhook_inbox queue):
// unlike call_attempts' cb/[token] (where a lost callback would silently lose
// an RSVP or a billing event), every write here either has no external side
// effect (confirm/escalate) or is a case the AGENT's own conversation script
// already handles on failure (reschedule — §3's critical note: the agent
// never speaks a time the system hasn't confirmed, so a synchronous ok:false
// naturally routes to escalate_to_queue instead of silently retrying later).
// mark_opt_out is the one exception with real legal weight if lost — see its
// own comment below for why it still gets webhook_inbox durability.

// `confirm_meeting`: log-only, idempotent. A repeat call in the same
// conversation (or a stale replayed one) is a no-op — the claim's own
// one-shot WHERE clause makes that safe either way.
export async function processMeetingConfirm(attemptId: string): Promise<{ ok: boolean }> {
  await claimCallbackVoiceOutcome(attemptId, 'confirmed');
  return { ok: true };
}

// `request_reschedule`: reuses rescheduleCallbackRequest verbatim (§4: "הפונקציה
// הקיימת, לא חדשה"). The claim itself is the "log" half (always recorded,
// regardless of whether a usable ISO came with it); the calendar-affecting
// half only runs when callback_iso parses to a real, FUTURE instant — an
// unusable/missing iso intentionally does NOT touch the calendar (§4: "אם
// אין/לא תקין → אין כתיבה ליומן"). ok:false covers both "already claimed by
// an earlier tool call this session" and "reschedule itself failed" — the
// agent's script treats either the same way (escalate_to_queue).
export async function processMeetingReschedule(
  attemptId: string,
  body: VoxRequestReschedule,
): Promise<{ ok: boolean }> {
  const claim = await claimCallbackVoiceOutcome(attemptId, 'reschedule_requested');
  if (!claim.applied) return { ok: false };

  const iso = body.callback_iso;
  const isValidFutureIso =
    typeof iso === 'string' && iso.length > 0 && Number.isFinite(Date.parse(iso)) && Date.parse(iso) > Date.now();
  if (!isValidFutureIso) return { ok: false };

  const ref = await getCallbackRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const outcome = await rescheduleCallbackRequest(ref.callbackRequestId, iso);
  return { ok: outcome.ok };
}

// `mark_opt_out`: upserts into call_dnc_list — the SAME table/key
// processCallDnc already upserts into for the RSVP agent's mark_dnc, per §4's
// correction ("לא עמודה חדשה"). Unlike the other 3 meeting tools this one IS
// also durably queued (webhook_inbox, event_kind='mtg_dnc', its own dedicated
// drain case — never call_dnc, so it can never touch call_attempts/RSVP/
// billing code): a lost opt-out is a real spam-law exposure
// (§30א/§16ג-class risk, same reasoning CLAUDE.md's messaging-consent rules
// apply), not a merely-inconvenient failure like a lost log entry. The
// synchronous call below is the fast path; the queued row is the retry
// backstop if it throws.
export async function processMeetingOptOut(attemptId: string): Promise<{ ok: boolean }> {
  const ref = await getCallbackRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const admin = createAdminClient();
  const { error } = await admin.from('call_dnc_list').upsert(
    { normalized_phone: ref.phone, reason: 'בקשת ליד בשיחת קביעת/אישור פגישה' },
    { onConflict: 'normalized_phone' },
  );
  if (error) return { ok: false };

  await claimCallbackVoiceOutcome(attemptId, 'opted_out');
  return { ok: true };
}

export async function processMeetingOptOutRow(
  row: Database['public']['Tables']['webhook_inbox']['Row'],
): Promise<void> {
  if (!row.message_id) return;
  await processMeetingOptOut(row.message_id);
}

// `escalate_to_queue`: writes into contact_messages/console_queues through the
// SAME mechanism the public contact/callback forms already use (§4: "לא ערוץ
// חדש") — createContactMessage resolves the queue via TOPIC_TO_QUEUE_KEY and
// fires the SAME (pre-existing) Slack alert that mechanism already fires; this
// function never calls Slack directly (§4: "לא ל-Slack ישירות"). No
// confirmation_call_status claim here on purpose — that enum has no
// 'escalated' value (§4's table lists it as a pure queue write, not a call
// outcome), and multiple escalations in one call are each just another
// contact_messages row, same as createContactMessage's own no-guard behavior.
const ESCALATION_REASON_HE: Record<VoxMeetingEscalate['reason'], string> = {
  wrong_person: 'זוהה אדם לא נכון בשיחה',
  substantive_question: 'עלתה שאלה מהותית שהצריכה הפניה',
  unclear_reschedule: 'בקשת שינוי מועד שלא ניתן היה לפרש בבירור',
  bad_line: 'קו גרוע / ניתוק',
  other: 'אחר',
};

export async function processMeetingEscalate(
  attemptId: string,
  body: VoxMeetingEscalate,
): Promise<{ ok: boolean }> {
  const ref = await getCallbackRequestForAttempt(attemptId);
  if (!ref) return { ok: false };

  const topic = (INQUIRY_TOPICS as readonly string[]).includes(ref.topic ?? '')
    ? (ref.topic as (typeof INQUIRY_TOPICS)[number])
    : 'אחר';

  const reasonHe = ESCALATION_REASON_HE[body.reason];
  const message = body.note_he ? `${reasonHe} — ${body.note_he}` : `${reasonHe} (מהסוכן הקולי לקביעת פגישות)`;

  return createContactMessage(
    { name: ref.fullName, phone: ref.phone, topic, message },
    null,
  );
}
