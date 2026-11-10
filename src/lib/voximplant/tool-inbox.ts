import 'server-only';

import { insertWebhookEvents } from '@/lib/data/webhooks';
import type { TablesInsert } from '@/lib/supabase/types';

type WebhookInboxInsert = TablesInsert<'webhook_inbox'>;

/**
 * The PERSIST half of persist-then-process for a token-gated Voximplant
 * endpoint: one durable webhook_inbox row the drain retries from.
 *
 * `message_id` carries the TOKEN-verified attempt id — the drain resolves
 * identity from it, never from the payload. UNIQUE(provider, dedupe_key) makes
 * a re-delivery of the same key a no-op, so the caller's `dedupeKey` decides
 * what counts as "the same event". Throws when nothing was stored; the caller
 * answers 500 and must not go on to process.
 */
export async function persistVoxInboxEvent(input: {
  eventKind: string;
  dedupeKey: string;
  attemptId: string;
  /** The schema-validated request body, stored as-is. */
  payload: object;
}): Promise<void> {
  const row: WebhookInboxInsert = {
    provider: 'voximplant',
    event_kind: input.eventKind,
    dedupe_key: input.dedupeKey,
    message_id: input.attemptId,
    event_at: new Date().toISOString(),
    // A Zod-parsed body is plain JSON data; its inferred type just is not the
    // generated `Json` union (optional keys), hence the one cast for all callers.
    payload: input.payload as unknown as WebhookInboxInsert['payload'],
  };
  await insertWebhookEvents([row]);
}
