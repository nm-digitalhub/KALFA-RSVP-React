import 'server-only';

import { requireAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePage, type PageParams, type PageResult } from '@/lib/data/admin/shared';
import type { Database } from '@/lib/supabase/types';

// Admin Webhook Inspector data layer. Reads the durable `webhook_inbox` intake
// table behind requireAdmin() with the service-role client (the table is
// admin-only RLS; service-role bypasses it — the policy is defence-in-depth).
//
// PII: the raw `payload` holds phones/names. It is projected OFF the list (detail
// only), and NOTHING here ever logs a payload, dedupe_key, message_id, or phone.

type WebhookInboxRow = Database['public']['Tables']['webhook_inbox']['Row'];

// List projection — display columns only; the heavy/PII `payload` is fetched on
// demand in the detail view.
export type AdminWebhookRow = Pick<
  WebhookInboxRow,
  | 'id'
  | 'provider'
  | 'event_kind'
  | 'dedupe_key'
  | 'message_id'
  | 'context_message_id'
  | 'phone_number_id'
  | 'event_at'
  | 'received_at'
  | 'processed_at'
  | 'attempts'
  | 'last_error'
>;

export type AdminWebhookDetail = WebhookInboxRow;

export type WebhookState = 'pending' | 'processed' | 'error';

export interface WebhookFilter extends PageParams {
  kind?: string; // event_kind: 'message' | 'status'
  state?: string; // pending | processed | error
  from?: string; // received_at >=
  to?: string; // received_at <=
  q?: string; // technical ids only: message_id / context_message_id / phone_number_id
}

const LIST_COLUMNS =
  'id, provider, event_kind, dedupe_key, message_id, context_message_id, phone_number_id, event_at, received_at, processed_at, attempts, last_error';

// Server-filtered, paginated list (newest first). Filters run in the DB, never in
// the browser. `q` matches ONLY technical identifiers — never a guest phone.
export async function listWebhookInbox(
  filter: WebhookFilter = {},
): Promise<PageResult<AdminWebhookRow>> {
  await requireAdmin();
  const { page, pageSize, from, to } = resolvePage(filter.page);
  const admin = createAdminClient();

  let query = admin
    .from('webhook_inbox')
    .select(LIST_COLUMNS, { count: 'exact' });

  if (filter.kind) query = query.eq('event_kind', filter.kind);
  if (filter.state === 'pending') {
    query = query.is('processed_at', null).is('last_error', null);
  } else if (filter.state === 'processed') {
    query = query.not('processed_at', 'is', null);
  } else if (filter.state === 'error') {
    query = query.is('processed_at', null).not('last_error', 'is', null);
  }
  if (filter.from) query = query.gte('received_at', filter.from);
  if (filter.to) query = query.lte('received_at', filter.to);
  if (filter.q) {
    const term = filter.q.trim().replace(/[%,]/g, '');
    if (term) {
      query = query.or(
        `message_id.ilike.%${term}%,context_message_id.ilike.%${term}%,phone_number_id.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await query
    .order('received_at', { ascending: false })
    .range(from, to);
  if (error) throw new Error('טעינת אירועי הוובהוק נכשלה');

  return {
    items: (data ?? []) as unknown as AdminWebhookRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

// One row including the raw payload (detail view).
export async function getWebhookInboxItem(
  id: string,
): Promise<AdminWebhookDetail | null> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('webhook_inbox')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת אירוע הוובהוק נכשלה');
  return data ?? null;
}

export interface WebhookHealth {
  receivedLast: string | null;
  unprocessedCount: number;
  failedCount: number;
}

// Header strip: last-received timestamp + unprocessed / failed counts.
export async function getWebhookHealth(): Promise<WebhookHealth> {
  await requireAdmin();
  const admin = createAdminClient();

  const [last, unprocessed, failed] = await Promise.all([
    admin
      .from('webhook_inbox')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('webhook_inbox')
      .select('id', { count: 'exact', head: true })
      .is('processed_at', null),
    admin
      .from('webhook_inbox')
      .select('id', { count: 'exact', head: true })
      .not('last_error', 'is', null),
  ]);

  return {
    receivedLast: last.data?.received_at ?? null,
    unprocessedCount: unprocessed.count ?? 0,
    failedCount: failed.count ?? 0,
  };
}

export interface WebhookAssociation {
  // Non-PII event name the row belongs to (absent = not associated yet).
  eventName?: string;
  // For a status row: the CURRENT delivery state of the referenced outbound
  // message (from contact_interactions — NOT PII). Absent for message rows.
  deliveryStatus?: string;
}

// Resolve each row to its EVENT (non-PII hint) and, for status rows, the current
// delivery state of the outbound message it refers to — both through the outbound
// wamid it references (inbound message → its context wamid; status → its own
// wamid). Fully BATCHED — two queries total regardless of page size (never N+1).
export async function resolveWebhookAssociations(
  rows: AdminWebhookRow[],
): Promise<Map<string, WebhookAssociation>> {
  const wamidByRow = new Map<string, string>();
  const wamids = new Set<string>();
  for (const r of rows) {
    const wamid = r.event_kind === 'message' ? r.context_message_id : r.message_id;
    if (wamid) {
      wamidByRow.set(r.id, wamid);
      wamids.add(wamid);
    }
  }
  if (wamids.size === 0) return new Map();

  const admin = createAdminClient();
  const { data: interactions } = await admin
    .from('contact_interactions')
    .select('provider_id, event_id, delivery_status')
    .eq('direction', 'out')
    .in('provider_id', [...wamids]);

  const ciByWamid = new Map<
    string,
    { eventId: string | null; deliveryStatus: string | null }
  >();
  const eventIds = new Set<string>();
  for (const ci of interactions ?? []) {
    if (!ci.provider_id) continue;
    ciByWamid.set(ci.provider_id, {
      eventId: ci.event_id,
      deliveryStatus: ci.delivery_status,
    });
    if (ci.event_id) eventIds.add(ci.event_id);
  }

  const nameByEvent = new Map<string, string>();
  if (eventIds.size > 0) {
    const { data: events } = await admin
      .from('events')
      .select('id, name')
      .in('id', [...eventIds]);
    for (const e of events ?? []) {
      if (e.id) nameByEvent.set(e.id, e.name);
    }
  }

  const out = new Map<string, WebhookAssociation>();
  for (const [rowId, wamid] of wamidByRow) {
    const ci = ciByWamid.get(wamid);
    if (!ci) continue;
    const row = rows.find((r) => r.id === rowId);
    out.set(rowId, {
      eventName: ci.eventId ? nameByEvent.get(ci.eventId) : undefined,
      deliveryStatus:
        row?.event_kind === 'status'
          ? ci.deliveryStatus ?? undefined
          : undefined,
    });
  }
  return out;
}
