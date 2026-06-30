import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireOwnedEvent } from '@/lib/data/events';
import { pruneOrphanContact } from '@/lib/data/contacts';
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
  'id, full_name, phone, status, contact_status, group_id, expected_count, confirmed_adults, confirmed_kids, callback_requested, created_at, contact_id, contacts(op_status, removal_requested)';

// Columns for a single guest (edit form). Adds note/meal_pref but still
// excludes rsvp_token and extras.
export const GUEST_DETAIL_COLUMNS =
  'id, full_name, phone, status, contact_status, group_id, expected_count, confirmed_adults, confirmed_kids, meal_pref, note, callback_requested, created_at, updated_at';

export const GROUP_COLUMNS = 'id, event_id, name, color, created_at';

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
  | 'callback_requested'
  | 'created_at'
  | 'contact_id'
> & {
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
  await requireOwnedEvent(eventId);
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

  const { data, error, count } = await query
    .order(column, { ascending: dir === 'asc' })
    // Stable tiebreaker so pages don't shuffle rows with equal sort keys.
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (error) {
    throw new Error('טעינת המוזמנים נכשלה');
  }

  const rows = data ?? [];

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
      callback_requested: r.callback_requested,
      created_at: r.created_at,
      contact_id: contactId,
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
  await requireOwnedEvent(eventId);
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
  await requireOwnedEvent(eventId);
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
    throw new Error('יצירת המוזמן נכשלה');
  }

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
  const { contacts, ...rest } = data;
  return {
    ...rest,
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
  await requireOwnedEvent(eventId);
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
    throw new Error('עדכון המוזמן נכשל');
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

  // Prune the now-possibly-orphaned contact (safe: keeps any with history).
  if (contactId) {
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
  await requireOwnedEvent(eventId);
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
  await requireOwnedEvent(eventId);
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

export interface GroupWriteInput {
  name: string;
  color?: string | null;
}

/** Create a group under an owned event. */
export async function createGroup(
  eventId: string,
  input: GroupWriteInput,
): Promise<GuestGroup> {
  await requireOwnedEvent(eventId);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('guest_groups')
    .insert({
      event_id: eventId,
      name: input.name,
      color: input.color ?? null,
    })
    .select(GROUP_COLUMNS)
    .single();

  if (error || !data) {
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
  await requireOwnedEvent(eventId);
  const supabase = await createClient();

  const update: Database['public']['Tables']['guest_groups']['Update'] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.color !== undefined) update.color = patch.color;

  const { data, error } = await supabase
    .from('guest_groups')
    .update(update)
    .eq('event_id', eventId)
    .eq('id', groupId)
    .select(GROUP_COLUMNS)
    .single();

  if (error || !data) {
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
  await requireOwnedEvent(eventId);
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
    throw new Error('ייבוא המוזמנים נכשל');
  }

  const inserted = data?.length ?? 0;

  return inserted;
}
