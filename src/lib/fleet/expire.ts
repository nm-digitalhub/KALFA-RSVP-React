// The fleet-request expiry sweep: pending requests past expires_at become
// status='expired' (the fleet_requests_guard's legal pending->expired edge,
// same one cmdWithdraw uses). ONE implementation shared by both callers:
//   - worker/main.ts runs it as a pg-boss cron every 10 minutes — the request
//     detail page's answer RPC (fleet_answer_request) deliberately refuses an
//     expired request, so without a frequent sweep an unanswered request past
//     its window shows "pending" in /admin/fleet with no way to close it from
//     the UI (exactly what happened to 84088c5f on 2026-08-23, when the daily
//     chief-of-staff sweep missed its 17:30 slot behind a stale scheduler lock);
//   - fleet-agent-cli's `expire` verb (chief-of-staff step 4) stays as a
//     manual/agent-run backup of the same idempotent UPDATE.
//
// The Slack alert mirrors what the CLI always sent: role+title only, no body —
// requests carry operational text, never guest PII, but the non-PII rule for
// Slack payloads holds regardless.
//
// Throws on DB error: the worker wraps it in guardedWorker (alert + retry next
// tick) and the CLI maps it to fail(), each keeping its existing behavior.

import { sendSlackAlert } from '@/lib/alerts/slack';
import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ExpiredFleetRequest {
  id: string;
  role: string;
  title: string;
}

export async function runFleetExpireSweep(
  admin: AdminClient,
  nowMs: number = Date.now(),
): Promise<{ expired: number; requests: ExpiredFleetRequest[] }> {
  const { data, error } = await admin
    .from('fleet_requests')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lte('expires_at', new Date(nowMs).toISOString())
    .select('id, role, title');
  if (error) throw new Error(`fleet expire sweep failed: ${error.message}`);
  const requests = data ?? [];
  if (requests.length > 0) {
    // warn (not info): a request that died unanswered is an owner-attention
    // signal — same level the CLI verb always used.
    await sendSlackAlert({
      level: 'warn',
      title: `${requests.length} פניות סוכנים פגו ללא מענה`,
      detail: requests
        .map((r) => `${r.role}: ${r.title}`)
        .join(' · ')
        .slice(0, 500),
      source: 'fleet:expire-sweep',
      category: 'errors',
    });
  }
  return { expired: requests.length, requests };
}
