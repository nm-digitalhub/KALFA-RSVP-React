import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { callbackStatusLabel } from '@/lib/data/admin/labels';
import type { Database } from '@/lib/supabase/types';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: read the audit trail (activity_log). Authorized by the request-scoped
// session under the `al_admin_all` RLS policy plus a server-side requireAdmin()
// gate. The writer lives in `@/lib/data/activity`; this is the read side for
// the admin journal.
//
// PRIVACY: `meta` is contractually free of raw PII. We surface structured
// summaries, ids, and timestamps, and render the raw JSON only as a fallback
// within the admin UI.

type ActivityRow = Database['public']['Tables']['activity_log']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export type ActivityEntry = Pick<
  ActivityRow,
  'id' | 'action' | 'event_id' | 'user_id' | 'meta' | 'created_at'
>;

export type ActivityActor = Pick<ProfileRow, 'id' | 'full_name'>;

export interface ActivityDisplayEntry {
  id: string;
  action: string;
  actionLabel: string;
  actorLabel: string;
  targetLabel: string;
  summary: string;
  details: string | null;
  metaPreview: string | null;
  created_at: string;
  event_id: string | null;
  user_id: string | null;
  meta: ActivityEntry['meta'];
}

export interface ActivityFilterState {
  action?: string;
  userId?: string;
  entity?: string;
  search?: string;
  from?: string;
  to?: string;
  // Instance filters: narrow to a single target record. `eventId` matches the
  // activity_log.event_id column; the others match ids stored inside the `meta`
  // jsonb (deep-linkable, e.g. "show all activity for this guest").
  eventId?: string;
  guestId?: string;
  groupId?: string;
  packageId?: string;
}

// meta-jsonb instance filters: param name → json key. Driven by a single map so
// the filter stays a text `->>'key'` comparison (cannot error like a uuid column
// and cannot inject — both column path and operator are fixed).
const INSTANCE_META_KEYS = {
  guestId: 'guestId',
  groupId: 'groupId',
  packageId: 'packageId',
} as const;

export interface ActivityActorOption {
  id: string;
  label: string;
}

export interface ActivityEntityOption {
  value: string;
  label: string;
}

export const ACTIVITY_COLUMNS = 'id, action, event_id, user_id, meta, created_at';

const ACTION_LABELS: Record<string, string> = {
  'event.created': 'אירוע נוצר',
  'event.updated': 'אירוע עודכן',
  'guest.created': 'מוזמן נוסף',
  'guest.updated': 'מוזמן עודכן',
  'guest.deleted': 'מוזמן נמחק',
  'guest.contact_status_updated': 'סטטוס יצירת קשר עודכן',
  'group.created': 'קבוצה נוצרה',
  'group.updated': 'קבוצה עודכנה',
  'group.deleted': 'קבוצה נמחקה',
  'guests.imported': 'ייבוא מוזמנים',
  'profile.updated': 'פרופיל עודכן',
  'settings.updated': 'הגדרות עודכנו',
  'password.reset_requested': 'איפוס סיסמה נשלח',
  'callback.status_updated': 'סטטוס בקשה עודכן',
  'package.created': 'חבילה נוצרה',
  'package.updated': 'חבילה עודכנה',
  'package.deleted': 'חבילה נמחקה',
};

export const ACTIVITY_ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

// ---------------------------------------------------------------------------
// Target-entity facet.
//
// Each action follows an `entity.verb` shape. The coarse target entity is the
// segment before the first dot, with the plural bulk-import action folded back
// onto the singular `guest` entity. Driving the facet from ACTION_LABELS keeps
// a single source of truth: a new action automatically joins its entity group.
// ---------------------------------------------------------------------------
function actionEntity(action: string): string {
  const prefix = action.split('.')[0];
  return prefix === 'guests' ? 'guest' : prefix;
}

const ENTITY_LABELS: Record<string, string> = {
  event: 'אירוע',
  guest: 'מוזמנים',
  group: 'קבוצות',
  package: 'חבילות',
  profile: 'פרופיל',
  settings: 'הגדרות',
  password: 'סיסמה',
  callback: 'בקשות חזרה',
};

// Maps each known entity to the list of action codes that belong to it. Used to
// translate the entity facet into a parameterised `.in('action', …)` filter.
const ENTITY_ACTIONS: Record<string, string[]> = Object.keys(ACTION_LABELS).reduce(
  (map, action) => {
    const entity = actionEntity(action);
    (map[entity] ??= []).push(action);
    return map;
  },
  {} as Record<string, string[]>,
);

export const ACTIVITY_ENTITY_OPTIONS: ActivityEntityOption[] = Object.keys(
  ENTITY_ACTIONS,
)
  .map((value) => ({ value, label: ENTITY_LABELS[value] ?? value }))
  .sort((a, b) => a.label.localeCompare(b.label, 'he'));

const TARGET_LABELS: Record<string, string> = {
  'event.created': 'אירוע',
  'event.updated': 'אירוע',
  'guest.created': 'מוזמן',
  'guest.updated': 'מוזמן',
  'guest.deleted': 'מוזמן',
  'guest.contact_status_updated': 'מוזמן',
  'group.created': 'קבוצה',
  'group.updated': 'קבוצה',
  'group.deleted': 'קבוצה',
  'guests.imported': 'ייבוא',
  'profile.updated': 'פרופיל',
  'settings.updated': 'הגדרות',
  'password.reset_requested': 'איפוס סיסמה',
  'callback.status_updated': 'בקשת חזרה',
  'package.created': 'חבילה',
  'package.updated': 'חבילה',
  'package.deleted': 'חבילה',
};

function shortId(value: string): string {
  return value.slice(0, 8);
}

function metaRecord(meta: unknown): Record<string, unknown> {
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function getStrings(meta: Record<string, unknown>, key: string): string[] {
  return stringList(meta[key]);
}

function getString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function getNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeDateParam(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function buildDateBounds(from?: string, to?: string): {
  from: string | null;
  to: string | null;
} {
  const safeFrom = normalizeDateParam(from);
  const safeTo = normalizeDateParam(to);

  if (!safeFrom || !safeTo) {
    return {
      from: safeFrom,
      to: safeTo,
    };
  }

  if (safeFrom <= safeTo) {
    return { from: safeFrom, to: safeTo };
  }

  return { from: safeTo, to: safeFrom };
}

function formatFields(fields: string[]): string | null {
  return fields.length > 0 ? fields.join(', ') : null;
}

export function previewMeta(meta: unknown): string | null {
  if (meta === null || meta === undefined) return null;
  if (typeof meta === 'object' && Object.keys(meta as object).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(meta);
  } catch {
    return null;
  }
}

export function getActivityActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function getActivityTargetLabel(action: string): string {
  return TARGET_LABELS[action] ?? 'פעילות';
}

function utcDayStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function utcDayEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function formatStatusTransition(previous: string | null, next: string | null): string | null {
  if (!previous && !next) return null;
  if (!previous) return next;
  if (!next) return previous;
  return `${previous} → ${next}`;
}

function describeDetails(entry: ActivityEntry): string | null {
  const meta = metaRecord(entry.meta);
  const fields = getStrings(meta, 'fields');

  switch (entry.action) {
    case 'event.created':
    case 'event.updated':
      return [
        getString(meta, 'eventType') ? `סוג: ${getString(meta, 'eventType')}` : null,
        getString(meta, 'status') ? `סטטוס: ${getString(meta, 'status')}` : null,
        formatFields(fields) ? `שדות: ${formatFields(fields)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    case 'guest.created':
    case 'guest.updated':
    case 'guest.deleted':
      return [
        getString(meta, 'groupId') ? `קבוצה: ${getString(meta, 'groupId')}` : null,
        getString(meta, 'guestId') ? `מזהה מוזמן: ${getString(meta, 'guestId')}` : null,
        getString(meta, 'status') ? `סטטוס: ${getString(meta, 'status')}` : null,
        getString(meta, 'contactStatus')
          ? `יצירת קשר: ${getString(meta, 'contactStatus')}`
          : null,
        formatFields(fields) ? `שדות: ${formatFields(fields)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    case 'guest.contact_status_updated':
      return [
        getString(meta, 'guestId') ? `מזהה מוזמן: ${getString(meta, 'guestId')}` : null,
        formatStatusTransition(
          getString(meta, 'previousContactStatus'),
          getString(meta, 'contactStatus'),
        )
          ? `יצירת קשר: ${formatStatusTransition(
              getString(meta, 'previousContactStatus'),
              getString(meta, 'contactStatus'),
            )}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    case 'group.created':
    case 'group.updated':
    case 'group.deleted':
      return [
        getString(meta, 'groupId') ? `מזהה קבוצה: ${getString(meta, 'groupId')}` : null,
        formatFields(fields) ? `שדות: ${formatFields(fields)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    case 'guests.imported':
      return [
        getNumber(meta, 'importedCount') !== null
          ? `יובאו ${getNumber(meta, 'importedCount')}`
          : null,
        getNumber(meta, 'failedCount') !== null
          ? `נכשלו ${getNumber(meta, 'failedCount')}`
          : null,
        getNumber(meta, 'newGroupCount') !== null
          ? `קבוצות חדשות ${getNumber(meta, 'newGroupCount')}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    case 'profile.updated':
    case 'settings.updated':
      return formatFields(fields) ? `שדות: ${formatFields(fields)}` : null;
    case 'password.reset_requested':
      return getString(meta, 'source') ? `מקור: ${getString(meta, 'source')}` : null;
    case 'callback.status_updated':
      return formatStatusTransition(
        getString(meta, 'previousStatus')
          ? callbackStatusLabel(getString(meta, 'previousStatus') as string)
          : null,
        getString(meta, 'status')
          ? callbackStatusLabel(getString(meta, 'status') as string)
          : null,
      )
        ? `סטטוס: ${formatStatusTransition(
            getString(meta, 'previousStatus')
              ? callbackStatusLabel(getString(meta, 'previousStatus') as string)
              : null,
            getString(meta, 'status')
              ? callbackStatusLabel(getString(meta, 'status') as string)
              : null,
          )}`
        : null;
    case 'package.created':
    case 'package.updated':
    case 'package.deleted':
      return [
        getString(meta, 'packageName') ? `חבילה: ${getString(meta, 'packageName')}` : null,
        getString(meta, 'packageId') ? `מזהה: ${getString(meta, 'packageId')}` : null,
        formatFields(fields) ? `שדות: ${formatFields(fields)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null;
    default:
      return formatFields(fields) ? `שדות: ${formatFields(fields)}` : null;
  }
}

export function describeActivity(
  entry: ActivityEntry,
  actorMap?: Map<string, string>,
): ActivityDisplayEntry {
  const actorLabel =
    entry.user_id === null
      ? 'מערכת'
      : actorMap?.get(entry.user_id) ?? `משתמש #${shortId(entry.user_id)}`;

  return {
    id: entry.id,
    action: entry.action,
    actionLabel: getActivityActionLabel(entry.action),
    actorLabel,
    targetLabel: getActivityTargetLabel(entry.action),
    summary: describeDetails(entry) ?? getActivityActionLabel(entry.action),
    details: describeDetails(entry),
    metaPreview: previewMeta(entry.meta),
    created_at: entry.created_at,
    event_id: entry.event_id,
    user_id: entry.user_id,
    meta: entry.meta,
  };
}

// ---------------------------------------------------------------------------
// Free-text search across the journal.
//
// `.or()` takes a RAW PostgREST filter string where `,` separates conditions
// and `*` is the ilike wildcard. To stop an attacker injecting extra
// conditions we strip every char with PostgREST meaning (`, ( ) * % "` plus
// backslash) before wrapping the term in `*…*`. We can only ilike text, so we
// match the `action` code plus the human-meaningful string fields inside the
// jsonb `meta` via `->>` text extraction (uuid columns are not ilike-able).
// ---------------------------------------------------------------------------
const SEARCHABLE_META_KEYS = [
  'packageName',
  'eventType',
  'guestId',
  'groupId',
  'packageId',
  'source',
] as const;

function buildActivitySearchFilter(search: string): string | null {
  const cleaned = search.replace(/[,()*%"\\]/g, '').trim();
  if (cleaned === '') return null;
  const pattern = `*${cleaned}*`;
  return [
    `action.ilike.${pattern}`,
    ...SEARCHABLE_META_KEYS.map((key) => `meta->>${key}.ilike.${pattern}`),
  ].join(',');
}

// List activity entries, newest first, with exact total for pagination.
export async function listActivity(
  {
    page,
    action,
    userId,
    entity,
    search,
    from,
    to,
    eventId,
    guestId,
    groupId,
    packageId,
  }: PageParams & ActivityFilterState = {},
): Promise<PageResult<ActivityEntry>> {
  await requirePlatformPermission('view_activity_log');

  const { page: safePage, pageSize, from: offsetFrom, to: offsetTo } = resolvePage(page);
  const dateBounds = buildDateBounds(from, to);

  const supabase = await createClient();
  let query = supabase
    .from('activity_log')
    .select(ACTIVITY_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (action && action.trim() !== '') {
    query = query.eq('action', action.trim());
  }
  if (userId && userId.trim() !== '') {
    query = query.eq('user_id', userId.trim());
  }
  // Entity facet: only a known entity narrows the query; unknown values are
  // ignored so a tampered param can never widen or break the result set.
  if (entity && ENTITY_ACTIONS[entity]) {
    query = query.in('action', ENTITY_ACTIONS[entity]);
  }
  // Instance filters narrow to one target record (deep-linkable). event_id is a
  // real column; guest/group/package ids live in the meta jsonb.
  if (eventId && eventId.trim() !== '') {
    query = query.eq('event_id', eventId.trim());
  }
  const metaInstanceValues: Record<
    keyof typeof INSTANCE_META_KEYS,
    string | undefined
  > = { guestId, groupId, packageId };
  for (const [param, jsonKey] of Object.entries(INSTANCE_META_KEYS)) {
    const value = metaInstanceValues[param as keyof typeof INSTANCE_META_KEYS];
    if (value && value.trim() !== '') {
      query = query.eq(`meta->>${jsonKey}`, value.trim());
    }
  }
  if (search && search.trim() !== '') {
    const filter = buildActivitySearchFilter(search);
    if (filter) query = query.or(filter);
  }
  if (dateBounds.from) {
    query = query.gte('created_at', utcDayStart(dateBounds.from));
  }
  if (dateBounds.to) {
    query = query.lte('created_at', utcDayEnd(dateBounds.to));
  }

  const { data, error, count } = await query.range(offsetFrom, offsetTo);

  if (error) {
    throw new Error('טעינת היומן נכשלה');
  }

  return {
    items: data ?? [],
    total: count ?? 0,
    page: safePage,
    pageSize,
  };
}

export async function listActivityActorOptions(
  limit = 50,
): Promise<ActivityActorOption[]> {
  await requirePlatformPermission('view_activity_log');

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activity_log')
    .select('user_id')
    .order('created_at', { ascending: false })
    .range(0, safeLimit - 1);

  if (error || !data) {
    return [];
  }

  const userIds = [...new Set(data.flatMap((row) => (row.user_id ? [row.user_id] : [])))];
  if (userIds.length === 0) {
    return [];
  }

  const actorMap = await resolveActivityActors(userIds);
  return [...actorMap.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

// Resolve a batch of user ids to profile full names for actor labels.
export async function resolveActivityActors(
  userIds: string[],
): Promise<Map<string, string>> {
  await requirePlatformPermission('view_activity_log');

  const uniqueUserIds = [...new Set(userIds.filter((id) => id.trim() !== ''))];
  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', uniqueUserIds);

  if (error || !data) {
    return new Map();
  }

  return new Map(
    data.map((row) => [
      row.id,
      row.full_name?.trim() ? row.full_name : `משתמש #${shortId(row.id)}`,
    ]),
  );
}

// Most-recent N activity entries for the dashboard (no pagination). `limit` is
// clamped to a small range to keep the dashboard query cheap.
export async function recentActivity(limit = 5): Promise<ActivityEntry[]> {
  await requirePlatformPermission('view_activity_log');

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 20);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activity_log')
    .select(ACTIVITY_COLUMNS)
    .order('created_at', { ascending: false })
    .range(0, safeLimit - 1);

  if (error) {
    throw new Error('טעינת היומן נכשלה');
  }

  return data ?? [];
}
