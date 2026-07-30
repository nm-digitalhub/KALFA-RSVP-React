import { z } from 'zod';

// Shared with src/app/(admin)/admin/fleet/actions.ts's resumeFleetGoalAction.
// One rule, enforced once: a next_wake_at string MUST carry an explicit UTC
// offset. offset:true rejects the naive datetime-local form outright — the
// owner's UI relies on this to catch a browser that failed to convert; the
// CLI relies on it to catch an agent that constructed a local-looking string
// instead of calling toISOString().
export const goalWakeAtSchema = z.iso.datetime({ offset: true, message: 'מועד לא תקין' });

export type GoalProgressOutcome =
  | 'advanced'
  | 'paused_on_failures'
  | 'stale_step'
  | 'not_active'
  | 'not_found';
export type GoalCloseOutcome = 'closed' | 'stale_step' | 'not_found' | 'already_closed';

// The run-context.sh contract: anything but the success outcome means the
// agent's write did NOT move the goal forward the way it expected, and it
// must stop rather than retry. One function, not a scattered condition at
// each call site, so the CLI and its tests share one definition of "stuck".
export function isGoalProgressStuck(outcome: GoalProgressOutcome): boolean {
  return outcome !== 'advanced';
}
export function isGoalCloseStuck(outcome: GoalCloseOutcome): boolean {
  return outcome !== 'closed';
}
