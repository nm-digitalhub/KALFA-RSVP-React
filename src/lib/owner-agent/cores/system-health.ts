import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for webhook-intake health (owner-agent tool 9,
// system_health; plan §5). Takes a service-role client and returns numbers
// only. Authorization is the caller's: view_webhooks — decision 9.10
// (recommended default, assumed) — checked by admin/webhook-inbox.ts
// getWebhookHealth (the /admin/webhooks header strip and /admin/debug), which
// reads its three numbers through the functions below, and by the owner
// agent's server-side permission resolution (plan §3.2).
//
// This is a READ of webhook_inbox only. It does NOT call
// runWhatsAppHealthCheck: that is a live Graph probe that can send alerts, so
// it is not read-only (plan §5, tool 9).
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs).
//
// Privacy: `payload` (phones, names, message text), dedupe_key, message ids
// and last_error text are never selected. Counts are head-only; the three
// "latest/oldest" reads select ONE timestamp column of ONE row, and the
// summary turns it into minutes, so no timestamp string reaches the agent.
//
// Errors THROW: a failed count must not reach the owner as a confident 0. The
// admin header strip keeps its historical fail-soft zeros in its own adapter.

type AdminClient = ReturnType<typeof createAdminClient>;

// The worker's claim cap: claim_webhook_events only returns rows with
// attempts < 5 (supabase/migrations/202606300036_webhook_claim_skip_locked.sql),
// so an unprocessed row at 5 attempts is dead-lettered — it stays for the
// admin inspector and is never retried.
export const WEBHOOK_CLAIM_ATTEMPT_CAP = 5;

const MINUTE_MS = 60_000;

function head(client: AdminClient) {
  return client.from('webhook_inbox').select('id', { count: 'exact', head: true });
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}

// --- The three numbers of the /admin/webhooks header strip -----------------

// Most recent received_at (served by webhook_inbox_received_idx).
export async function latestWebhookReceivedAt(client: AdminClient): Promise<string | null> {
  const { data, error } = await client
    .from('webhook_inbox')
    .select('received_at')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('read_latest_received_failed');
  return data?.received_at ?? null;
}

// Not processed yet — includes rows that are erroring and dead-lettered ones.
export async function countUnprocessedWebhooks(client: AdminClient): Promise<number> {
  return countOf(await head(client).is('processed_at', null), 'count_unprocessed_failed');
}

// Rows carrying a last_error — the page's "failed" count. NOTE: this includes
// rows that errored once and were processed on a later attempt; the
// inspector's 'error' state (webhookProcessState) is only unprocessed rows with
// an error, reported below as erroringNow. The page's number keeps its
// historical meaning; the two are distinct fields, not one redefined.
export async function countWebhooksWithLastError(client: AdminClient): Promise<number> {
  return countOf(await head(client).not('last_error', 'is', null), 'count_last_error_failed');
}

// --- The agent summary -------------------------------------------------------

export interface SystemHealthSummary {
  // Current state (not range-bound).
  unprocessed: number;
  withLastError: number; // = the /admin/webhooks "failed" number (see above)
  erroringNow: number; // unprocessed with an error, still being retried
  deadLettered: number; // unprocessed at the claim cap, never retried
  minutesSinceLastReceived: number | null;
  minutesSinceLastProcessed: number | null;
  // Age of the oldest row still waiting for the worker (unprocessed, under the
  // claim cap). null = nothing waiting. Grows when the worker is down.
  oldestPendingMinutes: number | null;
  // Within the range.
  receivedInRange: number;
}

function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / MINUTE_MS));
}

export async function getSystemHealthSummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<SystemHealthSummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  const [
    unprocessed,
    withLastError,
    erroringNow,
    deadLettered,
    lastReceived,
    lastProcessed,
    oldestPending,
    receivedInRange,
  ] = await Promise.all([
    countUnprocessedWebhooks(client),
    countWebhooksWithLastError(client),
    head(client).is('processed_at', null).not('last_error', 'is', null),
    head(client).is('processed_at', null).gte('attempts', WEBHOOK_CLAIM_ATTEMPT_CAP),
    latestWebhookReceivedAt(client),
    // processed_at has no index, so this is a scan + top-1 sort over
    // webhook_inbox (~900 rows on 2026-09-24). One timestamp column, one row.
    client
      .from('webhook_inbox')
      .select('processed_at')
      .not('processed_at', 'is', null)
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Served by the partial index webhook_inbox_unprocessed_idx (received_at
    // WHERE processed_at IS NULL).
    client
      .from('webhook_inbox')
      .select('received_at')
      .is('processed_at', null)
      .lt('attempts', WEBHOOK_CLAIM_ATTEMPT_CAP)
      .order('received_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    head(client).gte('received_at', sinceIso),
  ]);
  if (lastProcessed.error) throw new Error('read_latest_processed_failed');
  if (oldestPending.error) throw new Error('read_oldest_pending_failed');

  return {
    unprocessed,
    withLastError,
    erroringNow: countOf(erroringNow, 'count_erroring_failed'),
    deadLettered: countOf(deadLettered, 'count_dead_lettered_failed'),
    minutesSinceLastReceived: minutesSince(lastReceived, nowMs),
    minutesSinceLastProcessed: minutesSince(lastProcessed.data?.processed_at ?? null, nowMs),
    oldestPendingMinutes: minutesSince(oldestPending.data?.received_at ?? null, nowMs),
    receivedInRange: countOf(receivedInRange, 'count_received_in_range_failed'),
  };
}
