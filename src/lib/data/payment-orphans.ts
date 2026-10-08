import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { CARDCOM_ABANDON_AFTER_MINUTES, settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { completeOperation, OperationStateError } from '@/lib/payments/ledger';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

type AdminClient = ReturnType<typeof createAdminClient>;

// Payment operations stuck in flight (worker, every 10 minutes — worker/main.ts; plan:
// docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md, Task 5 step 5א).
//
// A payment operation is written as PENDING *before* the provider is called (ledger.ts beginOperation) and completed
// right after. If the process dies in between — a deploy restarting pm2, an out-of-memory kill, a crash — the row stays
// pending and holds the "pay once" lock for good. Whether SUMIT charged is UNKNOWN, so this sweep never retries and
// never guesses an outcome: it moves the row to REVIEW and tells a person. Review keeps the lock closed too
// (payment_operations_once_uq counts it), so no second charge can start behind it. Only an admin who has checked SUMIT
// opens it again.
//
// WHY 10 MINUTES. The purchase charge carries a 60-second timeout (SUMIT_CHARGE_TIMEOUT_MS), so a pending row that old
// belongs to a process that is gone, not one that is slow. A row that is still pending only because it is waiting
// for the answer is far younger.
// If the original process finishes in the same second the sweep runs, the compare-and-set in completeOperation
// matches nothing and the sweep skips the row.
//
// ONE EXCEPTION: a CardCom purchase (meta.provider = 'cardcom'). Its row is pending while the BUYER fills in the Open Fields
// form, which is not "a process that died" and can take longer than ten minutes. It is never moved to review for its age.
// It is settled from CardCom's side instead (settleCardcomSession): paid → succeeded, and — only once the session is older
// than CARDCOM_ABANDON_AFTER_MINUTES and CardCom confirms there is no payment — failed, so the buyer can try again.
// A row with no session at all never reached the buyer, so nothing can be paid on it: it is closed as failed.
export const ORPHAN_AFTER_MINUTES = 10;

const MAX_IDS_IN_ALERT = 5;

export interface PaymentOrphanSweepResult {
  found: number;
  swept: number;
  // Completed by its own process between the read and the update.
  skipped: number;
  // A database error while closing the row: it is still pending, and the alert says so.
  failed: number;
}

interface PendingRow {
  id: string;
  campaign_id: string;
  event_id: string;
  kind: string;
  recorded_at: string;
  meta: Json;
}

const isCardcom = (meta: Json): boolean =>
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) && meta.provider === 'cardcom';

// A CardCom purchase that has been pending a while: ask CardCom, never guess. Every branch leaves the row either settled
// by settleCardcomSession (which alerts on review / failure itself) or exactly as it was.
async function sweepCardcomRow(admin: AdminClient, row: PendingRow, now: Date): Promise<void> {
  const { data: session, error } = await admin.from('cardcom_payment_sessions').select('low_profile_id').eq('operation_id', row.id).maybeSingle();
  if (error) {
    console.error('[payment-orphans] could not read the CardCom session of a pending purchase', { operationId: row.id });
    return;
  }
  if (!session) {
    // The session was never recorded, so the buyer was never given an id: nothing can have been paid.
    try {
      await completeOperation(admin, row.id, { from: 'pending', outcome: 'failed', note: 'no CardCom session was ever opened for this purchase; nothing was charged' });
    } catch (err) {
      if (!(err instanceof OperationStateError)) console.error('[payment-orphans] could not close a CardCom purchase that has no session', { operationId: row.id });
    }
    return;
  }
  const ageMinutes = (now.getTime() - Date.parse(row.recorded_at)) / 60_000;
  await settleCardcomSession(session.low_profile_id, { finalizeUnpaid: ageMinutes > CARDCOM_ABANDON_AFTER_MINUTES });
}

export async function runPaymentOrphanSweep(
  admin: AdminClient,
  now: Date = new Date(),
): Promise<PaymentOrphanSweepResult> {
  const cutoff = new Date(now.getTime() - ORPHAN_AFTER_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from('payment_operations')
    .select('id, campaign_id, event_id, kind, recorded_at, meta')
    .eq('outcome', 'pending')
    .lt('recorded_at', cutoff);
  // Thrown, not "0 found": a sweep that cannot read must look failed so the job is retried and shows up in the queue.
  if (error) throw new Error('סריקת פעולות התשלום התקועות נכשלה');

  const rows: PendingRow[] = data ?? [];
  const sweptRows: PendingRow[] = [];
  const failedIds: string[] = [];
  let skipped = 0;
  let auditFailed = 0;

  for (const row of rows) {
    if (isCardcom(row.meta)) {
      await sweepCardcomRow(admin, row, now);
      continue;
    }
    try {
      await completeOperation(admin, row.id, {
        from: 'pending',
        outcome: 'review',
        note: `orphaned: process died mid-flight (sweep ${now.toISOString()})`,
      });
    } catch (err) {
      if (err instanceof OperationStateError) {
        skipped += 1;
      } else {
        failedIds.push(row.id);
      }
      continue;
    }
    sweptRows.push(row);

    // Ids only. A direct admin insert, as in sumit-hold-reconcile.ts: the worker has no session for logActivity.
    const { error: auditError } = await admin.from('activity_log').insert({
      event_id: row.event_id,
      user_id: null,
      action: 'payment.operation_orphaned',
      meta: { operationId: row.id, campaignId: row.campaign_id, kind: row.kind },
    });
    if (auditError) auditFailed += 1;
  }

  if (sweptRows.length > 0 || failedIds.length > 0) {
    const shown = (ids: string[]) => ids.slice(0, MAX_IDS_IN_ALERT).join(', ') + (ids.length > MAX_IDS_IN_ALERT ? ' …' : '');
    void sendSlackAlert({
      level: 'error',
      category: 'campaign_billing',
      source: 'payment-orphans',
      title:
        failedIds.length > 0
          ? 'פעולות תשלום תקועות: חלקן לא הועברו לבדיקה ידנית'
          : 'פעולות תשלום תקועות הועברו לבדיקה ידנית',
      detail: [
        sweptRows.length > 0 ? `הועברו לבדיקה ידנית: ${shown(sweptRows.map((r) => r.id))}` : null,
        failedIds.length > 0 ? `עדיין תקועות (שגיאת מסד נתונים): ${shown(failedIds)}` : null,
        auditFailed > 0 ? `רישום ביומן הפעילות נכשל ב-${auditFailed}` : null,
        'לבדוק ב-SUMIT אם החיוב בוצע לפני ההכרעה.',
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
      fields: { swept: sweptRows.length, failed: failedIds.length, skipped },
    });
  }

  return { found: rows.length, swept: sweptRows.length, skipped, failed: failedIds.length };
}
