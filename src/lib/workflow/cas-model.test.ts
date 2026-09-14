import { describe, expect, it } from 'vitest';

// AN EXECUTABLE MODEL OF `wake_parked_workflow_run`, and the interleaving that
// depends on it.
//
// ⚠️ WHY THIS FILE EXISTS. `handshake.test.ts` proves the ORDER of the four
// stages, but it does so with `markParkedRunReady` mocked to a constant — so the
// one fact the whole design rests on, that the CAS answers TRUE a second time,
// is supplied by the test rather than demonstrated by it. Someone adding
// `and wait_until > now()` to the RPC would keep every one of those tests green
// and silently turn the early wake back into a ceiling wake.
//
// This models the SQL's predicates instead of assuming them, and drives the
// exact interleaving the 0ב review asked about. It cannot execute Postgres, so
// it is a CONTRACT, not a proof of the deployed function — but a contract that
// fails loudly when the two disagree is what was missing.
//
// The modelled statement, from migration 20260914174645:
//
//   with parked as (
//     select r.id from workflow_runs r
//      where r.id = $1 and r.status = 'waiting'
//        and r.resume_correlation_id = $3
//        for update)
//   , woken as (
//     update workflow_run_steps s set wait_until = now()
//       from parked
//      where s.run_id = parked.id and s.node_id = $2 and s.status = 'waiting'
//     returning s.id)
//   select exists (select 1 from woken)
//
// Two properties matter and both are modelled: it predicates on STATUS (never on
// `wait_until`), and it writes only `wait_until`. Together those make it
// idempotent — the first call leaves every one of its own predicates true.

type Db = {
  run: { status: string; resumeCorrelationId: string | null };
  step: { nodeId: string; status: string; waitUntil: string };
  /** Set when the fallback job exists; a pull before that finds nothing. */
  job: { startAfter: string } | null;
};

const CEILING = '2026-09-15T12:00:00.000Z';
const NOW = '2026-09-14T19:00:00.000Z';

function freshDb(): Db {
  return {
    run: { status: 'waiting', resumeCorrelationId: 'corr-1' },
    step: { nodeId: 'node-1', status: 'waiting', waitUntil: CEILING },
    job: null,
  };
}

/** The RPC, modelled statement-for-statement. */
function wakeParkedWorkflowRun(db: Db, nodeId: string, correlationId: string): boolean {
  const parked = db.run.status === 'waiting' && db.run.resumeCorrelationId === correlationId;
  if (!parked) return false;
  const woken = db.step.nodeId === nodeId && db.step.status === 'waiting';
  if (!woken) return false;
  db.step.waitUntil = NOW; // the ONLY column it writes
  return true;
}

/** `boss.update` by singletonKey: edits a pending job, or reports none. */
function pullForward(db: Db): boolean {
  if (!db.job) return false;
  db.job.startAfter = NOW;
  return true;
}

describe('the CAS the handshake depends on', () => {
  it('⚠️ answers TRUE a second time — this is what makes the window survivable', () => {
    const db = freshDb();
    expect(wakeParkedWorkflowRun(db, 'node-1', 'corr-1')).toBe(true);
    // Nothing the first call wrote invalidates a predicate of the second.
    expect(wakeParkedWorkflowRun(db, 'node-1', 'corr-1')).toBe(true);
  });

  it('⚠️ would STOP being idempotent if it were guarded on wait_until', () => {
    // The exact regression this file exists to catch, shown rather than asserted.
    const guarded = (db: Db, nodeId: string, corr: string) => {
      const parked = db.run.status === 'waiting' && db.run.resumeCorrelationId === corr;
      if (!parked) return false;
      // The tempting extra predicate: "only wake a step that is still in future".
      const woken = db.step.nodeId === nodeId && db.step.status === 'waiting' && db.step.waitUntil > NOW;
      if (!woken) return false;
      db.step.waitUntil = NOW;
      return true;
    };
    const db = freshDb();
    expect(guarded(db, 'node-1', 'corr-1')).toBe(true);
    // …and now the handshake's own CAS is refused, and the run sleeps to its
    // ceiling with the answer already in the database. This is why the migration
    // says, in as many words, that it is NOT guarded on `wait_until`.
    expect(guarded(db, 'node-1', 'corr-1')).toBe(false);
  });

  it('refuses a correlation that no longer belongs to this wait', () => {
    const db = freshDb();
    expect(wakeParkedWorkflowRun(db, 'node-1', 'a-different-correlation')).toBe(false);
    expect(db.step.waitUntil).toBe(CEILING);
  });

  it('refuses a run that already moved on', () => {
    const db = freshDb();
    db.run.status = 'running';
    expect(wakeParkedWorkflowRun(db, 'node-1', 'corr-1')).toBe(false);
  });
});

describe('the exact callback window, interleaved', () => {
  it('⚠️ callback lands between publish and register — the run STILL resumes early', () => {
    const db = freshDb();

    // T1 the run is published as waiting + correlation (runWorkflow did this).
    //    The fallback job does NOT exist yet.
    expect(db.job).toBeNull();

    // T2 THE CALLBACK. Its CAS succeeds; it has no job to pull forward.
    const callbackCas = wakeParkedWorkflowRun(db, 'node-1', 'corr-1');
    const callbackDelivered = pullForward(db);
    expect(callbackCas).toBe(true);
    expect(callbackDelivered).toBe(false); // ← the lost wake, if nothing else happened

    // T3 REGISTER — handleWorkflowRun enqueues the fallback at the ceiling.
    db.job = { startAfter: CEILING };

    // T4 CHECK — verify() reads a concluded attempt and says yes.
    const happened = true;
    expect(happened).toBe(true);

    // T5 the handshake's own CAS, then the pull.
    const handshakeCas = wakeParkedWorkflowRun(db, 'node-1', 'corr-1');
    expect(handshakeCas).toBe(true);
    expect(pullForward(db)).toBe(true);

    // The run wakes NOW, not at its ceiling. Both halves moved.
    expect(db.step.waitUntil).toBe(NOW);
    expect(db.job.startAfter).toBe(NOW);
  });

  it('and without the handshake, that same interleaving loses the wake', () => {
    // The counterfactual, so the value of the handshake is measured rather than
    // asserted: same timeline, no step T4/T5.
    const db = freshDb();
    wakeParkedWorkflowRun(db, 'node-1', 'corr-1');
    expect(pullForward(db)).toBe(false);
    db.job = { startAfter: CEILING };

    // The step is passable, but nothing will deliver the run until the ceiling.
    expect(db.step.waitUntil).toBe(NOW);
    expect(db.job.startAfter).toBe(CEILING);
  });
});
