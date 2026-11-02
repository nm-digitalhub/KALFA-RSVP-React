import type { Enums } from '@/lib/supabase/types';
import type { BadgeVariant } from '@/components/ui/badge';

// Hebrew labels for the guest-domain enums. Defined as EXHAUSTIVE
// `Record<enum, string>` maps so that adding or removing a value in the DB
// enum (reflected in `Enums<'…'>`) becomes a compile error
// here rather than a silently-missing label.
//
// Pure label/variant maps — NO `server-only` here: this module is imported by
// the (server) guest list page AND by client components (e.g. the campaign
// manage screen), so it must stay isomorphic. `BadgeVariant` is a type-only import.

type GuestStatus = Enums<'guest_status'>;
type ContactStatus = Enums<'contact_status'>;
type ContactOpStatus = Enums<'contact_op_status'>;

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

// ---------------------------------------------------------------------------
// Webhook-driven state (Meta WhatsApp): the outreach `op_status` and per-message
// `delivery_status`. These are SEPARATE from the CRM
// `contact_status` above — they reflect what Meta streamed through the webhook,
// not what the owner typed. Shared by the guest list badges, the guest
// WhatsApp timeline, and the campaign breakdown.
// ---------------------------------------------------------------------------

// contacts.op_status — the outreach-engine state of a contact. EXHAUSTIVE
// `Record<contact_op_status, …>` so a new enum value is a COMPILE error here.
export const OP_STATUS_LABELS: Record<ContactOpStatus, string> = {
  pending_contact: 'ממתין ליצירת קשר',
  whatsapp_sent: 'WhatsApp נשלח',
  pending_call: 'ממתין לשיחה',
  call_dialed: 'חויג',
  no_answer: 'אין מענה',
  human_interaction_call: 'מענה אנושי',
  wrong_number: 'מספר שגוי',
  reached_billed: 'הושג',
};

// op_status → Badge variant. Exhaustive (a new enum value becomes a compile
// error). Progress milestones tint info/success; failures tint warning/destructive.
export const OP_STATUS_VARIANTS: Record<ContactOpStatus, BadgeVariant> = {
  pending_contact: 'neutral',
  whatsapp_sent: 'neutral',
  pending_call: 'neutral',
  call_dialed: 'info',
  no_answer: 'warning',
  human_interaction_call: 'success',
  wrong_number: 'destructive',
  reached_billed: 'success',
};

// contact_interactions.delivery_status (sent/delivered/read/failed, free text)
// is shared verbatim with the admin webhook inspector — re-export the single
// source of truth (`@/lib/data/admin/labels`, isomorphic / no server-only)
// rather than duplicating the map. Re-exported HERE so the customer-side
// timeline + breakdown import all webhook-state labels from one place.
export {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_VARIANTS,
  deliveryStatusLabel,
  deliveryStatusVariant,
} from '@/lib/data/admin/labels';
