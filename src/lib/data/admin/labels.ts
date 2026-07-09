import type { Database } from '@/lib/supabase/types';
import type { CallbackStatus } from '@/lib/validation/admin';
import type { BadgeVariant } from '@/components/ui/badge';

// Pure label maps — safe to import from both Server and Client Components, so
// this module must NOT import `server-only` (the admin status form is a client
// component and imports these labels).
// Hebrew display labels for the admin panel. Enum-backed maps use exhaustive
// `Record<Enum, string>` so a new enum value becomes a COMPILE error (forcing a
// translation) rather than a silently-untranslated UI string. The free-text
// callback status uses a partial map plus a `?? value` fallback in the UI.
type AppRole = Database['public']['Enums']['app_role'];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  admin: 'מנהל',
  user: 'משתמש',
};

// callback_requests.status is free text → known tokens get a label, unknown
// values fall back to the raw string at the call site (`LABELS[s] ?? s`).
export const CALLBACK_STATUS_LABELS: Record<CallbackStatus, string> = {
  new: 'חדש',
  in_progress: 'בטיפול',
  done: 'טופל',
  cancelled: 'בוטל',
};

// Safe label for any stored status string (handles legacy/foreign values).
export function callbackStatusLabel(status: string): string {
  return (CALLBACK_STATUS_LABELS as Record<string, string>)[status] ?? status;
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
