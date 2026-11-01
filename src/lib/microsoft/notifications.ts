import type { WebhookInboxInsert } from '@/lib/data/webhooks';

// Normalizes one Microsoft Graph delivery into webhook_inbox rows — the route
// (src/app/api/webhooks/microsoft-graph/route.ts) only persists what this
// returns. Pure on purpose: it runs inside Graph's 3-second budget, so it
// classifies from the notification alone and never calls Graph.
//
// One route serves three kinds:
//   graph_mail      a message filed into the intake folder (inquiry-mail-intake.ts)
//   graph_calendar  a console agent's calendar changed (console-agent-calendar-presence.ts)
//   graph_lifecycle a subscription was removed, missed changes, or needs
//                   reauthorizing — only calendar subscriptions ask for these

export const GRAPH_MAIL_KIND = 'graph_mail';
export const GRAPH_CALENDAR_KIND = 'graph_calendar';
export const GRAPH_LIFECYCLE_KIND = 'graph_lifecycle';

export type GraphNotification = {
  id?: string;
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  lifecycleEvent?: string;
  resource?: string;
  resourceData?: { id?: string; '@odata.type'?: string; '@odata.etag'?: string };
  subscriptionExpirationDateTime?: string;
};

/**
 * A calendar notification, told apart by its own fields. Only a POSITIVE match
 * is calendar; anything else stays mail, exactly as every notification was
 * before calendar subscriptions existed. MEASURED 30.10.2026: every stored
 * intake row carries `@odata.type` '#Microsoft.Graph.Message' and a resource of
 * the form Users/<id>/Messages/<id>.
 */
function isCalendarNotification(n: GraphNotification): boolean {
  if ((n.resourceData?.['@odata.type'] ?? '').toLowerCase() === '#microsoft.graph.event') return true;
  return /\/events[/(]/i.test(n.resource ?? '');
}

// The stored copy drops `clientState`: it IS the webhook secret, and nothing
// downstream reads it.
function storedPayload(n: GraphNotification): WebhookInboxInsert['payload'] {
  const stored: GraphNotification = { ...n };
  delete stored.clientState;
  return stored as WebhookInboxInsert['payload'];
}

function row(
  eventKind: string,
  dedupeKey: string,
  messageId: string | null,
  n: GraphNotification,
): WebhookInboxInsert {
  return {
    provider: 'graph',
    event_kind: eventKind,
    // Graph redelivers notifications by design; the (provider, dedupe_key)
    // unique index is what makes that harmless at this layer.
    dedupe_key: dedupeKey,
    message_id: messageId,
    context_message_id: null,
    phone_number_id: null,
    event_at: null,
    payload: storedPayload(n),
  };
}

const HOUR_MS = 60 * 60_000;

export function graphNotificationRows(
  notifications: readonly GraphNotification[],
  expectedClientState: string,
  nowMs: number = Date.now(),
): WebhookInboxInsert[] {
  const rows: WebhookInboxInsert[] = [];
  for (const n of notifications) {
    // Per-notification, not per-request: one delivery can batch notifications
    // from several subscriptions, and only ours are trustworthy.
    if (n.clientState !== expectedClientState) continue;
    const subscriptionId = n.subscriptionId ?? '';

    // A lifecycle notification carries no resource data at all, so it is
    // branched on first.
    if (n.lifecycleEvent) {
      // Keyed to the hour: a redelivery of the same event collapses, while the
      // same event raised again later (a second `missed`) is a row of its own.
      const hour = Math.floor(nowMs / HOUR_MS);
      rows.push(row(GRAPH_LIFECYCLE_KIND, `graph-lifecycle:${subscriptionId}:${n.lifecycleEvent}:${hour}`, null, n));
      continue;
    }

    if (isCalendarNotification(n)) {
      // An event keeps its id across updates, so the id alone would drop every
      // change after the first. The etag moves with each change; a deletion
      // happens once.
      const eventId = n.resourceData?.id ?? '';
      const version = n.resourceData?.['@odata.etag'] ?? n.id ?? '';
      rows.push(
        row(
          GRAPH_CALENDAR_KIND,
          `graph-calendar:${subscriptionId}:${eventId}:${n.changeType ?? ''}:${version}`,
          null,
          n,
        ),
      );
      continue;
    }

    const messageId = n.resourceData?.id;
    if (!messageId) continue;
    rows.push(row(GRAPH_MAIL_KIND, `graph-mail:${messageId}`, messageId, n));
  }
  return rows;
}
