import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { getSumitServerConfig } from '@/lib/data/payments';
import {
  listSumitHolds,
  SUMIT_HOLD_STATUS_RELEASED,
} from '@/lib/sumit/crm-holds';
import type { TablesInsert } from '@/lib/supabase/types';

// SUMIT hold-release reconciler (worker, every 30m — worker/main.ts). SUMIT
// exposes no API to release a J5 hold or to notify us when one is released
// manually in their dashboard — this is the read-only sync that discovers it
// after the fact and updates campaigns.release_status to match.
//
// Scope, deliberately narrow (see queues.ts's sumitHoldReconcile comment):
//   - Only campaigns with hold_order_document_id set — authorize.ts started
//     persisting that id 2026-08-30. Older open holds (verified live that
//     date: all 4 then-open holds had it null) need a one-time manual
//     backfill; this job does not attempt to guess a match by amount/date.
//   - Only the 1 (open) -> 3 (released) transition. Billing_Status 2
//     (charged) is ignored on purpose: charging always goes through
//     closeCampaignAndCharge, never discovered after the fact from SUMIT.
//
// Write path: a direct admin insert into activity_log, NOT logActivity —
// logActivity calls requireUser() and the worker has no session (same
// pattern as recordRsvpFromWhatsapp in interactions.ts). Best-effort: an
// audit-row failure never blocks the release_status sync itself.
const MAX_IDS_IN_ALERT = 5;

interface OpenHoldRow {
  id: string;
  event_id: string;
  hold_order_document_id: number;
  auth_amount: number | null;
}

export interface SumitHoldReconcileResult {
  checked: number;
  released: number;
  // true when the run could not even attempt a comparison (no SUMIT config,
  // or the SUMIT call itself failed) — distinct from checked:0 via "nothing
  // to check", which is the common, healthy case.
  failed: boolean;
}

async function recordReleaseActivity(row: OpenHoldRow): Promise<void> {
  try {
    const admin = createAdminClient();
    const activityRow: TablesInsert<'activity_log'> = {
      event_id: row.event_id,
      user_id: null,
      action: 'campaign.hold_released_synced',
      meta: {
        campaignId: row.id,
        holdOrderDocumentId: row.hold_order_document_id,
        amount: row.auth_amount,
      } as unknown as TablesInsert<'activity_log'>['meta'],
    };
    await admin.from('activity_log').insert(activityRow);
  } catch {
    // Deliberately swallowed: the marker is non-fatal and never logs PII.
  }
}

export async function runSumitHoldReconcile(): Promise<SumitHoldReconcileResult> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('campaigns')
    .select('id, event_id, hold_order_document_id, auth_amount')
    .eq('capture_status', 'authorized')
    .not('hold_order_document_id', 'is', null)
    .or('release_status.is.null,release_status.neq.released');

  if (error) return { checked: 0, released: 0, failed: true };
  const rows = (data ?? []) as OpenHoldRow[];
  if (rows.length === 0) return { checked: 0, released: 0, failed: false };

  const config = await getSumitServerConfig();
  if (!config) return { checked: rows.length, released: 0, failed: true };

  let entities;
  try {
    entities = await listSumitHolds({ companyId: config.companyId, apiKey: config.apiKey });
  } catch {
    return { checked: rows.length, released: 0, failed: true };
  }

  const byOrderDocId = new Map(entities.map((e) => [e.orderDocumentId, e]));
  const releasedIds: string[] = [];

  for (const row of rows) {
    const match = byOrderDocId.get(row.hold_order_document_id);
    if (!match || match.billingStatus !== SUMIT_HOLD_STATUS_RELEASED) continue;

    const { data: updated, error: updateError } = await admin
      .from('campaigns')
      .update({ release_status: 'released' })
      .eq('id', row.id)
      .or('release_status.is.null,release_status.neq.released')
      .select('id');
    if (updateError || !updated || updated.length === 0) continue;

    releasedIds.push(row.id);
    await recordReleaseActivity(row);
  }

  if (releasedIds.length > 0) {
    void sendSlackAlert({
      level: 'info',
      category: 'campaign_billing',
      source: 'sumit-hold-reconcile',
      title: `${releasedIds.length} תפיסת/ות מסגרת שוחררו ב-SUMIT — סונכרן ל-release_status`,
      detail:
        releasedIds.slice(0, MAX_IDS_IN_ALERT).join(', ') +
        (releasedIds.length > MAX_IDS_IN_ALERT ? ' …' : ''),
    });
  }

  return { checked: rows.length, released: releasedIds.length, failed: false };
}
