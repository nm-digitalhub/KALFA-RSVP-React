// Enqueue one workflow run, and execute one.
//
// Kept free of `server-only` so the worker can bundle it; the Supabase access it
// needs arrives through the store, which is server-only and imported by the
// worker process (not by the browser).
import type { PgBoss } from 'pg-boss';

import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES, WORKFLOW_RETRY, type WorkflowRunJob } from '@/lib/queue/queues';
import { createIntegrationRuntime } from '@/lib/integrations/runtime';
import { getAppOrigin } from '@/lib/url';

import { runWorkflow, type RunWorkflowOutcome } from './engine/run-workflow';
import { createGuestActions } from './guest-actions';
import { markParkedRunReady } from './wake-store';
import { createTeamAlerts } from './team-alerts';
import { createOutboundWebhook } from './outbound-webhook';
import type { AccountingPort, AiAgentPort, IntegrationsPort } from './engine/ports';
import type { WorkflowTriggerPayload } from './steps';
import {
  createExecutionLog,
  createRunStore,
  createStepLedger,
  listOrphanedWaitingSteps,
  listStuckWaitingRuns,
  loadRunForExecution,
} from './store';

let liveIntegrations: IntegrationsPort | undefined;

const integrations: IntegrationsPort = {
  execute(args) {
    // Lazy on purpose: importing the workflow worker must not open Supabase or
    // initialize provider runtime unless a workflow actually reaches an
    // integration node. It also keeps existing engine tests database-free.
    liveIntegrations ??= createIntegrationRuntime();
    return liveIntegrations.execute(args);
  },
};

/**
 * The LIVE accounting port. Lazy for the same reason as `integrations`:
 * importing the worker must not read `app_settings` unless a workflow actually
 * reaches a document node.
 *
 * ⚠️ CREDENTIALS ARE READ HERE, NOT PASSED THROUGH THE DIAGRAM. `getSumitServerConfig`
 * is the one reader every other SUMIT caller uses, so a workflow can no more
 * reach the API key than the close-charge can — the node names WHAT to issue,
 * never WITH WHAT. Missing configuration is a permanent failure with a Hebrew
 * message, not a silent no-op that would leave a workflow "completed" with no
 * document.
 */
/**
 * The LIVE AI port — one headless `claude -p` run.
 *
 * ⚠️ IT SHELLS THE SAME CLI THE FLEET ALREADY RUNS, and that is the whole design.
 * `.claude/fleet/bin/run-role.sh` has driven Claude headless in this repo for
 * months: OAuth token rather than an API key, per-tier settings file rather than
 * an allow-list in code, a `PreToolUse` hook that blocks before permission
 * evaluation, a hard timeout and a JSON trace carrying cost and session id.
 * Reaching for `@ai-sdk/openai` instead would have meant a second credential, a
 * second permission model and a second thing to audit — for a capability this
 * machine already has.
 *
 * ⚠️ NO TOOLS, AND THE NODE'S `tools` LIST GOES NOWHERE ON PURPOSE.
 *
 * An earlier version of this port required an env var naming a settings file
 * that would gate the model's tools. That file did not exist and was never
 * written — the name was invented here and appeared nowhere else in the repo —
 * so the node could be armed and would then fail on its first run looking for
 * it. The requirement is removed rather than papered over: what this port does
 * today is ASK A MODEL AND RETURN TEXT, which is complete and useful on its own.
 *
 * `--permission-mode dontAsk` with no settings file is fail-closed by
 * construction: there is no TTY to approve anything, so a tool call is denied
 * rather than prompted. The model answers from the prompt alone.
 *
 * GIVING IT REAL TOOLS IS A SEPARATE PIECE OF WORK — an MCP server exposing
 * KALFA capabilities, a settings file that permits exactly those, and tests.
 * Until that exists the node's `tools` rows are collected from the diagram and
 * dropped here, which is why nothing in this function reads them.
 *
 * ⚠️ NO SECRET TRAVELS IN THE DIAGRAM. The token is read from the environment
 * here. That is why `action.ai_agent` is absent from `SECRET_BEARING_NODE_TYPES`
 * — there is nothing to defer, and `{{secrets.…}}` in one of its fields would
 * (correctly) throw.
 */
const ai: AiAgentPort = {
  async run(input) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);

    // ⚠️ `execFile`, NOT `exec`. The prompt is owner-authored text that has been
    // through `{{…}}` resolution, so it can contain anything a guest ever wrote.
    // A shell would interpret it; an argv array does not.
    let stdout: string;
    try {
      ({ stdout } = await run(
        'claude',
        [
          '-p',
          input.prompt,
          // Fail-closed with no settings file: `dontAsk` plus no TTY means a
          // tool call is denied, never prompted.
          '--permission-mode', 'dontAsk',
          '--setting-sources', 'project',
          '--model', input.model,
          '--max-turns', String(input.maxTurns),
          '--output-format', 'json',
        ],
        {
          // Bounded twice: the CLI has no budget of its own, and a workflow step
          // holds a pg-boss lease while it waits.
          timeout: AI_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          env: process.env,
        },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`הקריאה למודל נכשלה: ${message}`);
    }

    let parsed: { result?: unknown; total_cost_usd?: unknown; session_id?: unknown };
    try {
      parsed = JSON.parse(stdout) as typeof parsed;
    } catch {
      throw new Error('המודל החזיר תשובה שאינה JSON');
    }

    return {
      text: typeof parsed.result === 'string' ? parsed.result : '',
      costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
      sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : null,
    };
  },
};

/** Ten minutes. Longer than any sane single-step prompt, shorter than a lease. */
const AI_TIMEOUT_MS = 10 * 60 * 1000;

const accounting: AccountingPort = {
  async createDocument(input) {
    const { createDocumentSumit } = await import('@/lib/sumit/accounting');
    const { getSumitServerConfig } = await import('@/lib/data/payments');
    const config = await getSumitServerConfig();
    if (!config) throw new Error('הגדרות SUMIT חסרות — לא ניתן להפיק מסמך');
    return createDocumentSumit({
      companyId: config.companyId,
      apiKey: config.apiKey,
      // Narrowed by the handler against the catalogue before it gets here.
      type: input.type as Parameters<typeof createDocumentSumit>[0]['type'],
      customer: {
        name: input.customerName,
        emailAddress: input.customerEmail,
        phone: input.customerPhone,
        externalIdentifier: input.customerExternalId,
        noVat: input.customerNoVat,
      },
      items: input.items?.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      isDraft: input.isDraft,
      sendByEmail: input.sendByEmail,
      description: input.description,
    });
  },
  async createCustomer(input) {
    const { createCustomerSumit } = await import('@/lib/sumit/accounting');
    const { getSumitServerConfig } = await import('@/lib/data/payments');
    const config = await getSumitServerConfig();
    if (!config) throw new Error('הגדרות SUMIT חסרות — לא ניתן ליצור לקוח');
    const result = await createCustomerSumit({
      companyId: config.companyId,
      apiKey: config.apiKey,
      name: input.name,
      emailAddress: input.email,
      phone: input.phone,
      city: input.city,
      address: input.address,
      companyNumber: input.companyNumber,
      externalIdentifier: input.externalId,
      noVat: input.noVat,
    });
    return result;
  },
};

/**
 * Send the job for a run whose row already exists.
 *
 * Two independent guards, and both are needed:
 *
 *   `id` — a deterministic uuid over the run id, so a duplicated enqueue is a
 *     no-op (boss.send returns null on a PK conflict). Hashed through
 *     `deterministicJobId` rather than passed raw, because pg-boss's id column
 *     is a uuid and a composite string throws 22P02.
 *
 *   `singletonKey` — a HANDLE on this run's queued job, not a lock.
 *
 * ⚠️ THE SECOND GUARD IS WEAKER THAN THIS COMMENT USED TO CLAIM. It said
 * pg-boss would not have two jobs for the same run active at once, and that
 * this was what made the ledger's `in_flight` answer meaningful. It is not.
 * `singletonKey` enforces uniqueness only under the `short`, `singleton`,
 * `stately`, `exclusive` and `key_strict_fifo` policies — every unique index
 * that mentions `singleton_key` is conditioned on one of them (pg-boss 12.30.0,
 * dist/plans.js job_i1/i2/i3/i6/i8), and the official docs say the same by
 * listing "Can be extended with singletonKey" against those policies and not
 * against `standard`, then stating outright that "several pre-active jobs can
 * share a key ... with a manually-assigned key on a `standard` queue".
 * `QUEUES.workflowRun` is created without a policy, and `createQueue` defaults
 * to `standard` (manager.js: `options.policy || QUEUE_POLICIES.standard`), so
 * on this queue the key constrains nothing. QUEUES.logExport is genuinely
 * different — it is in the worker's singleton list.
 *
 * What actually keeps one run from executing twice is the deterministic `id`
 * above plus the step ledger's per-step lease. That is not a gap to close here;
 * it is the reason the ledger's claim is a CAS rather than a read.
 *
 * The key is still worth setting, for a reason the old comment did not know:
 * it is the target `boss.update(name, undefined, { singletonKey })` matches, so
 * a parked run's pending job can be pulled FORWARD in place — the mechanism an
 * event-driven wake needs, without inserting a second job beside the first.
 */
export async function enqueueWorkflowRun(
  boss: PgBoss,
  runId: string,
  /**
   * When the job should become eligible. Omitted for a first delivery; set to a
   * `logic.wait` deadline when a parked run is re-scheduled.
   *
   * pg-boss holds the delay itself — the same mechanism the outreach sender uses
   * to defer a send into a window — so no sweep is needed for the ordinary case.
   */
  startAfter?: Date,
): Promise<void> {
  const data: WorkflowRunJob = { runId };
  await boss.send(QUEUES.workflowRun, data, {
    // ⚠️ THE JOB ID MUST DIFFER PER WAKE-UP. It is deterministic over the run id
    // so a duplicated enqueue is a no-op — exactly right for a first delivery,
    // and fatal for a resume: the completed job for this run still holds the id,
    // so a resume reusing it would be silently dropped and the run would sleep
    // for ever. The deadline is folded in, which keeps both properties: two
    // workers resuming the same park still collide on one id, and the next park
    // gets its own.
    id: deterministicJobId(
      startAfter ? `workflow-run:${runId}:${startAfter.toISOString()}` : `workflow-run:${runId}`,
    ),
    singletonKey: runId,
    ...(startAfter ? { startAfter } : {}),
    ...WORKFLOW_RETRY,
  });
}

/**
 * Pull a parked run's pending job forward so it is delivered NOW.
 *
 * The queue half of the early wake. `wake_parked_workflow_run` has already moved
 * the step's deadline — that write is what makes the wait passable and it is
 * durable — and this only decides WHEN the run finds out.
 *
 * ⚠️ IT EDITS THE JOB THAT EXISTS; IT DOES NOT ADD ONE. `boss.update` targets by
 * `singletonKey`, which `enqueueWorkflowRun` sets to the run id, and pg-boss's
 * `updateJob` matches `state < 'active'` and rewrites `start_after` in place
 * (verified in 12.30.0 dist/plans.js). Sending a second job instead would put
 * two deliveries of one run in flight — and on this queue nothing would stop
 * them running at once, because `singletonKey` constrains nothing under the
 * `standard` policy (see enqueueWorkflowRun above).
 *
 * `false` means there was no pending job to move: the run's job is already
 * `active` (a worker is walking the graph right now and will read the deadline
 * this wake just wrote), or it is gone. Neither is an error and neither loses
 * the wake — the run still has its `resume_at` ceiling and the recovery sweep.
 * That is the reason the database write comes first and this comes second.
 */
export async function pullWorkflowRunForward(boss: PgBoss, runId: string): Promise<boolean> {
  // `undefined` for `data`, not `null`: pg-boss drops undefined keys from the
  // patch, so the job keeps the payload it was created with. `null` would clear
  // it, and the payload is the run id the handler needs.
  const { updated } = await boss.update(QUEUES.workflowRun, undefined, {
    singletonKey: runId,
    startAfter: new Date(),
  });
  return updated > 0;
}

/**
 * Execute one run, wiring the real dependencies.
 *
 * Reads everything fresh from the row: the job carries only the run id, so a
 * definition edited between enqueue and execution is picked up as it now stands
 * — which is the same "re-read fresh state" rule the call dispatchers follow.
 */
export async function handleWorkflowRun(
  job: WorkflowRunJob,
  /**
   * Needed ONLY to re-deliver a run that parks at a `logic.wait`.
   *
   * Optional so every existing caller and test compiles unchanged — but a run
   * that parks without it would never wake, so the absence is reported rather
   * than ignored (see the outcome below).
   */
  boss?: PgBoss,
  /**
   * pg-boss's own `job.signal`.
   *
   * Aborted when this batch ends — which includes the case that matters: the
   * handler outlived `expireInSeconds`, pg-boss failed the job and re-queued it,
   * and this run now belongs to a retry. Without it a handler that lost its job
   * kept walking the graph beside the attempt that had been given the same run.
   *
   * Optional so every existing caller and test compiles; a caller that omits it
   * simply keeps the old behaviour of never noticing.
   */
  signal?: AbortSignal,
): Promise<RunWorkflowOutcome | { status: 'skipped'; reason: string }> {
  const run = await loadRunForExecution(job.runId);
  if (!run) return { status: 'skipped', reason: 'run_not_found' };

  // A run that already reached a terminal state is not re-executed. The step
  // ledger would short-circuit every node anyway, but stopping here means a
  // redelivered job does not rewrite the run's status and finished_at.
  //
  // 'waiting' IS re-executable, and must be: it is how a parked run comes back.
  // The step ledger is what decides whether the wait has actually elapsed — this
  // gate only says the run is still in flight.
  if (run.status !== 'pending' && run.status !== 'running' && run.status !== 'waiting') {
    return { status: 'skipped', reason: `already_${run.status}` };
  }

  // ⚠️ WHICH DEFINITION THIS RUN EXECUTES, and why it depends on the status.
  //
  // A run that has PARKED at `logic.wait` may have been asleep for days. Waking
  // it on the workflow as it stands today means an owner who edited the diagram
  // in the meantime silently changed a run already in flight: finished steps are
  // safe (the ledger replays them by node id and repeats no side effect), but a
  // node ADDED BEFORE the wait has no ledger row, so it reads as unreached and
  // EXECUTES on resume. Nobody drawing a new step expects it to fire for someone
  // who was messaged last Tuesday.
  //
  // Everything else keeps reading fresh, which the doc comment above calls out as
  // deliberate and matches the call dispatchers: an edit between enqueue and a
  // prompt execution SHOULD be picked up. The bug was never freshness — it was
  // time, and only a wait turns "moments" into "days".
  //
  // `?? run.storedDefinition` is the pre-column fallback: a run created before
  // the snapshot existed has none, and must behave exactly as it did before.
  const definition =
    run.status === 'waiting' ? (run.definitionSnapshot ?? run.storedDefinition) : run.storedDefinition;

  const outcome = await runWorkflow({
    runId: run.runId,
    workflowId: run.workflowId,
    storedDefinition: definition,
    trigger: run.triggerPayload as unknown as WorkflowTriggerPayload,
    // The server-injected bag, resolved HERE because `getAppOrigin` is
    // `server-only` and the engine deliberately is not — see
    // `RunWorkflowArgs.variables`.
    //
    // `app_url` is the one value that must not come from the builder. It is the
    // origin every shareable KALFA link is built on, validated from the
    // APP_ORIGIN server var and never from a request header, so a workflow can
    // put a link in a guest's message without an owner typing a URL that a typo
    // or a paste could redirect.
    variables: { app_url: await getAppOrigin() },
    ...(signal ? { signal } : {}),
    deps: {
      ledger: createStepLedger(),
      runs: createRunStore(),
      guests: createGuestActions(),
      alerts: createTeamAlerts(),
      webhook: createOutboundWebhook(),
      integrations,
      accounting,
      ai,
      // Only the real path logs. A dry run passes no log and returns its trace
      // directly — nothing to stream, and nothing to write.
      log: createExecutionLog(),
    },
  });

  // ⚠️ A CONTENDED RUN MUST COME BACK, and throwing is how this queue asks for
  // that. Another delivery of the same run holds a node — the winner is walking
  // the graph right now — so there is nothing to do except try again once it has
  // moved on. Returning quietly would ACK the job and abandon the run wherever
  // the loser stopped: mid-graph, status untouched, with no further delivery
  // coming and no sweep that looks at running rows.
  //
  // The retry is pg-boss's: WORKFLOW_RETRY gives two attempts with backoff, so a
  // contention resolves within seconds of the winner finishing. It is a real
  // ceiling — a winner still going after both attempts leaves the run stalled
  // rather than failed, which is strictly better than the terminal 'failed' this
  // replaced, and is the case `redeliverStuckWaitingRuns` cannot see because the
  // run is 'running' rather than 'waiting'.
  if (outcome.status === 'contended') {
    throw new Error(
      outcome.reason === 'abandoned'
        ? `workflow run ${job.runId} was taken from this delivery before node ${outcome.nodeId} — retrying`
        : `workflow run ${job.runId} lost the race for node ${outcome.nodeId} to a concurrent delivery — retrying`,
    );
  }

  if (outcome.status === 'waiting') {
    if (!boss) {
      // Fail LOUDLY rather than leaving a row that sleeps for ever. The run is
      // already parked in the database; what is missing is the alarm clock, and
      // a silent return would make that indistinguishable from a wait in
      // progress.
      throw new Error(
        `workflow run ${job.runId} parked until ${outcome.resumeAt} but no queue handle was available to reschedule it`,
      );
    }
    // ── 1. REGISTER ──────────────────────────────────────────────────────────
    //
    // The fallback wake-up goes in FIRST, before anything asks whether the event
    // has already happened. Reversing these two is a window, not a preference: a
    // callback landing between a "not yet" answer and this enqueue would find a
    // waiting run with NO pending job to pull forward, report nothing to wake,
    // answer 200 — and the run would sleep to its ceiling with the result
    // already in the database.
    await enqueueWorkflowRun(boss, job.runId, new Date(outcome.resumeAt));

    // ── 2. THEN CHECK ────────────────────────────────────────────────────────
    //
    // Closes the mirror-image window: the node read the world, decided to wait,
    // and the event landed while the park was still being written. The callback
    // that fired then found a run that was not waiting yet and correctly did
    // nothing. This is the only thing that notices.
    //
    // ⚠️ WHAT THIS IS NOT. It closes the CONCURRENCY window — two live actors
    // racing — and it is not a crash-safe protocol. There is no transaction
    // across the step row, the run row, this enqueue and this check, so a
    // process that dies partway leaves gaps that only the sweep can reason
    // about, and one it cannot:
    //
    //   died after `beginWait`, before `setRunStatus('waiting')`
    //     → the STEP says waiting, the RUN still says running, no `resume_at`.
    //       `redeliverStuckWaitingRuns` reads runs with status 'waiting', so it
    //       does not see this one. THE RUN IS STRANDED until someone looks.
    //   died after `setRunStatus('waiting')`, before the enqueue above
    //     → waiting with a `resume_at` and no job. The sweep covers it, but only
    //       once the deadline is past — the early wake is gone, the ceiling holds.
    //   died between `markParkedRunReady` and `pullWorkflowRunForward`
    //     → `wait_until` is now, the job still sits at the ceiling. The run wakes
    //       late and then passes the wait immediately. Degraded, never wrong.
    //
    // The first is the one worth fixing, and it is fixed — by
    // `rescueOrphanedWaitingSteps` below rather than by a transaction across the
    // ledger's contract. The rescue starts from the STEP table, where the park
    // DID land, because the run row is the unreliable half in exactly that case.
    //
    // Reads only. The verifier is the node's own closure over a record it has
    // already created — it must never place the call again.
    if (outcome.verify && outcome.correlationId) {
      let happened = false;
      try {
        happened = await outcome.verify();
      } catch (e) {
        // A transient database fault during the CHECK must not fail a run whose
        // call is fine. The fallback job above is already registered, so the run
        // still wakes — at its ceiling, or when the callback arrives.
        console.error(
          `[workflow] wait verification failed for run ${job.runId}:`,
          e instanceof Error ? e.message : 'unknown',
        );
      }

      if (happened) {
        // Same CAS the callback route goes through, so there is one gate and one
        // source of truth — but with the worker's own `boss`, which is already
        // open, instead of a second send-only connection.
        const ready = await markParkedRunReady({
          runId: job.runId,
          nodeId: outcome.nodeId,
          correlationId: outcome.correlationId,
        });
        // The job provably exists: it was enqueued moments ago, above.
        if (ready) await pullWorkflowRunForward(boss, job.runId);
      }
    }
  }

  return outcome;
}

/**
 * Re-deliver parked runs whose wake-up never arrived.
 *
 * ⚠️ EXTRACTED FROM THE WORKER SO THE `resumeAt` CAN BE TESTED. A fault
 * injection on 2026-09-14 dropped it from the call and nothing failed: `tsc`
 * accepts it (the parameter is optional) and no test reached worker/main.ts.
 * Without it the rescue is not merely weaker — it is a NO-OP, and a silent one.
 *
 * The deadline is folded into the pg-boss job id, so passing it rebuilds the
 * EXACT id the lost wake-up carried, and pg-boss inserts with
 * `ON CONFLICT DO NOTHING` (its own 12.30.0 source). That makes the rescue
 * idempotent in both directions: a job still queued swallows the insert, a job
 * genuinely gone lets it through. Omitting it instead reuses the FIRST
 * delivery's id — long since completed — and the insert is dropped, leaving the
 * run parked for ever with a sweep that appears to be running.
 */
/**
 * Re-deliver runs whose step parked but whose run row never did.
 *
 * The crash half of the wait, and the counterpart to `redeliverStuckWaitingRuns`
 * above: that one rescues a park whose JOB was lost, this one a park whose RUN
 * ROW was lost. Both end in the same place — `enqueueWorkflowRun` with the
 * deadline the park recorded — because the step ledger is what decides whether
 * the wait has actually elapsed, and it has the answer in both cases.
 *
 * `resumeAt` here is the STEP's `wait_until`, which is the only deadline that
 * survived. Passing it rebuilds a stable job id for that instant, so a second
 * sweep over the same orphan is swallowed by pg-boss's ON CONFLICT DO NOTHING.
 */
export async function rescueOrphanedWaitingSteps(
  boss: PgBoss,
  list: () => Promise<{ runId: string; resumeAt: string }[]> = listOrphanedWaitingSteps,
): Promise<number> {
  const orphans = await list();
  for (const { runId, resumeAt } of orphans) {
    console.warn(`[workflow] run ${runId} parked a step but never parked the run — re-delivering`);
    await enqueueWorkflowRun(boss, runId, new Date(resumeAt));
  }
  return orphans.length;
}

export async function redeliverStuckWaitingRuns(
  boss: PgBoss,
  list: () => Promise<{ runId: string; resumeAt: string }[]> = listStuckWaitingRuns,
): Promise<number> {
  const stuck = await list();
  for (const { runId, resumeAt } of stuck) {
    console.warn(`[workflow] parked run ${runId} missed its wake-up — re-delivering`);
    await enqueueWorkflowRun(boss, runId, new Date(resumeAt));
  }
  return stuck.length;
}
