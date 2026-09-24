// `action.start_for_each_guest` — the step handler. Server side: SDK-free, and
// it imports the shared step contract from `steps/shared`, never from
// `steps/index` (the registry imports this file, so that would be a cycle).
import { ACTION_BRANCH_HANDLES } from '../../catalogue/types';
import { readString, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import { MAX_FANOUT_DEPTH, type ForEachGuestConfig } from './definition';

// One run per matching guest — the step that turns "do this for everyone" into
// something an owner can draw.
//
// ⚠️ THE MOST DANGEROUS NODE IN THE PALETTE, and the guards are the feature.
// A single press starts hundreds of runs that each reach a real person. Three
// separate ceilings apply, on purpose:
//
//   1. `maxGuests` — the owner's own, REQUIRED with no default. A node that
//      shipped with a generous one would be a node whose blast radius nobody
//      chose.
//   2. FAN_OUT_HARD_CAP — in code, above the owner's. `maxGuests` lives in a
//      jsonb row, and the row is exactly what a mistake would have edited.
//   3. The port enforces both again, because a handler that trusted its own
//      config would be trusting that same row.
//
// IT MUST NOT FAN OUT TO ITSELF. A workflow starting itself per guest, where
// each child fans out again, is an exponential that ends with the queue full and
// every guest messaged many times. Refused permanently rather than capped.
export const startForEachGuest: StepHandler = async (config, ctx) => {
  const port = ctx.deps.guests.startRunsForGuests;
  if (!port) {
    throw new PermanentNodeExecutionError(
      'capability_unavailable',
      'הפעולה "הרצה לכל אורח" אינה זמינה בסביבה הזו.',
    );
  }

  // The EVENT, not a guest: this node runs once, about a whole list. It needs no
  // contact — the children are what carry one — so `requireGuestContext` would
  // be the wrong gate and would make the node unusable in the scheduled run it
  // exists for.
  const eventId = ctx.trigger.eventId;
  if (!eventId) {
    throw new PermanentNodeExecutionError(
      'missing_event_context',
      'הצעד "הרצה לכל אורח" פועל על אירוע. שייכו את התהליך לאירוע מסוים.',
    );
  }

  // The key is checked against ForEachGuestConfig at compile time; the value is
  // still read defensively, because the config is an unvalidated jsonb row.
  const targetWorkflowId = readString<ForEachGuestConfig>(config, 'targetWorkflowId').trim();
  if (targetWorkflowId === '') {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "הרצה לכל אורח" לא הוגדר עם תהליך להרצה.',
    );
  }

  // ⚠️ NOT ITSELF. Documented as a rule from the day this node was written and
  // never implemented until 2026-09-14: a workflow starting itself per guest has
  // every child fan out again, and the dedupe key cannot stop it because the
  // parent run id is new each generation.
  //
  // Also checked at ARM time, where it is a static property of the diagram and
  // can be refused before anything runs. Kept here too because arming is not
  // required to be a fan-out TARGET — a workflow can be started by another
  // fan-out without ever being armed — and because the id lives in a jsonb row
  // that arming does not re-read.
  if (targetWorkflowId === ctx.workflowId) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "הרצה לכל אורח" מצביע על התהליך הזה עצמו. תהליך שמפעיל את עצמו לכל אורח אינו נעצר.',
    );
  }

  // ⚠️ AND NOT ENDLESSLY DEEP. `self` is only the shortest cycle; W1 → W2 → W1
  // is the same exponential. Depth is what actually bounds the tree.
  // ⚠️ COERCED, NOT TRUSTED. `trigger_payload` is jsonb and nothing guarantees a
  // number in it. `'lots' + 1` is `'lots1'`, and `'lots1' > 3` is FALSE — so a
  // junk value would sail past this cap in every generation, forever. Anything
  // that is not a finite non-negative number counts as depth 0, which is the
  // safe reading: it costs one generation, where trusting it costs all of them.
  const parentDepth = ctx.trigger.fanoutDepth;
  const depth =
    (typeof parentDepth === 'number' && Number.isFinite(parentDepth) && parentDepth >= 0
      ? Math.floor(parentDepth)
      : 0) + 1;
  if (depth > MAX_FANOUT_DEPTH) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      `הצעד "הרצה לכל אורח" חרג מעומק השרשרת המותר (${MAX_FANOUT_DEPTH}). תהליך מפעיל תהליך שמפעיל תהליך — כנראה מעגל.`,
    );
  }

  const rawMax = config.maxGuests;
  const maxGuests = typeof rawMax === 'number' ? rawMax : Number(rawMax);
  if (!Number.isFinite(maxGuests) || maxGuests <= 0) {
    // Permanent and explicit: a missing ceiling is the one thing this node must
    // never treat as "no limit".
    throw new PermanentNodeExecutionError(
      'missing_cap',
      'הצעד "הרצה לכל אורח" חייב תקרה — כמה אורחים לכל היותר.',
    );
  }

  const statuses = Array.isArray(config.statuses)
    ? config.statuses.filter((v): v is string => typeof v === 'string')
    : [];

  const result = await port({
    parentRunId: ctx.runId,
    nodeId: ctx.nodeId,
    eventId,
    targetWorkflowId,
    ...(statuses.length > 0 ? { statuses } : {}),
    // Default TRUE: a run about a guest with no phone can do nothing that
    // reaches them, so it is noise in the log and a wasted job.
    requirePhone: config.requirePhone !== false,
    maxGuests,
    // The generation this fan-out is creating. The port stamps it on each
    // child so the NEXT fan-out can refuse a fourth.
    depth,
  });

  return result.ok
    ? {
        output: {
          started: result.started,
          matched: result.matched,
          // `capped` is not cosmetic: it is the difference between "everyone got
          // one" and "the first 200 did", and an owner reading the log needs to
          // know which happened.
          capped: result.capped,
        },
      }
    : {
        output: { started: 0, reason: result.reason },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};
