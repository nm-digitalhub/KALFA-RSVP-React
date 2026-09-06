import 'server-only';

import { notFound } from 'next/navigation';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { EVENT_TYPE_LABELS, EVENT_STATUS_LABELS } from '@/lib/data/event-labels';

// STAFF EVENT IDENTITY ('view_events'). The one module that answers, for a
// platform staff member who does NOT own the event, the question "which event
// is this?" — and nothing beyond it.
//
// It exists because /app/events/{id} authorizes on OWNERSHIP alone, so no staff
// member reaches a customer's event there, the platform owner included. See
// migration 20260906221951 for why this got its own key instead of borrowing
// view_customer_data (break-glass, demands a typed reason) or view_billing (a
// money key guarding a name and a date).
//
// Hard rules for this module (do not widen without a documented decision):
//   * ONE permission key, 'view_events'. If a field needs a different key, it
//     does not belong in this file — that is the whole point of the file.
//   * NO owner name/phone/email, NO celebrant names, NO venue address, NO guest
//     rows, NO billing figures. Those are view_customer_data / manage_billing
//     data and keep their own surfaces (/admin/support, the campaign board).
//   * ownerId and campaignId are returned as OPAQUE IDENTIFIERS ONLY, to build
//     links whose targets impose their own gates. Neither carries content.
//   * Service-role read (RLS has no staff branch here), so the access must be
//     observable: recordStaffAccess runs BEFORE the read, fail-closed.
//     'view_events' is not break-glass, so no reason is required — the
//     permission plus the named subject is the justification.

const STAFF_EVENT_COLUMNS =
  'id, name, event_type, event_date, rsvp_deadline, status, venue_name, owner_id';

export interface StaffEventView {
  id: string;
  name: string;
  eventType: string;
  eventTypeLabel: string;
  eventDate: string | null;
  rsvpDeadline: string | null;
  status: string;
  statusLabel: string;
  venueName: string | null;
  /** Opaque — for linking to /admin/users/{id}, which gates on manage_staff. */
  ownerId: string;
  /** Opaque — for linking to the campaign board, which gates on manage_billing. */
  campaignId: string | null;
}

export async function getEventForStaffView(eventId: string): Promise<StaffEventView> {
  const staff = await requirePlatformPermission('view_events');
  const admin = createAdminClient();

  // Resolve the owner first so the audit row can name the data subject, then
  // audit, then read — the same order every audited reader here uses.
  const { data: ownerRow } = await admin
    .from('events')
    .select('owner_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ownerRow) {
    notFound();
  }
  await recordStaffAccess({
    staffId: staff.id,
    permission: 'view_events',
    subjectType: 'event',
    subjectId: eventId,
    ownerId: ownerRow.owner_id,
    eventId,
  });

  const [{ data, error }, { data: campaign }] = await Promise.all([
    admin.from('events').select(STAFF_EVENT_COLUMNS).eq('id', eventId).maybeSingle(),
    // id only. Not the status, not the money — whether a campaign EXISTS is
    // structural, and the link built from this id is rendered only for a
    // viewer holding manage_billing.
    admin.from('campaigns').select('id').eq('event_id', eventId).maybeSingle(),
  ]);
  if (error) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!data) {
    notFound();
  }

  return {
    id: data.id,
    name: data.name,
    eventType: data.event_type,
    eventTypeLabel: EVENT_TYPE_LABELS[data.event_type] ?? data.event_type,
    eventDate: data.event_date,
    rsvpDeadline: data.rsvp_deadline,
    status: data.status,
    statusLabel: EVENT_STATUS_LABELS[data.status] ?? data.status,
    venueName: data.venue_name,
    ownerId: data.owner_id,
    campaignId: campaign?.id ?? null,
  };
}
