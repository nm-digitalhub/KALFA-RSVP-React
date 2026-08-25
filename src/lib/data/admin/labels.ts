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
  reopened: 'נפתחה מחדש',
};

export function contactStatusLabel(status: string): string {
  return (
    CONTACT_ONLY_STATUS_LABELS[status] ??
    (CONTACT_STATUS_LABELS as Record<string, string>)[status] ??
    status
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

export const WEBHOOK_KIND_LABELS: Record<string, string> = {
  message: 'הודעה',
  status: 'סטטוס',
};

export function webhookKindLabel(kind: string): string {
  return WEBHOOK_KIND_LABELS[kind] ?? kind;
}

export const WEBHOOK_KIND_VARIANTS: Record<string, BadgeVariant> = {
  message: 'info',
  status: 'neutral',
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
