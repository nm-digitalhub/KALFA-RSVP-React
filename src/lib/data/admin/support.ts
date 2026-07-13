import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { celebrantsTextFor } from '@/lib/data/celebrant-display';
import { EVENT_TYPE_LABELS, EVENT_STATUS_LABELS } from '@/lib/data/event-labels';
import { GUEST_STATUS_LABELS } from '@/app/(customer)/app/events/[id]/guests/labels';

// STAFF SUPPORT-ACCESS (P3): platform staff holding
// has_platform_permission('view_customer_data') may view a customer's
// NON-FINANCIAL event/guest data for support, READ-ONLY, via a dedicated
// surface (src/app/(admin)/admin/support). This module is the ONLY place that
// reads customer data for that purpose.
//
// Hard rules enforced here (do not weaken without a documented decision):
//   * Every exported reader calls requirePlatformPermission('view_customer_data')
//     FIRST — before any query. A rejected gate redirects and no read happens.
//   * Reads use the SERVICE-ROLE client (createAdminClient) — this is a
//     deliberate, narrow bypass of `can_access_event`/RLS for support, NOT a
//     precedent for weakening RLS or the ownership boundary anywhere else.
//   * NO billing/payment/card columns are ever read here — that is a SEPARATE
//     'manage_billing' surface. This module reads events + guests only.
//   * NO .update()/.insert()/.delete() is ever issued against a CUSTOMER table
//     (events/guests/profiles/contacts/...) from this module — the ONLY write
//     is the append-only `support_access_log` audit insert below. This is a
//     read-only surface end to end; there are no edit/toggle/delete affordances.
//   * Every view of an event requires a REQUIRED, non-trivial "break-glass"
//     reason, which is both persisted (support_access_log) and echoed into the
//     structured activity log + a Slack security alert (ids only, no PII).
//   * No customer notification is sent — a deliberate decision, consistent with
//     the existing privacy policy §6 commitment ("sensitive data is kept
//     accessible to authorized staff only"), which does not commit to per-access
//     customer notice.

const MIN_REASON_LENGTH = 10;

function assertReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_LENGTH) {
    throw new Error('יש לציין סיבה לצפייה (לפחות 10 תווים)');
  }
  return trimmed;
}

// Non-financial event fields only — no package/pricing/payment columns.
const SUPPORT_EVENT_COLUMNS =
  'id, name, event_type, event_date, venue_name, venue_address, celebrants, status, owner_id';

export interface SupportEventOwner {
  fullName: string | null;
  phone: string | null;
  email: string | null;
}

export interface SupportEventView {
  id: string;
  name: string;
  eventType: string;
  eventTypeLabel: string;
  eventDate: string | null;
  venueName: string | null;
  venueAddress: string | null;
  celebrantsText: string | null;
  status: string;
  statusLabel: string;
  owner: SupportEventOwner;
}

// Fetch a single event's NON-FINANCIAL data for a support view. REQUIRES a
// break-glass `reason` (>= 10 chars) — a blank/short reason throws a safe
// Hebrew error and neither reads the event nor writes an audit row. On
// success: reads via the service-role client, writes exactly ONE
// support_access_log row, records a structured activity-log entry, and fires
// a (best-effort, non-blocking) Slack security alert — ids only, never guest
// or owner PII.
export async function getEventForSupportView(
  eventId: string,
  reason: string,
): Promise<SupportEventView> {
  const staff = await requirePlatformPermission('view_customer_data');
  const safeReason = assertReason(reason);

  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from('events')
    .select(SUPPORT_EVENT_COLUMNS)
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!event) {
    throw new Error('האירוע לא נמצא');
  }

  const [{ data: profile }, { data: authUser }] = await Promise.all([
    admin.from('profiles').select('full_name, phone').eq('id', event.owner_id).maybeSingle(),
    admin.auth.admin.getUserById(event.owner_id),
  ]);

  const { error: logError } = await admin.from('support_access_log').insert({
    staff_id: staff.id,
    event_id: event.id,
    owner_id: event.owner_id,
    reason: safeReason,
  });
  if (logError) {
    // Fail closed: an unaudited support view is worse than a denied one.
    throw new Error('רישום הביקורת נכשל — הצפייה בוטלה');
  }

  await logActivity({
    eventId: event.id,
    action: 'admin.support.event_viewed',
    meta: { eventId: event.id },
  });
  void sendSlackAlert({
    category: 'security',
    level: 'warn',
    title: 'צפיית תמיכה בנתוני לקוח',
    fields: { staffId: staff.id, eventId: event.id },
  });

  return {
    id: event.id,
    name: event.name,
    eventType: event.event_type,
    eventTypeLabel: EVENT_TYPE_LABELS[event.event_type] ?? event.event_type,
    eventDate: event.event_date,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    celebrantsText: celebrantsTextFor(event.event_type, event.celebrants),
    status: event.status,
    statusLabel: EVENT_STATUS_LABELS[event.status] ?? event.status,
    owner: {
      fullName: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      email: authUser?.user?.email ?? null,
    },
  };
}

export interface SupportGuestView {
  id: string;
  fullName: string;
  phone: string | null;
  status: string;
  statusLabel: string;
  confirmedAdults: number | null;
  confirmedKids: number | null;
  rsvpNote: string | null;
  mealPref: string | null;
}

// Support-relevant guest fields for one event — name/phone/status/counts/
// dietary/rsvp-note. NO billing/payment fields (there are none on `guests`
// anyway; documented here as a guardrail for future columns). Gated the same
// way as getEventForSupportView; no second audit row is written here — call
// this right after (or alongside) getEventForSupportView, which already
// recorded the access.
export async function listGuestsForSupportView(eventId: string): Promise<SupportGuestView[]> {
  await requirePlatformPermission('view_customer_data');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('guests')
    .select(
      'id, full_name, phone, status, confirmed_adults, confirmed_kids, rsvp_note, meal_pref',
    )
    .eq('event_id', eventId)
    .order('full_name', { ascending: true });
  if (error) {
    throw new Error('טעינת רשימת האורחים נכשלה');
  }

  return (data ?? []).map((g) => ({
    id: g.id,
    fullName: g.full_name,
    phone: g.phone,
    status: g.status,
    statusLabel: GUEST_STATUS_LABELS[g.status] ?? g.status,
    confirmedAdults: g.confirmed_adults,
    confirmedKids: g.confirmed_kids,
    rsvpNote: g.rsvp_note,
    mealPref: g.meal_pref,
  }));
}

export interface SupportEventLookupResult {
  id: string;
  name: string;
  eventDate: string | null;
  ownerFullName: string | null;
}

// A raw candidate event resolved by the lookup, before audit + DTO shaping.
interface CandidateEvent {
  id: string;
  name: string;
  eventDate: string | null;
  ownerId: string;
  ownerFullName: string | null;
}

// Resolve candidate events by event id OR the account owner's phone/email —
// NOT a free guest search. Used when staff only has the customer's contact
// details, not the event id.
//
// SECURITY: the lookup itself exposes customer PII (event name/date + the
// OWNER's full name) and can be used to enumerate ("does this phone/email/event
// belong to a real customer, and who is it"). It is therefore treated as a
// customer-data READ, exactly like getEventForSupportView: it REQUIRES a
// break-glass `reason` (>= 10 chars) and writes an audit trail — one
// support_access_log row per matched event (accountable, since each surfaced
// event reveals that customer's name), plus a structured activity-log entry
// (ids/counts ONLY — never the raw phone/email/name) so that even a zero-result
// probe is logged. A blank/short reason throws and performs NO read and NO
// audit.
export async function findEventsForSupport(
  query: {
    eventId?: string;
    ownerPhone?: string;
    ownerEmail?: string;
  },
  reason: string,
): Promise<SupportEventLookupResult[]> {
  const staff = await requirePlatformPermission('view_customer_data');
  const safeReason = assertReason(reason);
  const admin = createAdminClient();

  const candidates = await resolveCandidateEvents(admin, query);

  // Audit BEFORE returning: one row per surfaced event (each reveals a
  // customer's name), then a structured activity entry with counts only. A
  // zero-result search still records the probe (ids/counts, no raw contact).
  if (candidates.length > 0) {
    const { error: logError } = await admin.from('support_access_log').insert(
      candidates.map((c) => ({
        staff_id: staff.id,
        event_id: c.id,
        owner_id: c.ownerId,
        reason: safeReason,
      })),
    );
    if (logError) {
      // Fail closed: an unaudited search that surfaced customer names is worse
      // than a denied one.
      throw new Error('רישום הביקורת נכשל — החיפוש בוטל');
    }
  }

  await logActivity({
    action: 'admin.support.search',
    meta: {
      by: query.eventId ? 'event_id' : query.ownerPhone ? 'owner_phone' : 'owner_email',
      resultCount: candidates.length,
    },
  });
  void sendSlackAlert({
    category: 'security',
    level: 'info',
    title: 'חיפוש תמיכה בנתוני לקוח',
    fields: { staffId: staff.id, resultCount: candidates.length },
  });

  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    eventDate: c.eventDate,
    ownerFullName: c.ownerFullName,
  }));
}

// Resolve candidate events (no audit, no DTO). By event id → at most one; by
// owner phone/email → the owner's events. Returns [] when nothing matches.
async function resolveCandidateEvents(
  admin: ReturnType<typeof createAdminClient>,
  query: { eventId?: string; ownerPhone?: string; ownerEmail?: string },
): Promise<CandidateEvent[]> {
  if (query.eventId) {
    const { data, error } = await admin
      .from('events')
      .select('id, name, event_date, owner_id')
      .eq('id', query.eventId)
      .maybeSingle();
    if (error || !data) return [];
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', data.owner_id)
      .maybeSingle();
    return [
      {
        id: data.id,
        name: data.name,
        eventDate: data.event_date,
        ownerId: data.owner_id,
        ownerFullName: profile?.full_name ?? null,
      },
    ];
  }

  let ownerId: string | null = null;

  if (query.ownerPhone) {
    const { data: profile } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('phone', query.ownerPhone)
      .maybeSingle();
    ownerId = profile?.id ?? null;
  } else if (query.ownerEmail) {
    // No server-side email filter on the GoTrue admin API — this is a targeted
    // lookup with a bounded single page, not a scan (unlike the broader admin
    // user search in users.ts).
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200, page: 1 });
    if (!error) {
      ownerId = data.users.find((u) => u.email === query.ownerEmail)?.id ?? null;
    }
  }

  if (!ownerId) return [];

  const { data: events, error } = await admin
    .from('events')
    .select('id, name, event_date, owner_id')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) return [];

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', ownerId)
    .maybeSingle();

  return (events ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    eventDate: e.event_date,
    ownerId,
    ownerFullName: profile?.full_name ?? null,
  }));
}
