import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

// Durable intake for provider webhooks (B2). The signature-verified route
// normalizes events and inserts them here; a pg-boss worker processes them
// out-of-band (persist-then-process), so the economic logic never depends on the
// HTTP request lifetime and Meta retries can't double-bill. All writes are
// service-role (the webhook is signature-authed, not session-authed). Payloads
// hold PII (phones/names) — NEVER log a row or its payload.

export type WebhookInboxInsert =
  Database['public']['Tables']['webhook_inbox']['Insert'];
export type WebhookInboxRow =
  Database['public']['Tables']['webhook_inbox']['Row'];

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
  if (error) throw new Error('שמירת אירועי הוובהוק נכשלה');
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
  if (error) throw new Error('טעינת אירועי הוובהוק נכשלה');
  return (data ?? []) as WebhookInboxRow[];
}

// Mark a row done (terminal — never reclaimed).
export async function markWebhookEventProcessed(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('webhook_inbox')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('עדכון אירוע הוובהוק נכשל');
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
