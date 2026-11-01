import type { PgBoss } from 'pg-boss';

import { completedRetentionSeconds, PGBOSS_SEND_IT_QUEUE } from '@/lib/ops/queue-schedule';

import { QUEUES, RETIRED_QUEUES, WORKFLOW_RUN_EXPIRE_SECONDS } from './queues';

// The queues every pg-boss schema of this app holds, with their policy, expiry and retention. The pg-boss docs: a
// queue is created with createQueue() "before anything is sent to it", and a send to a queue that does not exist
// rejects with "Queue <name> does not exist". The worker runs this on every start (worker/main.ts); a local
// database gets the same queues from scripts/pgboss-local-setup.ts, so a send made there behaves as in production.

// Queues whose jobs are short periodic sweeps (p95 runtime ≈ 4s, MEASURED):
// a job still `active` after 5 minutes here is a dead process, not a long run.
// pg-boss's default is 15 minutes — that is how long a job killed mid-flight
// stayed stuck before it was retried (4 cases in 48h before kill_timeout was
// fixed). The archive/SUMIT/log-export jobs keep the default: one SUMIT
// reconcile has legitimately taken 181s.
const SWEEP_EXPIRE_SECONDS = 300;
const SWEEP_QUEUES = new Set<string>([
  QUEUES.arm,
  QUEUES.webhook,
  QUEUES.thankyouSweep,
  QUEUES.inquiryFollowupSweep,
  QUEUES.callbackSweep,
  QUEUES.callReconcile,
]);

export async function ensureQueues(boss: PgBoss): Promise<void> {
  // Queue setup is idempotent in pg-boss (createQueue is INSERT … ON CONFLICT
  // DO NOTHING), but each call is still a round trip to a pooler ~134ms away,
  // and one per queue ran serially on every start. Read the existing queues once,
  // create only the missing ones, and align expireInSeconds and
  // deleteAfterSeconds on the existing ones (createQueue never updates an
  // existing row — updateQueue does).
  // Retired queues: drop the schedule row first (so the cron stops filing),
  // then the queue and its retained jobs. Both calls are no-ops once done.
  for (const retired of RETIRED_QUEUES) {
    await boss.unschedule(retired);
    await boss.deleteQueue(retired);
  }

  const existingQueues = new Map((await boss.getQueues()).map((q) => [q.name, q]));

  for (const q of Object.values(QUEUES)) {
    // thankyouSweep: 'singleton' policy — only 1 job may be ACTIVE at a time
    // (unlimited queued). Without this, an
    // overlapping cron tick (the previous sweep still running past the
    // 5-minute interval) could run concurrently with a new one — two
    // processes both reading "not yet claimed" for the same contact before
    // either writes a claim row. The atomic claim (contact_interactions
    // partial UNIQUE index) already makes a double-SEND impossible even under
    // overlap, but this closes the race at its source instead of relying on
    // a single defense layer.
    // callbackSweep is a singleton for the same reason as thankyouSweep, and it
    // matters more here: an overlapping tick would be two processes reading the
    // same "due and unclaimed" row. The atomic claim
    // (UPDATE ... WHERE callback_dispatched_at IS NULL) already makes a double
    // dial impossible, but a guest's phone ringing twice is not a race worth
    // leaving to one defence.
    const singleton =
      q === QUEUES.thankyouSweep ||
      q === QUEUES.logExport ||
      q === QUEUES.callbackSweep ||
      // Singleton too: two ticks reading the same "unscheduled" rows would each
      // create an appointment. The partial unique index on calendar_item_id and
      // the `.is(calendar_item_id, null)` guard on the write already make a
      // duplicate impossible, but a second item appearing in the owner's
      // calendar is not a race worth leaving to one defence.
      q === QUEUES.callbackScheduleSweep ||
      // Singleton too: this is a WEEKLY cron, so overlap is unlikely, but an
      // overlapping run would refresh the same not-yet-rotated token twice in
      // flight against Meta and race the two atomic .env.local rewrites
      // against each other. Nothing else defends against that (there is no
      // per-row lease here, unlike the other IO-writing crons above).
      q === QUEUES.igTokenRefresh ||
      // Singleton too, and here it is load-bearing: every job carries a
      // singletonKey (the agent, or the sweep's key), and singleton keeps ONE
      // job per key active. So two reads of one agent never overlap and an older
      // read can never upsert after a newer one, and two sweeps never race two
      // creations of one Graph subscription.
      q === QUEUES.calendarPresenceSync ||
      // Singleton too: two overlapping ticks would each see a subscription
      // that is missing or near expiry and each create one, leaving a
      // duplicate that delivers every message twice. ensureIntakeSubscription
      // prunes duplicates on the next pass, but not creating them is better.
      q === QUEUES.graphIntakeRenew ||
      // Singleton too, for the same reason as thankyouSweep: an overlapping cron
      // tick could re-select a row whose stamp the previous tick hasn't written
      // yet, and (unlike thankyouSweep) there is no atomic per-row claim here to
      // fall back on — see docs/inquiry-email-threading-fix-plan-2026-08-25.md
      // §2.6 for the send-level idempotency key that covers the *sequential*
      // retry-after-crash case this singleton policy alone does not.
      q === QUEUES.inquiryFollowupSweep ||
      // Singleton too: two overlapping ticks would both read the same
      // unexported rows and race two uploads of the same file.
      // conflictBehavior=fail plus the hash check already make a duplicate
      // impossible, but the overlap has no value and costs Graph calls.
      q === QUEUES.agreementArchiveSweep ||
      // Singleton too: a weekly walk that downloads every archived file; two
      // overlapping runs would double the Graph traffic for no benefit.
      q === QUEUES.archiveMaintenanceSweep ||
      // Singleton too: it downloads every archived file and every object in the
      // source bucket; two overlapping runs would double that for no benefit
      // (the content-addressed store makes a duplicate write harmless, just
      // wasteful).
      q === QUEUES.archiveBackupSweep ||
      // Singleton too: two overlapping ticks would each read the same
      // not-yet-latched candidates. The latch is a conditional UPDATE, so a
      // duplicate mail is already impossible — this just avoids the wasted
      // round-trips.
      q === QUEUES.signupReminderSweep ||
      // Singleton too: two overlapping ticks would read the same candidates and
      // race on deleting them, turning a benign duplicate into a failed run.
      q === QUEUES.unconfirmedCleanupSweep ||
      // Singleton too: two overlapping runs would read the same grants and both write an account_removed withdrawal
      // for the same deleted account (the second would be 'unchanged', but the overlap has no value).
      q === QUEUES.marketingContactReconcile ||
      // Singleton: two overlapping runs would both diff against the same saved
      // crawl and both spend URL Inspection quota on the same sitemap URLs.
      q === QUEUES.seoTechnicalWatch ||
      // Singleton, and this one is not an optimisation: two overlapping runs
      // would both drive the installer into ~/.supabase/bin and both run
      // `npm install` in the same tree. Concurrency here corrupts a toolchain.
      q === QUEUES.supabaseCliUpdate;
    // The workflow queue gets its own, and it is not a tuning knob: it has to
    // sit between the largest node budget and the step lease. See
    // WORKFLOW_RUN_EXPIRE_SECONDS.
    const expire = SWEEP_QUEUES.has(q)
      ? SWEEP_EXPIRE_SECONDS
      : q === QUEUES.workflowRun
        ? WORKFLOW_RUN_EXPIRE_SECONDS
        : undefined;
    // A completed job must outlive the queue's staleness allowance, or the
    // Debug badge reads a healthy queue as stale (completedRetentionSeconds).
    const deleteAfterSeconds = completedRetentionSeconds(q);
    const existing = existingQueues.get(q);
    if (!existing) {
      await boss.createQueue(q, {
        ...(singleton ? { policy: 'singleton' as const } : {}),
        ...(expire ? { expireInSeconds: expire } : {}),
        deleteAfterSeconds,
      });
    } else {
      const update = {
        ...(expire && existing.expireInSeconds !== expire ? { expireInSeconds: expire } : {}),
        ...(existing.deleteAfterSeconds !== deleteAfterSeconds ? { deleteAfterSeconds } : {}),
      };
      if (Object.keys(update).length > 0) await boss.updateQueue(q, update);
    }
  }
  // pg-boss's own scheduler queue: one row per cron tick (half the job table,
  // measured 2026-09-30). boss.start() already created it; only retention is
  // aligned — nothing else of pg-boss's own is touched.
  const sendIt = existingQueues.get(PGBOSS_SEND_IT_QUEUE);
  const sendItRetention = completedRetentionSeconds(PGBOSS_SEND_IT_QUEUE);
  if (sendIt && sendIt.deleteAfterSeconds !== sendItRetention) {
    // An optimisation only: a failure here must never stop the worker starting.
    try {
      await boss.updateQueue(PGBOSS_SEND_IT_QUEUE, { deleteAfterSeconds: sendItRetention });
    } catch (err) {
      console.warn('[worker] send-it retention update failed', err instanceof Error ? err.message : err);
    }
  }
}
