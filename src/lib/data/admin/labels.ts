import type { Enums } from '@/lib/supabase/types';
import type { CallbackStatus, CallOutcome, ContactStatus } from '@/lib/validation/admin';
import type { BadgeVariant } from '@/components/ui/badge';

// Pure label maps — safe to import from both Server and Client Components, so
// this module must NOT import `server-only` (the admin status form is a client
// component and imports these labels).
// Hebrew display labels for the admin panel. Enum-backed maps use exhaustive
// `Record<Enum, string>` so a new enum value becomes a COMPILE error (forcing a
// translation) rather than a silently-untranslated UI string. The free-text
// callback status uses a partial map plus a `?? value` fallback in the UI.
type AppRole = Enums<'app_role'>;

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  admin: 'מנהל',
  user: 'משתמש',
};

// callback_requests.status — SCHEDULING status, redesigned 2026-08-19/20 (see
// the vocabulary's own comment in validation/admin.ts for the full reasoning:
// this describes what the scheduler did, never what the owner did with the
// call). Free text in the DB → known tokens get a label, unknown values fall
// back to the raw string at the call site (`LABELS[s] ?? s`).
export const CALLBACK_STATUS_LABELS: Record<CallbackStatus, string> = {
  new: 'חדש',
  pending_schedule: 'ממתינה לשיבוץ',
  scheduled: 'שובצה ביומן',
  needs_reschedule: 'נדרש תיאום מחדש',
  unschedulable: 'לא ניתן לתאם',
  cancelled: 'בוטלה',
  closed: 'הסתיימה',
};

// Semantic tone per scheduling status, for the admin list/detail badges.
export const CALLBACK_STATUS_VARIANTS: Record<CallbackStatus, BadgeVariant> = {
  new: 'neutral',
  pending_schedule: 'info',
  scheduled: 'success',
  needs_reschedule: 'warning',
  unschedulable: 'destructive',
  cancelled: 'neutral',
  closed: 'neutral',
};

// Safe label for any stored status string (handles legacy/foreign values).
export function callbackStatusLabel(status: string): string {
  return (CALLBACK_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

// Safe variant for any stored status string — same fallback shape as the
// label above. `status` is a free-text DB column, so its generated type is
// plain `string`, never the narrow CallbackStatus union.
export function callbackStatusVariant(status: string): BadgeVariant {
  return (CALLBACK_STATUS_VARIANTS as Record<string, BadgeVariant>)[status] ?? 'neutral';
}

// callback_requests.call_outcome — what happened when the owner actually made
// the call. A fully separate dimension from `status` above (see
// validation/admin.ts).
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  pending: 'טרם התקיימה',
  completed: 'השיחה התקיימה',
  no_answer: 'הלקוח לא ענה',
  needs_followup: 'נדרשת שיחת המשך',
  closed: 'נסגרה ללא המשך',
};

// 'no_contact' is deliberately NOT in CALL_OUTCOMES/CALL_OUTCOME_LABELS above
// — it is never a pickable option in CallOutcomeForm, only system-set by
// applyCallOutcome after three consecutive no_answer outcomes (same "system-
// only, not offered as a choice" shape as CONTACT_ONLY_STATUS_LABELS below).
const CALL_OUTCOME_SYSTEM_ONLY_LABELS: Record<string, string> = {
  no_contact: 'לא נוצר קשר לאחר 3 ניסיונות',
};

export function callOutcomeLabel(outcome: string): string {
  return (
    CALL_OUTCOME_SYSTEM_ONLY_LABELS[outcome] ??
    (CALL_OUTCOME_LABELS as Record<string, string>)[outcome] ??
    outcome
  );
}

// callback_requests.scheduling_failure_reason — the machine token
// markUnschedulable/scheduleCallbackAppointment writes (see callback-scheduling.ts
// and schedule-policy.ts's SlotFailureReason). Surfaced on the detail page
// (status === 'unschedulable') — a raw English token there would be the one
// untranslated string in an otherwise Hebrew-first admin panel.
export const SCHEDULING_FAILURE_LABELS: Record<string, string> = {
  unreadable_preference: 'לא ניתן היה לקרוא את המועד המבוקש',
  invalid_constraints: 'האילוצים שחולצו מהפנייה סותרים זה את זה',
  no_slot_within_constraints: 'לא נמצא מועד פנוי בתוך האילוצים שהתקבלו',
  no_slot_within_horizon: 'לא נמצא מועד פנוי בטווח התזמון',
};

export function schedulingFailureLabel(reason: string): string {
  return SCHEDULING_FAILURE_LABELS[reason] ?? reason;
}

// contact_messages.status — its own independent vocabulary (see
// validation/admin.ts: this used to reuse the callback vocabulary directly,
// before that vocabulary was redesigned into scheduling-specific states that
// have no meaning for a contact-form message). `reopened` is a fifth value
// contact_messages can carry — a customer wrote back on an already-answered
// thread — but is system-set only, never offered as a pickable option, so it
// stays a separate fallback layer rather than a sixth CONTACT_STATUS_LABELS
// entry (a picklist built from Object.keys would offer it otherwise).
export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  done: 'טופל',
  cancelled: 'בוטל',
};

const CONTACT_ONLY_STATUS_LABELS: Record<string, string> = {
  // NOT "נפתחה מחדש" (reopened) — the underlying status value is set on ANY
  // customer reply to a non-cancelled row, whether it was previously 'done'
  // (a genuine reopen) or still 'new'/'in_progress' (never closed at all,
  // just a reply on an active thread). Since the code doesn't track which of
  // the two applies (attachReplyToInquiry sets this status unconditionally),
  // the label has to describe what's true in both cases: a customer reply is
  // waiting on an admin response — not that something was "reopened."
  // Verified live 2026-08-26: before this label change every real occurrence
  // of this status was a thread that had never been closed (in_progress →
  // reopened), so "reopened" was actively misleading, not just imprecise.
  reopened: 'הלקוח השיב — ממתינה למענה',
};

export function contactStatusLabel(status: string): string {
  return (
    CONTACT_ONLY_STATUS_LABELS[status] ??
    (CONTACT_STATUS_LABELS as Record<string, string>)[status] ??
    status
  );
}

// Semantic tone per inquiry status, for the admin list/detail badges — same
// shape as CALLBACK_STATUS_VARIANTS above. `reopened` gets its own entry
// (not in CONTACT_STATUS_LABELS's closed picklist) since it is a real,
// filterable status a row can carry, just never one an admin sets directly.
export const CONTACT_STATUS_VARIANTS: Record<ContactStatus, BadgeVariant> = {
  new: 'info',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'neutral',
};

const CONTACT_ONLY_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  reopened: 'destructive',
};

export function contactStatusVariant(status: string): BadgeVariant {
  return (
    CONTACT_ONLY_STATUS_VARIANTS[status] ??
    (CONTACT_STATUS_VARIANTS as Record<string, BadgeVariant>)[status] ??
    'neutral'
  );
}

// --- Webhook inspector (free-text columns → partial map + fallback) ---

// Derived processing state of a webhook_inbox row. `processed_at` wins (terminal);
// a `last_error` without it means errored-and-retrying; otherwise pending.
export type WebhookState = 'pending' | 'processed' | 'error';

export function webhookProcessState(row: {
  processed_at: string | null;
  last_error: string | null;
}): WebhookState {
  if (row.processed_at) return 'processed';
  if (row.last_error) return 'error';
  return 'pending';
}

export const WEBHOOK_PROCESS_LABELS: Record<WebhookState, string> = {
  pending: 'ממתין',
  processed: 'עובד',
  error: 'שגיאה',
};

export const WEBHOOK_PROCESS_VARIANTS: Record<WebhookState, BadgeVariant> = {
  pending: 'warning',
  processed: 'success',
  error: 'destructive',
};

// webhook_inbox rows come from FOUR integrations across NINE routes. VERIFIED
// 2026-08-26 by enumerating every insertWebhookEvents call site — the labels
// below cover all of them, so no badge falls back to a raw English slug in a
// Hebrew RTL admin (7 of the 9 previously did).
export const WEBHOOK_PROVIDER_LABELS: Record<string, string> = {
  whatsapp: 'וואטסאפ',
  graph: 'דואר Microsoft',
  voximplant: 'שיחות קוליות',
  resend: 'דואר יוצא (Resend)',
  elevenlabs: 'ניתוח שיחות AI',
};

export function webhookProviderLabel(provider: string): string {
  return WEBHOOK_PROVIDER_LABELS[provider] ?? provider;
}

// event_kind identifies the individual route (1:1, except /api/webhooks/whatsapp
// which emits both 'message' and 'status').
export const WEBHOOK_KIND_LABELS: Record<string, string> = {
  message: 'הודעה נכנסת',
  status: 'סטטוס מסירה',
  graph_mail: 'דואר נכנס',
  email_delivery: 'מסירת דואר יוצא',
  call_result: 'תוצאת שיחה',
  call_rsvp: 'אישור הגעה בשיחה',
  call_owner_note: 'הערה מהשיחה',
  call_dnc: 'בקשת הסרה (RSVP)',
  mtg_dnc: 'בקשת הסרה (פגישות)',
  sls_dnc: 'בקשת הסרה (מכירות)',
  el_analysis_rsvp: 'ניתוח שיחה (אישורי הגעה)',
  el_analysis_sales: 'ניתוח שיחה (מכירות)',
};

export function webhookKindLabel(kind: string): string {
  return WEBHOOK_KIND_LABELS[kind] ?? kind;
}

// --- Sales AI call analysis ---

export const CALL_ANALYSIS_SUCCESSFUL_LABELS: Record<string, string> = {
  success: 'הצליחה',
  failure: 'נכשלה',
  unknown: 'לא ידוע',
};

export function callAnalysisSuccessfulLabel(value: string | null): string {
  return value ? CALL_ANALYSIS_SUCCESSFUL_LABELS[value] ?? value : 'לא ידוע';
}

export const CALL_ANALYSIS_STATUS_LABELS: Record<string, string> = {
  done: 'הסתיים',
  failed: 'נכשל',
  unknown: 'לא ידוע',
};

export function callAnalysisStatusLabel(value: string | null): string {
  return value ? CALL_ANALYSIS_STATUS_LABELS[value] ?? value : 'לא ידוע';
}

export const SALES_DISPATCH_STATUS_LABELS: Record<string, string> = {
  queued: 'בתור',
  dialing: 'מחייג',
  in_progress: 'בשיחה',
  concluded: 'הסתיימה',
  failed_to_start: 'נכשלה בהתחלה',
  start_unknown: 'מצב התחלה לא ידוע',
};

export function salesDispatchStatusLabel(value: string): string {
  return SALES_DISPATCH_STATUS_LABELS[value] ?? value;
}

// sales_call_attempts.finish_reason — the TELEPHONY's verdict, written by
// Voximplant the moment the call ends (voxSalesCallbackSchema's call_status,
// or its free-text error_reason when the scenario reports one). A different
// thing from call_analysis.termination_reason, which is ElevenLabs' English
// sentence about why the CONVERSATION ended and only arrives with the post-call
// analysis — the screen falls back from that to this (see mapSalesCall), so
// this map must pass an unrecognised value through unchanged: an ElevenLabs
// sentence is exactly what arrives here on the other branch.
//
// 'no_response' is not 'no_answer': the call connected, nobody spoke. Both feed
// the same reachability signal (call-result-processing.ts) but they are
// different facts to whoever is deciding whether to dial again.
export const SALES_FINISH_REASON_LABELS: Record<string, string> = {
  completed: 'הסתיימה תקין',
  no_answer: 'אין מענה',
  no_response: 'נענתה, ללא תגובה',
  failed: 'נכשלה',
};

export function salesFinishReasonLabel(value: string): string {
  return SALES_FINISH_REASON_LABELS[value] ?? value;
}

// call_analysis.sentiment_label — ElevenLabs' read of how the CALLER sounded,
// constrained to this closed set by the column's own CHECK.
// Which persona placed an AI call. Shown per card because the same screen now
// lists both, and "the AI called" means something different in each.
export const AI_CALL_SOURCE_LABELS: Record<string, string> = {
  sales: 'שיחת מכירות',
  meeting_confirm: 'אישור פגישה',
};

export function aiCallSourceLabel(value: string): string {
  return AI_CALL_SOURCE_LABELS[value] ?? value;
}

// callback_request_attempts.confirmation_call_status — the confirmation call's
// own answer, which no other persona has.
export const CONFIRMATION_CALL_STATUS_LABELS: Record<string, string> = {
  confirmed: 'הלקוח אישר',
  cancelled: 'הלקוח ביטל',
  reschedule_requested: 'ביקש מועד אחר',
  no_answer: 'לא ענה',
  pending: 'טרם נענה',
};

export function confirmationCallStatusLabel(value: string): string {
  return CONFIRMATION_CALL_STATUS_LABELS[value] ?? value;
}

export const SENTIMENT_LABELS: Record<string, string> = {
  positive: 'הלקוח נשמע חיובי',
  neutral: 'הלקוח נשמע ניטרלי',
  negative: 'הלקוח נשמע שלילי',
};

export function sentimentLabel(value: string): string {
  return SENTIMENT_LABELS[value] ?? value;
}

export const EVALUATION_RESULT_LABELS: Record<string, string> = {
  success: 'עבר',
  failure: 'נכשל',
  unknown: 'לא ידוע',
};

export function evaluationResultLabel(value: string): string {
  return EVALUATION_RESULT_LABELS[value] ?? value;
}

export const WEBHOOK_KIND_VARIANTS: Record<string, BadgeVariant> = {
  message: 'info',
  status: 'neutral',
  graph_mail: 'info',
  email_delivery: 'neutral',
  call_result: 'neutral',
  call_rsvp: 'success',
  call_owner_note: 'info',
  // Every DNC kind is an opt-out request — a legal obligation under the Israeli
  // spam law, so it must stand out in the list rather than read as routine.
  call_dnc: 'warning',
  mtg_dnc: 'warning',
  sls_dnc: 'warning',
};

// contact_interactions.delivery_status holds Meta's status values (free text).
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: 'נשלח',
  delivered: 'נמסר',
  read: 'נקרא',
  failed: 'נכשל',
};

export function deliveryStatusLabel(status: string): string {
  return DELIVERY_STATUS_LABELS[status] ?? status;
}

export const DELIVERY_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  sent: 'neutral',
  delivered: 'info',
  read: 'success',
  failed: 'destructive',
};

export function deliveryStatusVariant(status: string | null): BadgeVariant {
  return status ? DELIVERY_STATUS_VARIANTS[status] ?? 'neutral' : 'neutral';
}
