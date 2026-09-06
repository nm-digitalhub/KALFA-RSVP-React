import 'server-only';

import { notFound } from 'next/navigation';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { recordStaffAccess } from '@/lib/data/admin/access-log';
import { rescheduleEventExchangeAppointment } from '@/lib/data/event-exchange-sync';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// Platform-staff reschedule of a live event.
//
// The date is locked once an event leaves draft, and the lock is a database
// trigger (events_guard_update, R5) that fires for every writer — service_role
// included. Migration 20260906203901 opened exactly one door: the SECURITY
// DEFINER function admin_reschedule_event, which checks
// has_platform_permission('manage_billing') itself and is the only thing that
// can lift the lock, for the duration of its own transaction.
//
// So this module does NOT re-implement the rule; it calls that function and
// takes care of everything the database cannot: the audit trail, the activity
// log, the security alert, and the calendar entry.

const MIN_REASON_LENGTH = 10;

export interface RescheduleResult {
  /** The event's new date, echoed back by the database. */
  eventDate: string;
  /** True when rsvp_deadline had to follow the event down (the move was earlier). */
  deadlineClamped: boolean;
}

export async function rescheduleEventForAdmin(
  eventId: string,
  newEventDateIso: string,
  reason: string,
): Promise<RescheduleResult> {
  const staff = await requirePlatformPermission('manage_billing');

  // A REASON IS MANDATORY here even though manage_billing is not a break-glass
  // permission. recordStaffAccess only compels one for break-glass keys, and
  // deliberately so — reason-fatigue on routine reads launders the meaning of a
  // real one. This is not a routine read: it changes the date a customer's
  // guests were already told, and it is rare enough that saying why costs
  // nothing.
  const safeReason = reason.trim();
  if (safeReason.length < MIN_REASON_LENGTH) {
    throw new Error('יש לפרט את הסיבה לשינוי המועד (10 תווים לפחות)');
  }

  const admin = createAdminClient();
  const { data: event, error: readErr } = await admin
    .from('events')
    .select('id, owner_id, event_date, status')
    .eq('id', eventId)
    .maybeSingle();
  if (readErr) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!event) {
    notFound();
  }

  // Fail-closed audit BEFORE the write, like every other cross-tenant staff
  // path here: service_role carries no user identity, so this row is the only
  // record of who moved a customer's event and why.
  await recordStaffAccess({
    staffId: staff.id,
    permission: 'manage_billing',
    subjectType: 'event',
    subjectId: eventId,
    ownerId: event.owner_id,
    eventId,
    reason: safeReason,
  });

  // The USER-scoped client, not the service-role one: admin_reschedule_event
  // resolves the caller through auth.uid(), which is null under service_role —
  // the function would refuse itself. The identity travelling with the request
  // IS the authorization.
  const supabase = await createClient();
  const { data: applied, error } = await supabase.rpc('admin_reschedule_event', {
    _event_id: eventId,
    _event_date: newEventDateIso,
  });
  if (error) {
    // Map the function's own refusals to something a person can act on; never
    // surface the raw Postgres text.
    const raw = error.message ?? '';
    if (raw.includes('at least tomorrow')) {
      throw new Error('מועד האירוע חייב להיות החל ממחר');
    }
    if (raw.includes('only an active event')) {
      throw new Error('ניתן לשנות מועד רק לאירוע פעיל');
    }
    if (raw.includes('insufficient privilege')) {
      throw new Error('אין לך הרשאה לשנות את מועד האירוע');
    }
    throw new Error('שינוי מועד האירוע נכשל');
  }

  // Read the row back rather than assuming: the function clamps rsvp_deadline
  // when the event moves earlier, and the operator should be told that happened.
  const { data: after } = await admin
    .from('events')
    .select('event_date, rsvp_deadline')
    .eq('id', eventId)
    .maybeSingle();

  const previousDay = event.event_date ? new Date(event.event_date).getTime() : 0;
  const newDay = new Date(newEventDateIso).getTime();

  await logActivity({
    eventId,
    action: 'admin.event.rescheduled',
    // Dates and ids only — the reason lives in the audit row, never duplicated
    // into a second store.
    meta: { from: event.event_date, to: applied ?? newEventDateIso },
  });

  void sendSlackAlert({
    category: 'security',
    level: 'warn',
    title: 'שינוי מועד אירוע על ידי צוות',
    fields: { staffId: staff.id, eventId, from: event.event_date ?? '—', to: newEventDateIso },
  });

  // The Exchange/Graph appointment is created when a campaign is activated and
  // was never refreshed afterwards — because until now an event's date could not
  // change once it was live. syncEventToExchange is create-only and returns at
  // `already_synced` for exactly this event, so calling THAT here would be a
  // silent no-op leaving the calendar on the old date. Verified against a real
  // reschedule before this line was written. Best-effort by contract: it never
  // throws.
  await rescheduleEventExchangeAppointment(eventId);

  return {
    eventDate: (applied as string | null) ?? newEventDateIso,
    deadlineClamped: newDay < previousDay && after?.rsvp_deadline != null,
  };
}
