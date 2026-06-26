import type { Database } from '@/lib/supabase/types';
import type { CallbackStatus } from '@/lib/validation/admin';

// Pure label maps — safe to import from both Server and Client Components, so
// this module must NOT import `server-only` (the admin status form is a client
// component and imports these labels).
// Hebrew display labels for the admin panel. Enum-backed maps use exhaustive
// `Record<Enum, string>` so a new enum value becomes a COMPILE error (forcing a
// translation) rather than a silently-untranslated UI string. The free-text
// callback status uses a partial map plus a `?? value` fallback in the UI.

type OrderStatus = Database['public']['Enums']['order_status'];
type AppRole = Database['public']['Enums']['app_role'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'ממתין',
  processing: 'בעיבוד',
  paid: 'שולם',
  failed: 'נכשל',
  demo: 'הדגמה',
  payment_review: 'לבירור',
};

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
