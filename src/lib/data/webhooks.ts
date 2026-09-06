import 'server-only';

import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Json, Tables, TablesInsert } from '@/lib/supabase/types';
// Durable intake for provider webhooks (B2). The signature-verified route
// normalizes events and inserts them here; a pg-boss worker processes them
// out-of-band (persist-then-process), so the economic logic never depends on the
// HTTP request lifetime and Meta retries can't double-bill. All writes are
// service-role (the webhook is signature-authed, not session-authed). Payloads
// hold PII (phones/names) — NEVER log a row or its payload.

export type WebhookInboxInsert =
  TablesInsert<'webhook_inbox'>;
export type WebhookInboxRow =
  Tables<'webhook_inbox'>;

// Idempotent batch insert. UNIQUE(provider, dedupe_key) + ignoreDuplicates makes
// a Meta retry of the same event a no-op, so each provider event is persisted at
// most once. Empty input is a no-op (no round-trip).
export async function insertWebhookEvents(
  rows: WebhookInboxInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from('webhook_inbox')
    .upsert(rows, { onConflict: 'provider,dedupe_key', ignoreDuplicates: true });
  if (error) throw new Error('שמירת אירועי הוובהוק נכשלה', { cause: error });
}

// The verified POST body, stored verbatim (the full provider envelope around
// the normalized events). UNIQUE(provider, body_sha256) makes a provider retry
// of the identical body a no-op — the existing row's id is returned so the
// retried events still point at it. Returns null (and the caller persists its
// events WITHOUT a delivery link) if the store itself fails: the envelope is a
// diagnostic copy, never the source of truth, so it must not cost the events.
// PII inside — never log the body.
export async function insertWebhookDelivery(input: {
  provider: string;
  raw: string;
  body: Json;
}): Promise<string | null> {
  const bodySha256 = createHash('sha256').update(input.raw).digest('hex');
  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from('webhook_deliveries')
    .upsert(
      {
        provider: input.provider,
        body: input.body,
        body_sha256: bodySha256,
        byte_length: Buffer.byteLength(input.raw),
      },
      { onConflict: 'provider,body_sha256', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();
  if (error) return null;
  if (inserted?.id) return inserted.id;
  const { data: existing } = await admin
    .from('webhook_deliveries')
    .select('id')
    .eq('provider', input.provider)
    .eq('body_sha256', bodySha256)
    .maybeSingle();
  return existing?.id ?? null;
}

// The worker's claim: oldest unprocessed rows that have not exhausted their retry
// budget (attempts<5 dead-letters a poison row so one bad event can't stall the
// queue forever — it stays for the admin inspector with its last_error). Goes
// through the claim_webhook_events RPC, which adds `FOR UPDATE SKIP LOCKED` so two
// overlapping worker drains (cron every minute, max:4) receive DISJOINT sets and
// never double-process. The RPC is SECURITY DEFINER + service_role-only.
export async function claimUnprocessedWebhookEvents(
  limit: number,
): Promise<WebhookInboxRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('claim_webhook_events', {
    _limit: limit,
  });
  if (error) throw new Error('טעינת אירועי הוובהוק נכשלה', { cause: error });
  return (data ?? []) as WebhookInboxRow[];
}

// Mark a row done (terminal — never reclaimed).
export async function markWebhookEventProcessed(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('webhook_inbox')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('עדכון אירוע הוובהוק נכשל', { cause: error });
}

// Record a failed attempt: bump the counter and keep the latest error so the
// admin inspector can triage. The row stays unprocessed and is retried until
// attempts reaches the claim cap. `lastError` is an opaque message, never a
// payload.
export async function markWebhookEventFailed(
  id: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('webhook_inbox')
    .update({ attempts, last_error: lastError.slice(0, 500) })
    .eq('id', id);
  if (error) throw new Error('עדכון כשל אירוע הוובהוק נכשל');
}
