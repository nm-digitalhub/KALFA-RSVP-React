import 'server-only';

import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { ensurePersonalOrg } from '@/lib/data/orgs';
import type { Database } from '@/lib/supabase/types';

type EventRow = Database['public']['Tables']['events']['Row'];
export type EventType = Database['public']['Enums']['event_type'];
export type EventStatus = Database['public']['Enums']['event_status'];

// Event scoped to the current owner, for nested domains (guests, reports, …).
// owner is derived server-side from the session — never from the browser.
export type OwnedEvent = Pick<
  EventRow,
  'id' | 'name' | 'status' | 'event_date' | 'rsvp_deadline'
>;
const OWNED_EVENT_COLUMNS = 'id, name, status, event_date, rsvp_deadline';

// L1 — the single shared "past event" rule lives in a dependency-free leaf
// (./event-date) so the worker and client can import it without `server-only`.
// Re-exported here as the documented home for the events domain.
export { isPastEventDay, assertEventNotPast } from '@/lib/data/event-date';

// Verify the current user owns `eventId`; notFound() (404) otherwise. Use this
// as the ownership gate at the top of every event-scoped data function.
export async function requireOwnedEvent(eventId: string): Promise<OwnedEvent> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('events')
    .select(OWNED_EVENT_COLUMNS)
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!data) {
    notFound();
  }
  return data;
}

// Org-aware access gate: verify the current user may perform `action` on
// `resource` for `eventId` — owner OR an org member holding the permission —
// via the can_access_event() DB function (single source of truth). notFound()
// (404) otherwise. requireOwnedEvent remains for strictly owner-only paths;
// this gate enables shared, org-scoped access once the event-table RLS is
// widened to org membership (Phase 3).
export async function requireEventAccess(
  eventId: string,
  resource: string = 'events',
  action: string = 'view',
): Promise<OwnedEvent> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('events')
    .select(OWNED_EVENT_COLUMNS)
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!data) {
    notFound();
  }
  const { data: allowed } = await supabase.rpc('can_access_event', {
    _event_id: eventId,
    _resource: resource,
    _action: action,
  });
  if (allowed !== true) {
    notFound();
  }
  return data;
}

// DTO: only the columns the customer list needs.
export type EventListItem = Pick<
  EventRow,
  'id' | 'name' | 'event_type' | 'event_date' | 'status' | 'venue_name' | 'created_at'
>;

const LIST_COLUMNS = 'id, name, event_type, event_date, status, venue_name, created_at';

export interface ListEventsParams {
  limit?: number;
  offset?: number;
}

// List the current owner's events. Explicit owner_id filter in addition to RLS.
export async function listEvents(
  { limit = 20, offset = 0 }: ListEventsParams = {},
): Promise<EventListItem[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(LIST_COLUMNS)
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error('טעינת האירועים נכשלה');
  }

  return data ?? [];
}

export interface EventCounts {
  total: number;
  active: number;
}

// Owner-scoped event counts via head queries (count only, no rows loaded) — the
// dashboard cards must reflect ALL events, independent of the recent-events page
// size (which previously capped both counts at the list limit).
export async function getEventCounts(): Promise<EventCounts> {
  const user = await requireUser();
  const supabase = await createClient();

  const [totalRes, activeRes] = await Promise.all([
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .eq('status', 'active'),
  ]);

  if (totalRes.error || activeRes.error) {
    throw new Error('טעינת מונה האירועים נכשלה');
  }

  return { total: totalRes.count ?? 0, active: activeRes.count ?? 0 };
}

export interface CreateEventInput {
  name: string;
  event_type: EventType;
  event_date: string | null;
  venue_name: string | null;
}

// Create an event owned by the current user.
export async function createEvent(input: CreateEventInput): Promise<EventListItem> {
  const user = await requireUser();
  // Anchor the event to the user's active org (creating a personal org on first
  // use). owner_id is kept for backward compatibility and as the legacy owner.
  const orgId = await ensurePersonalOrg();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .insert({ ...input, owner_id: user.id, org_id: orgId })
    .select(LIST_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('יצירת האירוע נכשלה');
  }

  await logActivity({
    eventId: data.id,
    action: 'event.created',
    meta: {
      fields: Object.keys(input),
      eventType: input.event_type,
    },
  });

  return data;
}

// ---------------------------------------------------------------------------
// Event detail + update (owner-scoped edit).
// ---------------------------------------------------------------------------

// Full editable projection for the event detail/edit page. Excludes the
// billing/feature columns (package_id, with_ai_calls, template) — not
// owner-editable here — and server-controlled columns (owner_id, timestamps).
export type EventDetail = Pick<
  EventRow,
  | 'id'
  | 'name'
  | 'event_type'
  | 'event_date'
  | 'venue_name'
  | 'venue_address'
  | 'rsvp_deadline'
  | 'status'
  | 'created_at'
>;

const EVENT_DETAIL_COLUMNS =
  'id, name, event_type, event_date, venue_name, venue_address, rsvp_deadline, status, created_at';

// Fetch one of the current owner's events for the detail/edit page. Scoped by
// owner_id in addition to RLS; notFound() (404) if missing or not owned.
export async function getEvent(eventId: string): Promise<EventDetail> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_DETAIL_COLUMNS)
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת האירוע נכשלה');
  }
  if (!data) {
    notFound();
  }
  return data;
}

// Fields an owner may edit. Deliberately omits id/owner_id/timestamps and the
// billing/feature columns (package_id, with_ai_calls, template) — those are not
// settable through this owner path.
export interface UpdateEventInput {
  name: string;
  event_type: EventType;
  event_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  rsvp_deadline: string | null;
  status: EventStatus;
}

// Update an event the current user owns. The ownership gate runs first (404 if
// not owned); the update is additionally scoped by owner_id, and the patch is
// built from an explicit allow-list so id/owner_id can never be changed here.
export async function updateEvent(
  eventId: string,
  input: UpdateEventInput,
): Promise<EventDetail> {
  await requireOwnedEvent(eventId);
  const user = await requireUser();
  const supabase = await createClient();

  const update: Database['public']['Tables']['events']['Update'] = {
    name: input.name,
    event_type: input.event_type,
    event_date: input.event_date,
    venue_name: input.venue_name,
    venue_address: input.venue_address,
    rsvp_deadline: input.rsvp_deadline,
    status: input.status,
  };

  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .select(EVENT_DETAIL_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('עדכון האירוע נכשל');
  }

  await logActivity({
    eventId,
    action: 'event.updated',
    meta: {
      fields: Object.keys(input),
      eventType: input.event_type,
      status: input.status,
    },
  });

  return data;
}
