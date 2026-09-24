import 'server-only';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePage, type PageParams, type PageResult } from '@/lib/data/admin/shared';
import type { Json, Tables } from '@/lib/supabase/types';
import {
  countUnprocessedWebhooks,
  countWebhooksWithLastError,
  latestWebhookReceivedAt,
} from '@/lib/owner-agent/cores/system-health';
// The role vocabulary is a Postgres enum, so these labels are keyed by the generated
// type — a role added to the database without a label here is a tsc error, not a raw
// snake_case string leaking onto an admin's screen.
import {
  ROLE_LABELS as NUMBER_ROLE_LABELS,
  type NumberRole,
} from '@/lib/validation/provider-numbers';
// Admin Webhook Inspector data layer. Reads the durable `webhook_inbox` intake
// table behind requireAdmin() with the service-role client (the table is
// admin-only RLS; service-role bypasses it — the policy is defence-in-depth).
//
// PII: the raw `payload` holds phones/names. It is projected OFF the list (detail
// only), and NOTHING here ever logs a payload, dedupe_key, message_id, or phone.

type WebhookInboxRow = Tables<'webhook_inbox'>;

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

// What the worker DID with the event — the inspector's "תוצאה" section.
// Inbound message: the interaction it became (event / campaign / billable +
// the RPC verdict + whether a billed_results row exists), the staged import it
// produced, the opt-out it carried. Status: the outbound interaction it updated.
export interface WebhookOutcome {
  inbound: {
    eventName: string | null;
    eventStatus: string | null;
    campaignStatus: string | null;
    billable: boolean;
    billingOutcome: string | null;
    billed: boolean;
    removalRequested: boolean;
  } | null;
  outbound: {
    eventName: string | null;
    deliveryStatus: string | null;
    deliveryErrorCode: string | null;
  } | null;
  staging: {
    id: string;
    status: string;
    rowCount: number;
    eventId: string;
    eventName: string | null;
  } | null;
}

export interface WebhookDeliveryView {
  id: string;
  body: Json;
  receivedAt: string;
  byteLength: number;
}

export interface AdminWebhookDetailView {
  item: AdminWebhookDetail;
  // The verified envelope exactly as Meta sent it (null for rows persisted
  // before deliveries were stored, or when the store failed).
  delivery: WebhookDeliveryView | null;
  outcome: WebhookOutcome;
  // Which of OUR business numbers received it — resolved against the admin
  // config, never hardcoded. null = not one of the configured numbers.
  businessNumber: { label: string; phoneNumberId: string } | null;
}

async function loadEventNames(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, { name: string | null; status: string | null }>> {
  const out = new Map<string, { name: string | null; status: string | null }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  const { data } = await admin.from('events').select('id, name, status').in('id', unique);
  for (const e of data ?? []) out.set(e.id, { name: e.name, status: e.status });
  return out;
}

// Detail view: the row + its raw delivery + what became of it. A handful of
// point lookups by primary/unique key (no scans), all admin-client.
export async function getWebhookInboxDetail(
  id: string,
): Promise<AdminWebhookDetailView | null> {
  await requirePlatformPermission('view_webhooks');
  const admin = createAdminClient();
  const { data: item, error } = await admin
    .from('webhook_inbox')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת אירוע הוובהוק נכשלה');
  if (!item) return null;

  const messageId = item.message_id;
  const [deliveryRes, inboundRes, outboundRes, stagingRes, billedRes, settingsRes] =
    await Promise.all([
      item.delivery_id
        ? admin
            .from('webhook_deliveries')
            .select('id, body, received_at, byte_length')
            .eq('id', item.delivery_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      messageId && item.event_kind === 'message'
        ? admin
            .from('contact_interactions')
            .select('event_id, campaign_id, contact_id, billable, billing_outcome')
            .eq('provider_id', messageId)
            .eq('direction', 'in')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      messageId && item.event_kind === 'status'
        ? admin
            .from('contact_interactions')
            .select('event_id, delivery_status, delivery_error_code')
            .eq('provider_id', messageId)
            .eq('direction', 'out')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      messageId && item.event_kind === 'message'
        ? admin
            .from('guest_import_staging')
            .select('id, status, row_count, event_id')
            .eq('source_message_id', messageId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      messageId && item.event_kind === 'message'
        ? admin
            .from('billed_results')
            .select('id', { count: 'exact', head: true })
            .eq('provider_ref', messageId)
        : Promise.resolve({ count: 0 }),
      // Resolved against provider_numbers, not app_settings.whatsapp_phone_number_id.
      // That column names ONE number — the RSVP sender — so every message that
      // arrived on any other number of ours rendered as "not configured", which is
      // gap G2. This WABA holds two (measured 2026-09-10), and the second one has
      // been receiving guest-list files the whole time.
      item.provider === 'whatsapp' && item.phone_number_id
        ? admin
            .from('provider_numbers')
            .select('display_label, provider_number_roles(role)')
            .eq('provider', 'meta_whatsapp')
            .eq('provider_ref', item.phone_number_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const inbound = inboundRes.data;
  const outbound = outboundRes.data;
  const staging = stagingRes.data;

  const [eventNames, campaignRes, contactRes] = await Promise.all([
    loadEventNames(admin, [
      inbound?.event_id ?? '',
      outbound?.event_id ?? '',
      staging?.event_id ?? '',
    ]),
    inbound?.campaign_id
      ? admin.from('campaigns').select('status').eq('id', inbound.campaign_id).maybeSingle()
      : Promise.resolve({ data: null }),
    inbound?.contact_id
      ? admin
          .from('contacts')
          .select('removal_requested')
          .eq('id', inbound.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Three states, kept distinct because they send a reader to three places: a number
  // we know and have named, a number we know but nobody has given a job, and a number
  // that is not in the table at all (sync it, or it is not ours).
  const numberRow = settingsRes.data as
    | { display_label: string | null; provider_number_roles?: Array<{ role: NumberRole }> }
    | null;
  const businessNumber =
    item.phone_number_id && numberRow
      ? {
          label:
            numberRow.display_label ??
            (numberRow.provider_number_roles ?? [])
              .map((r) => NUMBER_ROLE_LABELS[r.role] ?? r.role)
              .join(', ') ??
            '',
          phoneNumberId: item.phone_number_id,
        }
      : null;
  if (businessNumber && businessNumber.label === '') {
    businessNumber.label = 'מספר ללא תפקיד';
  }

  return {
    item,
    delivery: deliveryRes.data
      ? {
          id: deliveryRes.data.id,
          body: deliveryRes.data.body,
          receivedAt: deliveryRes.data.received_at,
          byteLength: deliveryRes.data.byte_length,
        }
      : null,
    outcome: {
      inbound: inbound
        ? {
            eventName: inbound.event_id ? (eventNames.get(inbound.event_id)?.name ?? null) : null,
            eventStatus: inbound.event_id
              ? (eventNames.get(inbound.event_id)?.status ?? null)
              : null,
            campaignStatus: campaignRes.data?.status ?? null,
            billable: inbound.billable,
            billingOutcome: inbound.billing_outcome,
            billed: (billedRes.count ?? 0) > 0,
            removalRequested: contactRes.data?.removal_requested === true,
          }
        : null,
      outbound: outbound
        ? {
            eventName: outbound.event_id ? (eventNames.get(outbound.event_id)?.name ?? null) : null,
            deliveryStatus: outbound.delivery_status,
            deliveryErrorCode: outbound.delivery_error_code,
          }
        : null,
      staging: staging
        ? {
            id: staging.id,
            status: staging.status,
            rowCount: staging.row_count,
            eventId: staging.event_id,
            eventName: eventNames.get(staging.event_id)?.name ?? null,
          }
        : null,
    },
    businessNumber,
  };
}

export interface WebhookFilter extends PageParams {
  // Which integration sent the event: whatsapp | graph | voximplant | resend.
  // This is the COARSE endpoint filter. It is deliberately not called
  // "endpoint", because provider is NOT 1:1 with a route — VERIFIED 2026-08-26
  // by enumerating every insert site: 'voximplant' is written by six different
  // routes (cb, agent-tool/{rsvp,note,dnc}, mtg/tool/dnc, sls/tool/dnc).
  // `event_kind` is what identifies the individual route; the two together are
  // the endpoint. The column was always selected and displayed but could not be
  // filtered on, so one provider's traffic could not be isolated.
  provider?: string;
  // event_kind — the FINE endpoint filter, 1:1 with a route except
  // /api/webhooks/whatsapp, which emits both 'message' and 'status'.
  // NOT limited to 'message' | 'status': those are only WhatsApp's.
  kind?: string;
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
  await requirePlatformPermission('view_webhooks');
  const { page, pageSize, from, to } = resolvePage(filter.page);
  const admin = createAdminClient();

  let query = admin
    .from('webhook_inbox')
    .select(LIST_COLUMNS, { count: 'exact' });

  if (filter.provider) query = query.eq('provider', filter.provider);
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
    // Strip every char with meaning in a raw PostgREST `.or()` filter string
    // (`, ( ) * % "` plus backslash) before wrapping in `*…*` — same sanitiser
    // as guests.ts/activity.ts, so no injected clause is possible.
    const cleaned = filter.q.replace(/[,()*%"\\]/g, '').trim();
    if (cleaned) {
      const pattern = `*${cleaned}*`;
      query = query.or(
        `message_id.ilike.${pattern},context_message_id.ilike.${pattern},phone_number_id.ilike.${pattern}`,
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
  await requirePlatformPermission('view_webhooks');
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

// Fail-soft adapter: the header strip has always shown 0 / "—" for a read that
// failed rather than failing the page (/admin/debug additionally catches), and
// that stays. The core throws, so the agent never reports a failed read as 0.
async function orFallback<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch {
    return fallback;
  }
}

// Header strip: last-received timestamp + unprocessed / failed counts. The
// three reads are the owner-agent system_health core's own functions
// (src/lib/owner-agent/cores/system-health.ts), so the page and the agent
// count with the same predicates.
export async function getWebhookHealth(): Promise<WebhookHealth> {
  await requirePlatformPermission('view_webhooks');
  const admin = createAdminClient();

  const [receivedLast, unprocessedCount, failedCount] = await Promise.all([
    orFallback(latestWebhookReceivedAt(admin), null),
    orFallback(countUnprocessedWebhooks(admin), 0),
    orFallback(countWebhooksWithLastError(admin), 0),
  ]);

  return { receivedLast, unprocessedCount, failedCount };
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
  await requirePlatformPermission('view_webhooks');

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
