import 'server-only';

import { notFound } from 'next/navigation';
import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, getUser } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { ensurePersonalOrg } from '@/lib/data/orgs';
import { OPERATIONAL_CAMPAIGN_STATUSES } from '@/lib/data/campaign-status';
import { isBeforeTomorrowIL, todayIL } from '@/lib/data/event-date';
import type { Database, Json } from '@/lib/supabase/types';
import { celebrantsCompleteFor } from '@/lib/validation/schemas';
import type { CelebrantsInput } from '@/lib/validation/schemas';

type EventRow = Database['public']['Tables']['events']['Row'];
export type EventType = Database['public']['Enums']['event_type'];
export type EventStatus = Database['public']['Enums']['event_status'];

// Event scoped to the current owner, for nested domains (guests, reports, …).
// owner is derived server-side from the session — never from the browser.
export type OwnedEvent = Pick<
  EventRow,
  'id' | 'name' | 'status' | 'event_type' | 'event_date' | 'rsvp_deadline'
>;
const OWNED_EVENT_COLUMNS = 'id, name, status, event_type, event_date, rsvp_deadline';

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

// List the events the current user may SEE — their own plus shared-org
// events. Tenant scoping is the RLS policy's job (events_org_select →
// can_access_event, phase 3); an app-side owner filter would blank the list
// for org members even though RLS allows the rows.
export async function listEvents(
  { limit = 20, offset = 0 }: ListEventsParams = {},
): Promise<EventListItem[]> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(LIST_COLUMNS)
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

// RLS-scoped event counts (owner + shared-org, like listEvents) via head queries
// (count only, no rows loaded) — the dashboard cards must reflect ALL visible
// events, independent of the recent-events page size (which previously capped
// both counts at the list limit).
export async function getEventCounts(): Promise<EventCounts> {
  await requireUser();
  const supabase = await createClient();

  const [totalRes, activeRes] = await Promise.all([
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
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
  | 'gift_payment_url'
  | 'invite_image_path'
  | 'event_type'
  | 'event_date'
  | 'venue_name'
  | 'venue_address'
  | 'rsvp_deadline'
  | 'celebrants'
  | 'show_meal_pref'
  | 'status'
  | 'created_at'
>;

const EVENT_DETAIL_COLUMNS =
  'id, name, event_type, event_date, venue_name, venue_address, gift_payment_url, invite_image_path, rsvp_deadline, celebrants, show_meal_pref, status, created_at';

// Fetch one of the current owner's events for the detail/edit page. Scoped by
// RLS-scoped read (owner or shared-org member with events.view); notFound()
// when invisible. Mutations stay separately gated (events.edit / owner-only).
export async function getEvent(eventId: string): Promise<EventDetail> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_DETAIL_COLUMNS)
    .eq('id', eventId)
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
  // Owner's PayBox/Bit link for the gift-reminder template. OPTIONAL KEY:
  // absent = don't touch; present (string | null) = set/clear (same presence
  // semantics as the date keys below).
  gift_payment_url?: string | null;
  // Public-RSVP meal-preference toggle. OPTIONAL KEY: absent = don't touch;
  // present = set. The edit form always renders the checkbox, so the action
  // always sends it (unchecked posts nothing → the action derives false).
  show_meal_pref?: boolean;
  // Storage path set by the SERVER after a verified upload — never a raw form
  // value (optional key, same presence semantics).
  invite_image_path?: string | null;
  // Always present (the celebrant field group is always rendered, so its
  // inputs are always posted): the submitted value replaces the stored one on
  // every save — all-empty → null clears the column. NOT date-locked: an
  // active event's owner must be able to fill these before enabling a
  // campaign (the campaign gate points them at this edit form).
  celebrants: CelebrantsInput | null;
  event_date?: string | null;
  rsvp_deadline?: string | null;
}

// While an OPERATIONAL campaign exists, every pending send binds the event's
// type-selected template plus the celebrant + venue values (template-spec.ts is
// fail-closed: a REMOVED value → params_incomplete → the send is SILENTLY
// skipped, advance-only, no retry). So these three are "may change, must not
// remove / re-type" invariants — the guards a user can reach through ENABLED UI,
// exported so the action surfaces the actionable message, not the generic text.
export const CELEBRANTS_LOCKED_ERROR =
  'לא ניתן להשאיר את פרטי בעלי השמחה חסרים כל עוד קמפיין אישורי-הגעה פעיל — הם מופיעים בהזמנות ובתזכורות. השלימו את השדות המסומנים ונסו שוב.';
export const EVENT_TYPE_LOCKED_ERROR =
  'לא ניתן לשנות את סוג האירוע כל עוד קמפיין אישורי-הגעה פעיל.';
export const VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR =
  'לא ניתן להשאיר את המיקום ריק כל עוד קמפיין אישורי-הגעה פעיל — המיקום מופיע בהזמנות ובתזכורות.';

// Update an event the current user may edit — the OWNER or an org member holding
// events.edit. The org-aware gate (requireEventAccess → can_access_event) runs
// first (404 otherwise); the write itself is authorized by RLS (events_org_update,
// USING+WITH CHECK can_access_event('events','edit')) and by the Phase-3 column
// grants, which pin id/owner_id/org_id/status/gift_link_token so a member can
// never re-tenant, hijack, or change lifecycle here. The patch is an explicit
// allow-list. There is deliberately NO app-side owner_id filter on the write — that
// pre-Phase-3 leftover matched 0 rows for any non-owner member with events.edit and
// defeated org sharing; RLS + the column grants are the authority.
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
  const cur = await requireEventAccess(eventId, 'events', 'edit');
  // Session guard (also enforced by requireEventAccess + logActivity). The write
  // below is NOT owner_id-scoped — RLS + column grants are the authority.
  await requireUser();
  const supabase = await createClient();

  const datesPresent = 'event_date' in input || 'rsvp_deadline' in input;

  const update: Database['public']['Tables']['events']['Update'] = {
    name: input.name,
    event_type: input.event_type,
    venue_name: input.venue_name,
    ...('gift_payment_url' in input ? { gift_payment_url: input.gift_payment_url ?? null } : {}),
    ...('invite_image_path' in input ? { invite_image_path: input.invite_image_path ?? null } : {}),
    ...('show_meal_pref' in input ? { show_meal_pref: input.show_meal_pref } : {}),
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

  // While-campaign-live invariants — protect every PENDING send (the send path
  // is fail-closed: a removed ingredient silently skips as params_incomplete, so
  // a "free" edit could drop a scheduled reminder). A save may CHANGE these but
  // must not REMOVE them, nor re-type the event its templates/pricing bind to:
  //   • event_type — locked (template family + param contract + pricing)
  //   • celebrants — must stay COMPLETE for the type (host signature/composition)
  //   • venue_name — must stay non-empty ({{…}} venue line in every invite/reminder)
  // event_date/time are already lifecycle-locked post-publish (above). The stored
  // type comes from the ownership read (cur) — no extra query; the campaign lookup
  // runs ONLY when one of the three could trip, and keys off the OPERATIONAL
  // status set (SSOT) so a terminal/cancelled campaign never locks the form.
  const typeChanged = cur.event_type !== input.event_type;
  const celebrantsIncomplete = !celebrantsCompleteFor(input.event_type, input.celebrants);
  const venueMissing = !input.venue_name || input.venue_name.trim() === '';

  if (typeChanged || celebrantsIncomplete || venueMissing) {
    const { data: liveCampaign } = await supabase
      .from('campaigns')
      .select('id')
      .eq('event_id', eventId)
      .in('status', [...OPERATIONAL_CAMPAIGN_STATUSES])
      .limit(1)
      .maybeSingle();
    if (liveCampaign) {
      if (typeChanged) throw new Error(EVENT_TYPE_LOCKED_ERROR);
      if (celebrantsIncomplete) throw new Error(CELEBRANTS_LOCKED_ERROR);
      throw new Error(VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR);
    }
  }

  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)
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
  // Service-role write: M1 (phase-3 RLS migration) removes the `status` column
  // from authenticated's UPDATE grant so NO browser-context role can flip
  // lifecycle state — publish/close are owner-only APP paths (ownership proven
  // by requireOwnedEvent above; the predicates below keep the transition
  // atomic and the DB trigger still validates it).
  const admin = createAdminClient();

  const { error } = await admin
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
  // Same service-role rationale as publishEvent (M1 status column grant).
  const admin = createAdminClient();

  const { error } = await admin
    .from('events')
    .update({ status: 'closed' })
    .eq('id', eventId)
    .eq('owner_id', user.id);

  if (error) {
    throw new Error('יש לסגור או לבטל את הקמפיין לפני סגירת האירוע');
  }

  await logActivity({ eventId, action: 'event.closed', meta: {} });
}

// Thin boolean VISIBILITY helper ONLY (NOT an auth gate).
// FAIL-CLOSED: returns false on denied OR on any RPC/client error. The only effect is
// hiding an optional UI section or showing a permission_limited state. Every mandatory
// gate stays on requireEventAccess/requireUser/requireAdmin. Reuses the exact same
// can_access_event RPC as requireEventAccess; never reads owner_id/org_id; never duplicates
// authorization logic. Mirrors `can` in src/lib/permissions.ts (cache + false-on-error).
// HARD USAGE BOUNDARY: call ONLY after the `reports.view` page gate has passed, and ONLY
// for optional-section visibility — never for page access, server actions, mutations,
// service-role writes, billing/payment ops, or any decision that must tell denied from error.
export const canAccessEvent = cache(
  async (eventId: string, resource: string, action: string = 'view'): Promise<boolean> => {
    const user = await getUser();
    if (!user) return false; // no session → hide section (page gate already redirected)
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('can_access_event', {
      _event_id: eventId,
      _resource: resource,
      _action: action,
    });
    if (error) return false; // operational failure → fail-closed, hide section
    return data === true;
  },
);
