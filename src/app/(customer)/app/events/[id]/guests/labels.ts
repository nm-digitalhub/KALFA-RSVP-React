import type { Database } from '@/lib/supabase/types';

// Hebrew labels for the guest-domain enums. Defined as EXHAUSTIVE
// `Record<enum, string>` maps so that adding or removing a value in the DB
// enum (reflected in `Database['public']['Enums']`) becomes a compile error
// here rather than a silently-missing label.

type GuestStatus = Database['public']['Enums']['guest_status'];
type ContactStatus = Database['public']['Enums']['contact_status'];

export const GUEST_STATUS_LABELS: Record<GuestStatus, string> = {
  pending: 'ממתין',
  attending: 'מגיע',
  declined: 'לא מגיע',
  maybe: 'אולי',
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  not_contacted: 'לא נוצר קשר',
  contacted: 'נוצר קשר',
  responded: 'הגיב',
  wrong_number: 'מספר שגוי',
  unclear: 'לא ברור',
  unavailable: 'לא זמין',
  callback: 'לחזור אליו',
};
