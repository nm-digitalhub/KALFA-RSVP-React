import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireOwnedEvent, requireEventAccess } from '@/lib/data/events';

// unique index guests_event_phone_key (one guest per phone per event)
export const PHONE_TAKEN_ERROR =
  'מספר הטלפון כבר קיים אצל מוזמן אחר באירוע';
// unique index guest_groups_event_name_key (one group name per event)
export const GROUP_NAME_TAKEN_ERROR = 'קבוצה בשם זה כבר קיימת באירוע';
// Mapping rule: SQLSTATE 23505 + the CONSTRAINT NAME (the stable identifier;
// PostgREST surfaces it only inside the message/details strings, so the name
// is searched there — never free-text words that could change between
// versions or providers).
function isUniqueViolation(
  error: { code?: string; message?: string; details?: string },
  constraintName: string,
): boolean {
  return (
    error.code === '23505' &&
    `${error.message ?? ''}\n${error.details ?? ''}`.includes(constraintName)
  );
}

// `error` may be null (e.g. a `.single()` that yields no row and no error);
// the fallback is thrown in that case.
function throwFriendlyGuestError(error: { code?: string; message?: string; details?: string } | null, fallback: string): never {
  if (error && isUniqueViolation(error, 'guests_event_phone_key')) {
    throw new Error(PHONE_TAKEN_ERROR);
  }
  throw new Error(fallback);
}
import { normalizeGroupName, normalizeGuestName } from '@/lib/data/guest-import-shared';
import { normalizePhone } from '@/lib/phone';
import {
  pruneOrphanContact,
  linkGuestContact,
  reconcileCampaignSetForContact,
} from '@/lib/data/contacts';
import { isReconcileEnabled } from '@/lib/data/reconcile-config';
import { logActivity } from '@/lib/data/activity';
import { getGuestsPageSize } from '@/lib/constants';
import type { Database } from '@/lib/supabase/types';
import { Constants } from '@/lib/supabase/types';

type GuestRow = Database['public']['Tables']['guests']['Row'];
type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row'];
export type GuestStatus = Database['public']['Enums']['guest_status'];
export type ContactStatus = Database['public']['Enums']['contact_status'];
export type ContactOpStatus = Database['public']['Enums']['contact_op_status'];

// ---------------------------------------------------------------------------
// Column projections (DTO contracts).
//
// SECURITY: `rsvp_token` is the public RSVP bearer secret and `extras` is free
// JSON that may hold arbitrary data — NEITHER may ever appear in a column
// projection that reaches the owner UI. A test asserts these strings exclude
// both. Any column added here must be reviewed against that rule.
// ---------------------------------------------------------------------------

// Columns for the paginated guest list. `contact_id` links a guest to its
// outreach contact; `contacts(op_status, removal_requested)` is an EMBEDDED
// select via the `guests_contact_id_fkey` FK (forward, to-one → object|null)
// that surfaces the webhook-driven outreach state + opt-out flag for the list
// badges (B6). Neither rsvp_token nor extras appears here (asserted by a test).
export const GUEST_LIST_COLUMNS =
  'id, full_name, phone, status, contact_status, group_id, expected_count, confirmed_adults, confirmed_kids, confirmed_headcount, callback_requested, created_at, contact_id, contacts(op_status, removal_requested)';

// Columns for a single guest (edit form). Adds note/meal_pref but still
// excludes rsvp_token and extras.
export const GUEST_DETAIL_COLUMNS =
  'id, full_name, phone, status, contact_status, group_id, expected_count, confirmed_adults, confirmed_kids, meal_pref, note, callback_requested, created_at, updated_at';

export const GROUP_COLUMNS = 'id, event_id, name, color, created_at';

// Raw shape of one list-query row (columns + FK embed + computed field) —
// see the .returns override in listGuests.
type GuestListQueryRow = Pick<
  GuestRow,
  | 'id'
  | 'full_name'
  | 'phone'
  | 'status'
  | 'contact_status'
  | 'group_id'
  | 'expected_count'
  | 'confirmed_adults'
  | 'confirmed_kids'
  | 'confirmed_headcount'
  | 'callback_requested'
  | 'created_at'
  | 'contact_id'
> & {
  over_invited: boolean | null;
  contacts: {
    op_status: ContactOpStatus | null;
    removal_requested: boolean | null;
  } | null;
};

export type GuestListItem = Pick<
  GuestRow,
  | 'id'
  | 'full_name'
  | 'phone'
  | 'status'
  | 'contact_status'
  | 'group_id'
  | 'expected_count'
  | 'confirmed_adults'
  | 'confirmed_kids'
  | 'confirmed_headcount'
  | 'callback_requested'
  | 'created_at'
  | 'contact_id'
> & {
  // DB-computed business flag (over_invited computed field): attending, has an
  // invited size, gave a REAL answer, and that answer exceeds the invited size.
  over_invited: boolean;
  // Webhook-driven outreach state, surfaced as list badges (B6).
  // `op_status` / `removal_requested` come from the linked contact (embedded via
  // the guests.contact_id FK) and are null when the guest has no contact yet.
  // `delivery_status` is the LATEST per-contact OUTBOUND delivery state from
  // contact_interactions (free text; null when there is no delivery callback).
  op_status: ContactOpStatus | null;
  removal_requested: boolean | null;
  delivery_status: string | null;
};

export type GuestDetail = Pick<
  GuestRow,
  | 'id'
  | 'full_name'
  | 'phone'
  | 'status'
  | 'contact_status'
  | 'group_id'
  | 'expected_count'
  | 'confirmed_adults'
  | 'confirmed_kids'
  | 'meal_pref'
  | 'note'
  | 'callback_requested'
  | 'created_at'
  | 'updated_at'
>;

export type GuestGroup = Pick<
  GuestGroupRow,
  'id' | 'event_id' | 'name' | 'color' | 'created_at'
>;

// ---------------------------------------------------------------------------
// Sort whitelist.
//
// SECURITY: the sort column is interpolated into the PostgREST query string
// (unlike `.eq()` values, which are parameterised). An attacker-supplied sort
// must therefore be mapped through a fixed whitelist; anything off-list falls
// back to the default. Direction is likewise restricted to asc/desc.
// ---------------------------------------------------------------------------
const SORT_COLUMNS = {
  name: 'full_name',
  status: 'status',
  contact: 'contact_status',
  created: 'created_at',
} as const;

export type GuestSortKey = keyof typeof SORT_COLUMNS;
const DEFAULT_SORT: GuestSortKey = 'created';

// Resolve a (possibly attacker-supplied) sort key to a SAFE, whitelisted column
// name. Anything off-list falls back to the default; the raw value is never
// passed to the query.
function resolveSortColumn(sort?: string): string {
  const key = (sort && sort in SORT_COLUMNS ? sort : DEFAULT_SORT) as GuestSortKey;
  return SORT_COLUMNS[key];
}

function resolveDir(dir?: string): 'asc' | 'desc' {
  return dir === 'asc' ? 'asc' : 'desc';
}

const GUEST_STATUS_VALUES = Constants.public.Enums.guest_status;
const CONTACT_STATUS_VALUES = Constants.public.Enums.contact_status;

function isGuestStatus(v: string): v is GuestStatus {
  return (GUEST_STATUS_VALUES as readonly string[]).includes(v);
}
function isContactStatus(v: string): v is ContactStatus {
  return (CONTACT_STATUS_VALUES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Search-term sanitisation for the PostgREST `.or()` filter string.
//
// `.or()` takes a RAW filter string where `,` separates conditions, `(`/`)`
// group them, and `*` is the wildcard inside an `ilike` pattern. To prevent an
// attacker from injecting extra conditions, we strip every char with PostgREST
// meaning (`, ( ) * % "`) plus backslash, then wrap the remainder in `*…*` so
// it becomes a contains-match. The result is always exactly two ilike clauses.
// ---------------------------------------------------------------------------
function buildSearchFilter(search: string): string | null {
  const cleaned = search.replace(/[,()*%"\\]/g, '').trim();
  if (cleaned === '') return null;
  const pattern = `*${cleaned}*`;
  return `full_name.ilike.${pattern},phone.ilike.${pattern}`;
}

export interface ListGuestsParams {
  page?: number;
  search?: string;
  sort?: string;
  dir?: string;
  status?: string;
  contactStatus?: string;
  groupId?: string;
  /** Only rows whose real answer exceeds the invited size. */
  overInvited?: boolean;
}

export interface GuestListResult {
  items: GuestListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * List guests for an owned event, server-paginated with optional search, sort,
 * and enum/group filters. All filtering happens in the database; the full guest
 * list is never loaded into the browser.
 */
export async function listGuests(
  eventId: string,
  params: ListGuestsParams = {},
): Promise<GuestListResult> {
  // Ownership gate: owner derived server-side; notFound() if not owned.
  await requireEventAccess(eventId, 'guests', 'view');
  const supabase = await createClient();

  const pageSize = getGuestsPageSize();
  const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
  const offset = (page - 1) * pageSize;

  const column = resolveSortColumn(params.sort);
  const dir = resolveDir(params.dir);

  let query = supabase
    .from('guests')
    .select(GUEST_LIST_COLUMNS, { count: 'exact' })
    .eq('event_id', eventId);

  if (params.search) {
    const filter = buildSearchFilter(params.search);
    if (filter) query = query.or(filter);
  }

  // Enum filters: validate against the DB enum so an invalid value is IGNORED
  // (never forwarded to the query). `maybe` is a valid guest_status here.
  if (params.status && isGuestStatus(params.status)) {
    query = query.eq('status', params.status);
  }
  if (params.contactStatus && isContactStatus(params.contactStatus)) {
    query = query.eq('contact_status', params.contactStatus);
  }
  if (params.groupId) {
    query = query.eq('group_id', params.groupId);
  }
  // Business-overage filter — the computed field is filterable server-side
  // (PostgREST computed fields participate in horizontal filtering).
  if (params.overInvited) {
    query = query.filter('over_invited', 'eq', true);
  }

  const { data, error, count } = await query
    .order(column, { ascending: dir === 'asc' })
    // Stable tiebreaker so pages don't shuffle rows with equal sort keys.
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new Error('טעינת המוזמנים נכשלה');
  }

  // Documented boundary cast (repo pattern, same as the RPC casts): the select
  // includes the `over_invited` computed field, which generated types cannot
  // express — the row shape is asserted here, kept in sync with
  // GUEST_LIST_COLUMNS.
  const rows = (data ?? []) as unknown as GuestListQueryRow[];

  // Batched latest-delivery lookup (B6). delivery_status lives on OUTBOUND
  // contact_interactions keyed by `contact_id` (NOT guest_id — that column is
  // only populated by inbound RSVP replies, a disjoint set of rows). Sends are
  // per-contact, so per-contact delivery is the correct granularity (two guests
  // sharing a phone correctly show the same state). ONE query for the whole page
  // (no N+1): fetch this event's outbound interactions for the page's contacts,
  // newest first, and keep the first (latest) seen per contact.
  const contactIds = Array.from(
    new Set(
      rows
        .map((r) => r.contact_id)
        .filter((id): id is string => id !== null),
    ),
  );

  const deliveryByContact = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: interactions, error: iErr } = await supabase
      .from('contact_interactions')
      .select('contact_id, delivery_status, created_at')
      .eq('event_id', eventId)
      .eq('direction', 'out')
      .in('contact_id', contactIds)
      .not('delivery_status', 'is', null)
      .order('created_at', { ascending: false });
    // A delivery-badge lookup failure must not break the guest list; degrade to
    // no delivery badges rather than throwing.
    if (!iErr && interactions) {
      for (const row of interactions) {
        if (
          row.contact_id &&
          row.delivery_status &&
          !deliveryByContact.has(row.contact_id)
        ) {
          deliveryByContact.set(row.contact_id, row.delivery_status);
        }
      }
    }
  }

  // Flatten the embedded contact (op_status/removal_requested) and attach the
  // per-contact delivery status. Keeps the nested embed object out of the DTO.
  const items: GuestListItem[] = rows.map((r) => {
    const contact = r.contacts; // { op_status, removal_requested } | null (FK embed)
    const contactId = r.contact_id;
    return {
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      status: r.status,
      contact_status: r.contact_status,
      group_id: r.group_id,
      expected_count: r.expected_count,
      confirmed_adults: r.confirmed_adults,
      confirmed_kids: r.confirmed_kids,
      confirmed_headcount: r.confirmed_headcount,
      callback_requested: r.callback_requested,
      created_at: r.created_at,
      contact_id: contactId,
      over_invited: r.over_invited === true,
      op_status: contact?.op_status ?? null,
      removal_requested: contact?.removal_requested ?? null,
      delivery_status: contactId
        ? deliveryByContact.get(contactId) ?? null
        : null,
    };
  });

  return {
    items,
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Fetch a single guest within an owned event, or null if not found. */
export async function getGuest(
  eventId: string,
  guestId: string,
): Promise<GuestDetail | null> {
  await requireEventAccess(eventId, 'guests', 'view');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('guests')
    .select(GUEST_DETAIL_COLUMNS)
    .eq('event_id', eventId)
    .eq('id', guestId)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת המוזמן נכשלה');
  }
  return data;
}

// Fields a caller may set when creating/updating a guest. Deliberately omits
// id / event_id / rsvp_token / extras — those are server-controlled.
export interface GuestWriteInput {
  full_name: string;
  phone?: string | null;
  status?: GuestStatus;
  contact_status?: ContactStatus;
  group_id?: string | null;
  expected_count?: number | null;
  note?: string | null;
}

/**
 * Create a guest under an owned event. `event_id` is taken from the verified
 * ownership gate, never from input; `rsvp_token` is intentionally NOT set so
 * the DB default generates it.
 */
export async function createGuest(
  eventId: string,
  input: GuestWriteInput,
): Promise<GuestListItem> {
  await requireEventAccess(eventId, 'guests', 'create');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('guests')
    .insert({
      event_id: eventId,
      full_name: input.full_name,
      phone: input.phone ?? null,
      status: input.status,
      contact_status: input.contact_status,
      group_id: input.group_id ?? null,
      expected_count: input.expected_count ?? null,
      note: input.note ?? null,
    })
    .select(GUEST_LIST_COLUMNS)
    .single();

  if (error || !data) {
    throwFriendlyGuestError(error, 'יצירת המוזמן נכשלה');
  }
  // Same boundary cast as listGuests (over_invited computed field).
  const row = data as unknown as GuestListQueryRow;

  await logActivity({
    eventId,
    action: 'guest.created',
    meta: {
      guestId: data.id,
      groupId: data.group_id,
      status: data.status,
      contactStatus: data.contact_status,
      fields: Object.keys(input),
    },
  });

  // Flatten the embedded contact into the same DTO shape listGuests returns. A
  // freshly-created guest has no contact link or outbound send yet, so the
  // webhook-driven fields are null; the mapping stays robust if a contact embed
  // is ever present.
  const { contacts, over_invited, ...rest } = row;
  return {
    ...rest,
    over_invited: over_invited === true,
    op_status: contacts?.op_status ?? null,
    removal_requested: contacts?.removal_requested ?? null,
    delivery_status: null,
  };
}

/**
 * Update a guest within an owned event. The update is scoped by BOTH event_id
 * and id, and the patch never includes event_id/id/rsvp_token, so those cannot
 * be changed via this path.
 */
export async function updateGuest(
  eventId: string,
  guestId: string,
  patch: Partial<GuestWriteInput>,
): Promise<GuestDetail> {
  await requireEventAccess(eventId, 'guests', 'edit');
  const supabase = await createClient();
  const previous = await getGuest(eventId, guestId);

  // Build the update payload from the allow-listed fields only.
  const update: Database['public']['Tables']['guests']['Update'] = {};
  if (patch.full_name !== undefined) update.full_name = patch.full_name;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.contact_status !== undefined)
    update.contact_status = patch.contact_status;
  if (patch.group_id !== undefined) update.group_id = patch.group_id;
  if (patch.expected_count !== undefined)
    update.expected_count = patch.expected_count;
  if (patch.note !== undefined) update.note = patch.note;

  const { data, error } = await supabase
    .from('guests')
    .update(update)
    .eq('event_id', eventId)
    .eq('id', guestId)
    .select(GUEST_DETAIL_COLUMNS)
    .single();

  if (error || !data) {
    throwFriendlyGuestError(error, 'עדכון המוזמן נכשל');
  }

  await logActivity({
    eventId,
    action: 'guest.updated',
    meta: {
      guestId,
      previousStatus: previous?.status ?? null,
      status: data.status,
      previousContactStatus: previous?.contact_status ?? null,
      contactStatus: data.contact_status,
      previousGroupId: previous?.group_id ?? null,
      groupId: data.group_id,
      fields: Object.keys(patch),
    },
  });

  return data;
}

/** Delete a guest within an owned event. */
export async function deleteGuest(
  eventId: string,
  guestId: string,
): Promise<void> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();
  const previous = await getGuest(eventId, guestId);

  // Capture the guest's contact link before deleting — its contact may be left
  // orphaned (no other guest shares the phone) and must be pruned for billing
  // integrity.
  const { data: link } = await supabase
    .from('guests')
    .select('contact_id')
    .eq('event_id', eventId)
    .eq('id', guestId)
    .maybeSingle();
  const contactId =
    (link as { contact_id: string | null } | null)?.contact_id ?? null;

  const { error } = await supabase
    .from('guests')
    .delete()
    .eq('event_id', eventId)
    .eq('id', guestId);

  if (error) {
    throw new Error('מחיקת המוזמן נכשלה');
  }

  // P0-1 (A6): reconcile the campaign set BEFORE pruning — the RPC decides
  // remove-vs-pin (a serviced/billed contact stays pinned), and the hardened
  // prune then refuses to delete a still-authorized member. Kill-switch gated.
  if (contactId) {
    await reconcileCampaignSetForContact(eventId, 'delete', contactId);
    // Prune the now-possibly-orphaned contact (safe: keeps any with history or
    // set membership).
    await pruneOrphanContact(eventId, contactId);
  }

  await logActivity({
    eventId,
    action: 'guest.deleted',
    meta: {
      guestId,
      groupId: previous?.group_id ?? null,
      status: previous?.status ?? null,
    },
  });
}

/** Update only a guest's contact status (used by the list quick-action). */
export async function updateContactStatus(
  eventId: string,
  guestId: string,
  contactStatus: ContactStatus,
): Promise<void> {
  await requireEventAccess(eventId, 'guests', 'edit');
  const supabase = await createClient();
  const previous = await getGuest(eventId, guestId);

  const { error } = await supabase
    .from('guests')
    .update({ contact_status: contactStatus })
    .eq('event_id', eventId)
    .eq('id', guestId);

  if (error) {
    throw new Error('עדכון סטטוס יצירת הקשר נכשל');
  }

  await logActivity({
    eventId,
    action: 'guest.contact_status_updated',
    meta: {
      guestId,
      previousContactStatus: previous?.contact_status ?? null,
      contactStatus,
    },
  });
}

// ---------------------------------------------------------------------------
// Guest groups
// ---------------------------------------------------------------------------

/** List all groups for an owned event. */
export async function listGroups(eventId: string): Promise<GuestGroup[]> {
  await requireEventAccess(eventId, 'guests', 'view');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('guest_groups')
    .select(GROUP_COLUMNS)
    .eq('event_id', eventId)
    .order('name', { ascending: true });

  if (error) {
    throw new Error('טעינת הקבוצות נכשלה');
  }
  return data ?? [];
}

// People-level totals (guest_totals RPC, SECURITY INVOKER — RLS scopes it):
// counts PEOPLE, not rows — a household row invited as 4 counts 4; attending
// prefers the WhatsApp-confirmed headcount, else adults+kids (min 1 per row).
export interface GuestTotals {
  rows: number;
  invited_people: number;
  attending_rows: number;
  attending_people: number;
  declined_rows: number;
  maybe_rows: number;
  pending_rows: number;
  /** Attending rows whose real answer exceeds the invited size (business overage, not an error). */
  over_invited_rows: number;
  /** Surplus people across those rows (effective minus invited). */
  over_invited_people: number;
}

export async function getGuestTotals(eventId: string): Promise<GuestTotals> {
  await requireEventAccess(eventId, 'guests', 'view');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('guest_totals', {
    _event_id: eventId,
  });
  if (error || data == null) {
    throw new Error('טעינת סיכום המוזמנים נכשלה');
  }
  // Documented boundary cast: the RPC returns Json; its shape is fixed by the
  // function definition and modelled by GuestTotals above.
  return data as unknown as GuestTotals;
}

export interface GroupWriteInput {
  name: string;
  color?: string | null;
}

/** Create a group under an owned event. */
export async function createGroup(
  eventId: string,
  input: GroupWriteInput,
): Promise<GuestGroup> {
  await requireEventAccess(eventId, 'guests', 'create');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('guest_groups')
    .insert({
      event_id: eventId,
      name: normalizeGroupName(input.name),
      color: input.color ?? null,
    })
    .select(GROUP_COLUMNS)
    .single();

  if (error || !data) {
    if (error && isUniqueViolation(error, 'guest_groups_event_name_key')) {
      throw new Error(GROUP_NAME_TAKEN_ERROR);
    }
    throw new Error('יצירת הקבוצה נכשלה');
  }

  await logActivity({
    eventId,
    action: 'group.created',
    meta: {
      groupId: data.id,
      fields: Object.keys(input),
    },
  });

  return data;
}

/** Update a group within an owned event. */
export async function updateGroup(
  eventId: string,
  groupId: string,
  patch: Partial<GroupWriteInput>,
): Promise<GuestGroup> {
  await requireEventAccess(eventId, 'guests', 'edit');
  const supabase = await createClient();

  const update: Database['public']['Tables']['guest_groups']['Update'] = {};
  if (patch.name !== undefined) update.name = normalizeGroupName(patch.name);
  if (patch.color !== undefined) update.color = patch.color;

  const { data, error } = await supabase
    .from('guest_groups')
    .update(update)
    .eq('event_id', eventId)
    .eq('id', groupId)
    .select(GROUP_COLUMNS)
    .single();

  if (error || !data) {
    if (error && isUniqueViolation(error, 'guest_groups_event_name_key')) {
      throw new Error(GROUP_NAME_TAKEN_ERROR);
    }
    throw new Error('עדכון הקבוצה נכשל');
  }

  await logActivity({
    eventId,
    action: 'group.updated',
    meta: {
      groupId,
      fields: Object.keys(patch),
    },
  });

  return data;
}

/** Delete a group within an owned event. */
export async function deleteGroup(
  eventId: string,
  groupId: string,
): Promise<void> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();

  const { error } = await supabase
    .from('guest_groups')
    .delete()
    .eq('event_id', eventId)
    .eq('id', groupId);

  if (error) {
    throw new Error('מחיקת הקבוצה נכשלה');
  }

  await logActivity({
    eventId,
    action: 'group.deleted',
    meta: {
      groupId,
    },
  });
}

// ---------------------------------------------------------------------------
// Bulk insert (CSV import)
// ---------------------------------------------------------------------------

// A single guest to bulk-insert. group_id is already resolved server-side.
export interface BulkGuestInput {
  full_name: string;
  phone?: string | null;
  group_id?: string | null;
  expected_count?: number | null;
}

/**
 * Insert many guests for an owned event in a SINGLE statement (no N+1). Each
 * row gets event_id from the verified ownership gate; rsvp_token is left to the
 * DB default. Returns the number of rows inserted.
 */
export async function bulkInsertGuests(
  eventId: string,
  guests: BulkGuestInput[],
): Promise<number> {
  await requireEventAccess(eventId, 'guests', 'create');
  if (guests.length === 0) return 0;
  const supabase = await createClient();

  const rows = guests.map((g) => ({
    event_id: eventId,
    full_name: g.full_name,
    phone: g.phone ?? null,
    group_id: g.group_id ?? null,
    expected_count: g.expected_count ?? null,
  }));

  // Select only ids so we can count without pulling personal data back.
  const { data, error } = await supabase
    .from('guests')
    .insert(rows)
    .select('id');

  if (error) {
    throwFriendlyGuestError(error, 'ייבוא המוזמנים נכשל');
  }

  const inserted = data?.length ?? 0;

  // P0-1 (A6): a bulk import into a LIVE campaign must link each new contact and
  // admit it to the authorized set (up to funded_cap) instead of silently
  // dropping it. Kill-switch gated (inert by default → import behaves exactly as
  // before). Best-effort per row; the guests are already committed. `insert
  // ... returning` preserves input order, so rows[i] ↔ data[i].
  if (isReconcileEnabled() && inserted > 0 && data) {
    for (let i = 0; i < data.length; i++) {
      const phone = rows[i]?.phone ?? null;
      if (!phone) continue;
      try {
        const { contactId } = await linkGuestContact(eventId, data[i].id, phone);
        if (contactId) {
          await reconcileCampaignSetForContact(eventId, 'add', contactId);
        }
      } catch (err) {
        console.error(
          `[contacts] bulk contact sync failed (event=${eventId} guest=${data[i].id}): ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
  }

  return inserted;
}

// ---------------------------------------------------------------------------
// Import merge suggestions (review screen): recognize an incoming row as the
// SAME person as an existing guest and let the owner choose, PER FIELD, what to
// merge. Never automatic; never a DB constraint (names are non-unique).
// ---------------------------------------------------------------------------

// The guest fields an import row may merge into an existing guest. NEVER
// id / rsvp_token / status / RSVP-headcount state / contact_id.
export type MergeFieldKey = 'full_name' | 'group' | 'expected_count';

// One differing, mergeable field inside a match. `fill` = the existing value is
// empty (default: take incoming); otherwise it is an overwrite (default: keep
// existing). Values are display strings ('' when absent).
export interface MergeFieldDiff {
  field: MergeFieldKey;
  existing: string;
  incoming: string;
  fill: boolean;
}

// One incoming row recognized as an existing guest.
//  • 'name'  — incoming HAS a phone, existing is PHONE-LESS, names match. The
//    phone is ADDED on merge (anchor); merge is opt-OUT (default on) — unmerge
//    ⇒ import as a new guest.
//  • 'phone' — incoming phone already belongs to the existing guest; the row can
//    never be inserted (unique index) so it is always dropped. Field updates are
//    opt-IN; no field chosen ⇒ the row is simply skipped.
export interface ImportMatch {
  direction: 'name' | 'phone';
  rowIndex: number;
  existingGuestId: string;
  existingName: string;
  incomingName: string;
  /** name-match: the phone added to the existing guest; phone-match: null. */
  addsPhone: string | null;
  /** differing mergeable fields (equal / empty-incoming fields are omitted). */
  fields: MergeFieldDiff[];
}

export interface ExistingGuestForMatch {
  id: string;
  full_name: string;
  phone: string | null;
  expected_count: number | null;
  group_name: string | null;
}
export interface IncomingRowForMatch {
  full_name: string;
  phone: string | null;
  group: string;
  expected_count: number | null;
}

function diffField(
  field: MergeFieldKey,
  existing: string,
  incoming: string,
  equal: boolean,
): MergeFieldDiff | null {
  if (incoming.trim() === '') return null; // nothing to add
  if (equal) return null; // no choice to make
  return { field, existing, incoming, fill: existing.trim() === '' };
}

function fieldDiffs(
  existing: ExistingGuestForMatch,
  row: IncomingRowForMatch,
): MergeFieldDiff[] {
  const out: MergeFieldDiff[] = [];
  const name = diffField(
    'full_name',
    existing.full_name ?? '',
    row.full_name ?? '',
    normalizeGuestName(existing.full_name ?? '') ===
      normalizeGuestName(row.full_name ?? ''),
  );
  if (name) out.push(name);
  const group = diffField(
    'group',
    existing.group_name ?? '',
    row.group ?? '',
    normalizeGroupName(existing.group_name ?? '').toLowerCase() ===
      normalizeGroupName(row.group ?? '').toLowerCase(),
  );
  if (group) out.push(group);
  const count = diffField(
    'expected_count',
    existing.expected_count == null ? '' : String(existing.expected_count),
    row.expected_count == null ? '' : String(row.expected_count),
    existing.expected_count === row.expected_count,
  );
  if (count) out.push(count);
  return out;
}

// Pure matcher (unit-tested). Phone identity beats name identity: a row whose
// phone matches an existing guest is a 'phone' match and is NOT also offered as
// a 'name' match. Each existing guest is claimed by at most one row.
export function computeImportMatches(
  existing: ExistingGuestForMatch[],
  rows: IncomingRowForMatch[],
): ImportMatch[] {
  const byPhone = new Map<string, ExistingGuestForMatch>();
  const byNamePhoneless = new Map<string, ExistingGuestForMatch>();
  for (const g of existing) {
    const np = g.phone ? normalizePhone(g.phone) : null;
    if (np) {
      if (!byPhone.has(np)) byPhone.set(np, g);
    } else {
      const key = normalizeGuestName(g.full_name);
      if (key && !byNamePhoneless.has(key)) byNamePhoneless.set(key, g);
    }
  }
  const out: ImportMatch[] = [];
  const claimed = new Set<string>();
  rows.forEach((r, rowIndex) => {
    const np = r.phone ? normalizePhone(r.phone) : null;
    if (np) {
      const g = byPhone.get(np);
      if (g && !claimed.has(g.id)) {
        claimed.add(g.id);
        out.push({
          direction: 'phone',
          rowIndex,
          existingGuestId: g.id,
          existingName: g.full_name,
          incomingName: r.full_name,
          addsPhone: null,
          fields: fieldDiffs(g, r),
        });
        return;
      }
    }
    if (r.phone) {
      const key = normalizeGuestName(r.full_name);
      const g = key ? byNamePhoneless.get(key) : undefined;
      if (g && !claimed.has(g.id)) {
        claimed.add(g.id);
        out.push({
          direction: 'name',
          rowIndex,
          existingGuestId: g.id,
          existingName: g.full_name,
          incomingName: r.full_name,
          addsPhone: r.phone,
          fields: fieldDiffs(g, r),
        });
      }
    }
  });
  return out;
}

// Fetch the event's guests (with group name) and compute the review matches.
export async function findImportMatches(
  eventId: string,
  rows: IncomingRowForMatch[],
): Promise<ImportMatch[]> {
  await requireEventAccess(eventId, 'guests', 'create');
  const supabase = await createClient();
  const { data } = await supabase
    .from('guests')
    .select('id, full_name, phone, expected_count, group_id, guest_groups(name)')
    .eq('event_id', eventId);
  type Raw = {
    id: string;
    full_name: string;
    phone: string | null;
    expected_count: number | null;
    guest_groups: { name: string } | { name: string }[] | null;
  };
  const existing: ExistingGuestForMatch[] = ((data ?? []) as unknown as Raw[]).map(
    (g) => {
      const gg = g.guest_groups;
      const group_name = Array.isArray(gg)
        ? (gg[0]?.name ?? null)
        : (gg?.name ?? null);
      return {
        id: g.id,
        full_name: g.full_name,
        phone: g.phone,
        expected_count: g.expected_count,
        group_name,
      };
    },
  );
  return computeImportMatches(existing, rows);
}

// Apply a chosen merge patch onto an existing guest (id + event scoped). Only
// provided, non-empty fields are written; the guest keeps its id, rsvp_token
// and RSVP state. A 23505 (a chosen phone would collide with a THIRD guest) →
// the friendly "phone taken" error.
export async function applyGuestMerge(
  eventId: string,
  guestId: string,
  patch: {
    phone?: string;
    full_name?: string | null;
    group_id?: string | null;
    expected_count?: number | null;
  },
): Promise<void> {
  await requireEventAccess(eventId, 'guests', 'create');
  const update: Database['public']['Tables']['guests']['Update'] = {};
  if (patch.phone && patch.phone.trim() !== '') update.phone = patch.phone;
  if (patch.full_name && patch.full_name.trim() !== '')
    update.full_name = patch.full_name.trim();
  if ('group_id' in patch) update.group_id = patch.group_id ?? null;
  if (patch.expected_count != null) update.expected_count = patch.expected_count;
  if (Object.keys(update).length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('guests')
    .update(update)
    .eq('id', guestId)
    .eq('event_id', eventId);
  if (error) throwFriendlyGuestError(error, 'עדכון המוזמן נכשל');
}
