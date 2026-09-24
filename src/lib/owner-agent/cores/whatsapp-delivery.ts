import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { rangeStartIso, type OwnerAgentRange } from '@/lib/owner-agent/range';

// Request-free CORE for WhatsApp delivery counts (owner-agent tool 7,
// whatsapp_delivery_summary; plan §5). Takes a service-role client and returns
// numbers only. Authorization is the caller's: view_webhooks — decision 9.10
// (recommended default, assumed): WhatsApp delivery counts and webhook health
// sit under view_webhooks, the permission of the /admin/webhooks inspector
// that shows the same delivery states row by row.
//
// No imports of the DAL or of request-scoped Next APIs (enforced by the
// `owner-agent-request-free` rule in .dependency-cruiser.cjs).
//
// Privacy: head-only counts over contact_interactions. No provider_id (wamid),
// contact, guest, event or payload_meta is selected. The only codes in the
// result are the fixed catalogue below, as object KEYS; every value is a count.
//
// Semantics: outbound messages CREATED (sent) within the range, bucketed by
// their CURRENT delivery_status (the latest status Meta reported — a message
// sent yesterday and read today counts as read). Inbound = messages received
// within the range.
//
// Errors THROW: a failed count must not reach the owner as a confident 0.

type AdminClient = ReturnType<typeof createAdminClient>;

// Meta delivery-failure codes counted one by one. Every other failure (an
// uncatalogued code, or a failure with no code) is `other`, computed as
// failed − Σ catalogued, so no code needs to be read out of a row and the
// output keys stay a fixed set.
//
// Sources: codes seen on the live table (131026, 130472 — measured 2026-09-24,
// counts only), the codes the app already handles (131026 in
// webhook-processing.ts WRONG_NUMBER_CODES; 131049/131047 in the send and
// template-health paths), the template rejections of src/lib/whatsapp/client.ts
// DEFINITELY_NOT_SENT_CODES that can also arrive asynchronously, and Meta's
// Cloud API error-code reference for the rate limits. Restated here rather than
// imported: client.ts is the send client, and this core must not pull the
// send path into its import graph.
export const WHATSAPP_FAILURE_CODES = [
  '131026', // message undeliverable (not on WhatsApp / old app / ToS)
  '131049', // per-user marketing limit ("healthy ecosystem")
  '131047', // re-engagement required (outside the 24h window)
  '131050', // user stopped marketing messages
  '130472', // user number is part of a Meta experiment
  '131000', // generic failure
  '131048', // spam rate limit
  '131056', // business-to-user pair rate limit
  '130429', // throughput rate limit
  '132001', // template does not exist / not approved in the language
  '132015', // template paused
  '132016', // template disabled
] as const;
export type WhatsAppFailureCode = (typeof WHATSAPP_FAILURE_CODES)[number];

export interface WhatsAppDeliverySummary {
  outbound: {
    total: number;
    unacknowledged: number; // no status from Meta yet
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    otherStatus: number; // total − the five buckets above (any other value)
  };
  inbound: number;
  failedByCode: Record<WhatsAppFailureCode | 'other', number>;
}

export async function getWhatsAppDeliverySummary(
  client: AdminClient,
  range: OwnerAgentRange,
  nowMs: number = Date.now(),
): Promise<WhatsAppDeliverySummary> {
  const sinceIso = rangeStartIso(range, nowMs);
  const inRange = () =>
    client
      .from('contact_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'whatsapp')
      .gte('created_at', sinceIso);
  const out = () => inRange().eq('direction', 'out');

  const [statusResults, codeResults] = await Promise.all([
    Promise.all([
      out(),
      out().is('delivery_status', null),
      out().eq('delivery_status', 'sent'),
      out().eq('delivery_status', 'delivered'),
      out().eq('delivery_status', 'read'),
      out().eq('delivery_status', 'failed'),
      inRange().eq('direction', 'in'),
    ]),
    Promise.all(
      WHATSAPP_FAILURE_CODES.map((code) =>
        out().eq('delivery_status', 'failed').eq('delivery_error_code', code),
      ),
    ),
  ]);

  const [total, unacknowledged, sent, delivered, read, failed, inbound] = statusResults.map(
    (r) => countOf(r, 'count_whatsapp_delivery_failed'),
  );
  const codeCounts = codeResults.map((r) => countOf(r, 'count_whatsapp_error_code_failed'));
  // Looked up by code, not by position, so reordering the catalogue cannot
  // shift a count onto the wrong key.
  const c = (code: WhatsAppFailureCode) => codeCounts[WHATSAPP_FAILURE_CODES.indexOf(code)];

  const failedByCode: Record<WhatsAppFailureCode | 'other', number> = {
    '131026': c('131026'),
    '131049': c('131049'),
    '131047': c('131047'),
    '131050': c('131050'),
    '130472': c('130472'),
    '131000': c('131000'),
    '131048': c('131048'),
    '131056': c('131056'),
    '130429': c('130429'),
    '132001': c('132001'),
    '132015': c('132015'),
    '132016': c('132016'),
    other: Math.max(0, failed - codeCounts.reduce((a, b) => a + b, 0)),
  };

  return {
    outbound: {
      total,
      unacknowledged,
      sent,
      delivered,
      read,
      failed,
      otherStatus: Math.max(0, total - (unacknowledged + sent + delivered + read + failed)),
    },
    inbound,
    failedByCode,
  };
}

function countOf(result: { count: number | null; error: unknown }, code: string): number {
  if (result.error) throw new Error(code);
  return result.count ?? 0;
}
