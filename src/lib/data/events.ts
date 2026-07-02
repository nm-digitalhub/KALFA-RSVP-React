import 'server-only';

import { notFound } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { ensurePersonalOrg } from '@/lib/data/orgs';
import { isBeforeTomorrowIL, todayIL } from '@/lib/data/event-date';
import type { Database, Json } from '@/lib/supabase/types';
import type { CelebrantsInput } from '@/lib/validation/schemas';

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
export { isPastEventDay, assertEventNotPast, isBeforeTomorrowIL, todayIL } from '@/lib/data/event-date';

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
  // Per-event-type celebrant names (בעלי שמחה) — optional at create (partial
  // is legal too); null means "none given" and stores SQL NULL, never {}.
  celebrants: CelebrantsInput | null;
}

// `celebrants` is a jsonb column typed `Json`. The CelebrantsInput shapes are
// structurally compatible at runtime but not directly assignable in TS, so we
// narrow through unknown — documented per the project's casting rule (same
// pattern as src/lib/data/campaigns.ts:173).
function celebrantsJson(celebrants: CelebrantsInput | null): Json | null {
  return celebrants as unknown as Json | null;
}

// Create an event owned by the current user. R1 (status forced to 'draft') is
// structurally guaranteed: CreateEventInput has no status field, and the DB
// trigger (events_before_insert) is the REST-proof authority regardless.
export async function createEvent(input: CreateEventInput): Promise<EventListItem> {
  const user = await requireUser();
  // R2 (defense-in-depth — the DB trigger + Zod refine are the other two
  // layers): event_date is NULL (a date-less draft, legal) or >= tomorrow.
  if (input.event_date && isBeforeTomorrowIL(input.event_date)) {
    throw new Error('מועד האירוע חייב להיות החל ממחר');
  }
  // Anchor the event to the user's active org (creating a personal org on first
  // use). owner_id is kept for backward compatibility and as the legacy owner.
  const orgId = await ensurePersonalOrg();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .insert({
      ...input,
      celebrants: celebrantsJson(input.celebrants),
      owner_id: user.id,
      org_id: orgId,
    })
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
  | 'celebrants'
  | 'status'
  | 'created_at'
>;

const EVENT_DETAIL_COLUMNS =
  'id, name, event_type, event_date, venue_name, venue_address, rsvp_deadline, celebrants, status, created_at';

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
// settable through this owner path. `status` is NOT here at all — publishEvent
// and closeEvent are the only legitimate writers of status (R6).
//
// event_date/rsvp_deadline are OPTIONAL keys, and KEY PRESENCE carries meaning,
// not just the value (round-2 design): omitting the key entirely means "do not
// touch this field" — the only legal shape when the event is not draft (a
// disabled <input> is never POSTed by the browser, so the key never reaches
// here for a locked event under normal UI use). Including the key (value:
// string | null) means "set/clear it" — legal only while draft. NEVER collapse
// "absent" and "null" into the same thing.
export interface UpdateEventInput {
  name: string;
  event_type: EventType;
  venue_name: string | null;
  venue_address: string | null;
  // Always present (the celebrant field group is always rendered, so its
  // inputs are always posted): the submitted value replaces the stored one on
  // every save — all-empty → null clears the column. NOT date-locked: an
  // active event's owner must be able to fill these before enabling a
  // campaign (the campaign gate points them at this edit form).
  celebrants: CelebrantsInput | null;
  event_date?: string | null;
  rsvp_deadline?: string | null;
}

// Update an event the current user owns. The ownership gate runs first (404 if
// not owned); the update is additionally scoped by owner_id, and the patch is
// built from an explicit allow-list so id/owner_id can never be changed here.
//
// R5 lock + R2/R2b mirror (defense-in-depth — the DB triggers are the REST-proof
// authority): on a non-draft event, an explicit event_date/rsvp_deadline KEY is
// a forged-request bypass of the disabled UI and is REJECTED outright (not
// silently dropped) — only the absence of both keys is legal. On a draft event,
// a present key is validated (R2 for event_date, R2b lower-bound mirror for
// rsvp_deadline) and included in the patch.
export async function updateEvent(
  eventId: string,
  input: UpdateEventInput,
): Promise<EventDetail> {
  const cur = await requireOwnedEvent(eventId);
  const user = await requireUser();
  const supabase = await createClient();

  const datesPresent = 'event_date' in input || 'rsvp_deadline' in input;

  const update: Database['public']['Tables']['events']['Update'] = {
    name: input.name,
    event_type: input.event_type,
    venue_name: input.venue_name,
    venue_address: input.venue_address,
    // On an event_type change the action already parsed the NEW type's fields
    // only (parseCelebrantsForm), so the new shape replaces the old outright.
    celebrants: celebrantsJson(input.celebrants),
  };

  if (cur.status !== 'draft') {
    if (datesPresent) {
      throw new Error('לא ניתן לשנות מועד לאחר פרסום האירוע');
    }
    // Neither key present — omit them from the patch entirely (never null).
  } else {
    if ('event_date' in input) {
      if (input.event_date && isBeforeTomorrowIL(input.event_date)) {
        throw new Error('מועד האירוע חייב להיות החל ממחר');
      }
      update.event_date = input.event_date;
    }
    if ('rsvp_deadline' in input) {
      if (input.rsvp_deadline && input.rsvp_deadline < todayIL()) {
        throw new Error('המועד האחרון לאישור הגעה לא יכול להיות בעבר');
      }
      update.rsvp_deadline = input.rsvp_deadline;
    }
  }

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
    },
  });

  return data;
}

// Publish a draft event (R3 — status-only; date fields must already be valid
// and are not touched here). The app-level pre-checks here are defense-in-depth
// UX (the DB trigger re-validates the same conditions authoritatively).
export async function publishEvent(eventId: string): Promise<void> {
  const cur = await requireOwnedEvent(eventId);
  if (!cur.event_date || isBeforeTomorrowIL(cur.event_date)) {
    throw new Error('יש להגדיר מועד עתידי לפני פרסום');
  }
  // R2b mirror: today_IL may have moved forward since the deadline was saved
  // while draft, even though the date values themselves are unchanged here.
  if (cur.rsvp_deadline && cur.rsvp_deadline < todayIL()) {
    throw new Error('המועד האחרון לאישור הגעה כבר חלף — קבעו מועד חדש לפני הפרסום');
  }
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('events')
    .update({ status: 'active' })
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .eq('status', 'draft');

  if (error) {
    throw new Error('פרסום האירוע נכשל');
  }

  await logActivity({ eventId, action: 'event.published', meta: {} });
}

// Close an event (R6: draft→closed or active→closed). The DB trigger (R7)
// rejects the close while a campaign is still operational; that raise is
// mapped to a single safe Hebrew message — the only realistic failure mode
// under normal ownership-scoped use.
export async function closeEvent(eventId: string): Promise<void> {
  await requireOwnedEvent(eventId);
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('events')
    .update({ status: 'closed' })
    .eq('id', eventId)
    .eq('owner_id', user.id);

  if (error) {
    throw new Error('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע');
  }

  await logActivity({ eventId, action: 'event.closed', meta: {} });
}
