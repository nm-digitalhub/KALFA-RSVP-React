import 'server-only';

import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
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

export interface CreateEventInput {
  name: string;
  event_type: EventType;
  event_date: string | null;
  venue_name: string | null;
}

// Create an event owned by the current user.
export async function createEvent(input: CreateEventInput): Promise<EventListItem> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .insert({ ...input, owner_id: user.id })
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
