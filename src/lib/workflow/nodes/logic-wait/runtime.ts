// `logic.wait` — the step handler. Server side: SDK-free, and it imports the
// shared step contract from `steps/shared`, never from `steps/index` (the
// registry imports this file, so that would be a cycle).
//
// The park signal it throws is shared engine code, not this node's — see
// ../../engine/wait-signal.ts. `action.start_voice_call` parks with it too.
import { WorkflowWaitSignal } from '../../engine/wait-signal';
import { readEnum, type StepHandler } from '../../steps/shared';
import { PermanentNodeExecutionError } from '../../vendor/workflowbuilder/execution-core/errors';

import * as waitDefinition from './definition';

/**
 * How long a wait may be.
 *
 * A CEILING, not a preference. The deadline is stored and pg-boss holds a
 * delayed job for the whole span; a typo of "90" in a field meaning days is a
 * job sitting in the queue for three months. A year is past any real use of this
 * product — an event is over — so it costs nothing and catches the typo.
 */
export const MAX_WAIT_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The units a wait is expressed in, smallest first.
 *
 * `satisfies` ties the keys to the definition's `WAIT_UNIT_VALUES`, which the
 * form offers: a unit added there and not here fails to compile, instead of
 * being offered by the form and refused by the handler as `invalid_config`.
 */
export const WAIT_UNITS = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
} as const satisfies Record<waitDefinition.WaitUnitValue, number>;

export type WaitUnit = keyof typeof WAIT_UNITS;

export const waitNode: StepHandler = async (config, ctx) => {
  // ⚠️ THE RESUME BRANCH COMES FIRST, and without it a wait never ends.
  //
  // On resume the entire graph replays. A node that recomputed its deadline from
  // config would park for another full duration on every wake-up — a 3-day wait
  // that is never over. The LEDGER is the only thing that knows this row was
  // already parked and its time has passed, which is why `claimStep` reports it
  // and the handler is told rather than asked to work it out.
  if (ctx.resumedFromWait) {
    return { output: { waited: true, resumed: true } };
  }

  const unit = readEnum(config, 'unit', Object.keys(WAIT_UNITS) as WaitUnit[], waitDefinition.type);
  const rawAmount = config.amount;
  const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PermanentNodeExecutionError(
      'invalid_config',
      'הצעד "המתנה" הוגדר עם משך לא חוקי. יש להזין מספר גדול מאפס.',
    );
  }

  const ms = amount * WAIT_UNITS[unit];
  if (ms > MAX_WAIT_MS) {
    // Permanent: a shorter retry will not make the number smaller.
    throw new PermanentNodeExecutionError(
      'wait_too_long',
      'הצעד "המתנה" הוגדר לטווח ארוך משנה. קצרו את המשך.',
    );
  }

  throw new WorkflowWaitSignal(new Date(Date.now() + ms).toISOString());
};
