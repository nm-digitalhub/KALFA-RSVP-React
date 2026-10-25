import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { isPastEventDay } from '@/lib/data/event-date';
import { CARDCOM_ABANDON_AFTER_MINUTES, settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { completeOperation, loadOperationsOf, OperationStateError } from '@/lib/payments/ledger';
import { deriveStatus } from '@/lib/payments/status';
import { PACKAGE_ACTIVATION_RETRY, packageActivationJobId, QUEUES, type PackageActivationJob } from '@/lib/queue/queues';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { PgBoss } from 'pg-boss';
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
  activations: WaitingActivationResult;
}

// SECOND PASS (design D23): a campaign whose package is paid but whose service is still waiting to start. Every recorded
// payment queues a package-activation job (package-activation-queue.ts), so a campaign that is still `approved` with a
// collected ledger ACTIVATION_GRACE_MINUTES after its payment means the job was never queued, or it ran out of retries.
//   - no job under the payment's id → queue it again, the same id (pg-boss ignores it if one appeared meanwhile);
//   - the job is `failed` → boss.retry, at most once per campaign per RETRY_EVERY_MS, with one alert. The once-a-day
//     limit is load-bearing: retry() adds one to the job's retry_limit (pg-boss plans.js retryJobs), so every retry ends
//     in its own final delivery and its own alert from the job; a retry every ten minutes would page every ten minutes.
//     The day is read from activity_log (`campaign.activation_retried`), so a worker restart does not reset it;
//   - any other state (created, retry, active) → the job is still on its way: nothing.
// A campaign whose event can no longer start (its day has passed, or the event is not active: the same two checks the
// activation applies, campaigns.ts rejectPastEvent / requireActiveEvent) is left out entirely. Retrying it can only be
// refused again, and each retry ends in its own alert, so a paid service whose event passed would page every day for
// good. The job's own final delivery already told staff once.
// No other repair path exists.
export const ACTIVATION_GRACE_MINUTES = 10;
export const RETRY_EVERY_MS = 24 * 60 * 60_000;

export interface WaitingActivationResult {
  found: number;
  queued: number;
  retried: number;
  // A pg-boss or database error for one campaign; the others are still handled.
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

// The pg-boss calls the second pass makes. The worker passes its own instance.
export type ActivationJobs = Pick<PgBoss, 'getJobById' | 'send' | 'retry'>;

export async function runPaymentOrphanSweep(
  admin: AdminClient,
  jobs: ActivationJobs,
  now: Date = new Date(),
): Promise<PaymentOrphanSweepResult> {
  const pending = await sweepPendingOperations(admin, now);
  const activations = await sweepWaitingActivations(admin, jobs, now);
  return { ...pending, activations };
}

async function sweepPendingOperations(admin: AdminClient, now: Date): Promise<Omit<PaymentOrphanSweepResult, 'activations'>> {
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
    // Only a CardCom PURCHASE can be settled from its session. A CardCom refund has no session: a pending one means the
    // process died during the refund call, so the money may already be back — it goes to review like any other orphan,
    // never to "failed" (which would let a retry refund twice).
    if (row.kind === 'package_purchase' && isCardcom(row.meta)) {
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

    // Ids only. A direct admin insert: the worker has no session for logActivity.
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
        'לבדוק אצל חברת הסליקה (SUMIT או CardCom) אם הפעולה בוצעה לפני ההכרעה.',
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
      fields: { swept: sweptRows.length, failed: failedIds.length, skipped },
    });
  }

  return { found: rows.length, swept: sweptRows.length, skipped, failed: failedIds.length };
}

// Exported for its local integration test only, which must not run the first pass against a shared database.
export async function sweepWaitingActivations(admin: AdminClient, jobs: ActivationJobs, now: Date): Promise<WaitingActivationResult> {
  const result: WaitingActivationResult = { found: 0, queued: 0, retried: 0, failed: 0 };
  const READ_FAILED = 'סריקת השירותים ששולמו וממתינים להפעלה נכשלה';

  const { data: campaigns, error } = await admin.from('campaigns').select('id, event_id').eq('status', 'approved');
  if (error) throw new Error(READ_FAILED);
  if (!campaigns || campaigns.length === 0) return result;

  // The same ledger reading as the payment page and the activation (status.ts deriveStatus). Throws when unreadable.
  const ledgers = await loadOperationsOf(admin, campaigns.map((c) => c.id));
  const collected = campaigns.filter((c) => deriveStatus(ledgers.get(c.id) ?? []).status === 'collected');
  if (collected.length === 0) return result;

  const { data: events, error: eventsError } = await admin
    .from('events')
    .select('id, event_date, status')
    .in('id', [...new Set(collected.map((c) => c.event_id))]);
  if (eventsError) throw new Error(READ_FAILED);
  const startable = new Set(
    (events ?? []).filter((e) => e.status === 'active' && !isPastEventDay(e.event_date, now.getTime())).map((e) => e.id),
  );
  const paid = collected.filter((c) => startable.has(c.event_id));
  if (paid.length === 0) return result;

  const { data: ops, error: opsError } = await admin
    .from('payment_operations')
    .select('id, campaign_id, occurred_at')
    .in('campaign_id', paid.map((c) => c.id))
    .eq('kind', 'package_purchase')
    .eq('outcome', 'succeeded')
    .order('occurred_at', { ascending: false });
  if (opsError) throw new Error(READ_FAILED);
  // The latest succeeded purchase per campaign: the one the activation names (activate-paid-package.ts startPaidPackageNow).
  const latest = new Map<string, { id: string; occurred_at: string }>();
  for (const op of ops ?? []) if (!latest.has(op.campaign_id)) latest.set(op.campaign_id, op);

  const cutoff = now.getTime() - ACTIVATION_GRACE_MINUTES * 60_000;
  for (const campaign of paid) {
    const op = latest.get(campaign.id);
    if (!op || Date.parse(op.occurred_at) > cutoff) continue;
    result.found += 1;
    const ids = { campaignId: campaign.id, operationId: op.id };
    try {
      const jobId = packageActivationJobId(op.id);
      const job = await jobs.getJobById(QUEUES.packageActivation, jobId);
      if (!job) {
        await jobs.send(QUEUES.packageActivation, ids satisfies PackageActivationJob, { id: jobId, ...PACKAGE_ACTIVATION_RETRY });
        result.queued += 1;
        console.warn('[payment-orphans] a paid package had no activation job; queued it', ids);
        continue;
      }
      if (job.state !== 'failed') continue;
      if (await retriedRecently(admin, campaign.id, now)) continue;
      await jobs.retry(QUEUES.packageActivation, jobId);
      result.retried += 1;
      const { error: auditError } = await admin.from('activity_log').insert({
        event_id: campaign.event_id,
        user_id: null,
        action: 'campaign.activation_retried',
        meta: { campaignId: campaign.id, operationId: op.id, actor: 'system' },
      });
      if (auditError) console.error('[payment-orphans] could not record an activation retry', ids);
      void sendSlackAlert({
        level: 'error',
        category: 'campaign_billing',
        source: 'payment-orphans',
        title: 'חבילה שולמה והשירות עדיין לא הופעל: נשלח ניסיון הפעלה נוסף',
        detail: 'כל ניסיונות ההפעלה נכשלו. לבדוק את הקמפיין ואת האירוע לפני הניסיון הבא (פעם ביום).',
        fields: { campaign_id: campaign.id, event_id: campaign.event_id, operation_id: op.id },
      });
    } catch (err) {
      result.failed += 1;
      console.error('[payment-orphans] could not check the activation job of a paid package', {
        ...ids,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

// Whether this campaign's failed activation was already retried within RETRY_EVERY_MS. An unreadable log answers true:
// skipping one retry is safe, paging every ten minutes is not.
async function retriedRecently(admin: AdminClient, campaignId: string, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from('activity_log')
    .select('id')
    .eq('action', 'campaign.activation_retried')
    .eq('meta->>campaignId', campaignId)
    .gte('created_at', new Date(now.getTime() - RETRY_EVERY_MS).toISOString())
    .limit(1);
  if (error) {
    console.error('[payment-orphans] could not read the activation retry log', { campaignId });
    return true;
  }
  return (data?.length ?? 0) > 0;
}
