import type { KalfaNodeType } from '../catalogue/types';
import * as conditionDefinition from '../nodes/logic-condition/definition';
import * as setValueDefinition from '../nodes/logic-set-value/definition';

// How long ONE execution of a node may take — the missing half of the wait work,
// adopted from the engine this project vendored its graph runner from.
//
// ⚠️ WHY IT WAS MISSING. Upstream runs `runGraph` on Temporal, where every node
// is an ACTIVITY and every activity carries its own `startToCloseTimeout`. Their
// `packages/temporal/src/workflow/activity-profiles.ts` ships
// `DEFAULT_NODE_ACTIVITY_PROFILE = { startToCloseTimeout: '10m' }` and a
// `NodeActivityProfiles` map keyed by `node.type`, so an AI node gets 30m and a
// decision gets 30s. We run the same `runGraph` on pg-boss, which has no notion
// of an activity: ONE job covers the WHOLE graph, so until now a single node
// could hold a run open indefinitely and nothing bounded it but the queue's
// `expireInSeconds` — which is not a node budget and was never set for it.
//
// This is that budget, enforced where we can enforce it: around the handler call
// in `activity-runner`.
//
// ⚠️ WHOLE PROFILES, NEVER PARTIALS — upstream's rule, kept for upstream's
// reason: "a partial would let you set a timeout and silently drop the retry
// cap, and what Temporal falls back to is unlimited retries". Ours carries one
// field today; requiring the whole object means adding a second cannot silently
// default on entries written before it existed.

export type NodeActivityProfile = {
  /**
   * The ceiling for one call of this node's handler. Exceeded, the step is
   * FAILED (not parked, not abandoned) so a later delivery may take the row
   * over — `claimStep` reclaims a 'failed' row immediately.
   */
  timeoutMs: number;
};

/**
 * What a node gets when its type has no entry.
 *
 * EXPLICIT, and that is the point. The alternative is no bound at all, which is
 * what we had: a handler that never settles holds its step row 'running' until
 * the 15-minute lease, and holds the pg-boss job until the queue expires it —
 * two timers that were never chosen for this and, before this change, happened
 * to be the same number.
 */
export const DEFAULT_NODE_ACTIVITY_PROFILE: NodeActivityProfile = { timeoutMs: 120_000 };

/**
 * Per-type budgets. A type with no entry resolves to the default and nothing
 * else — no merging, no inheritance.
 *
 * The numbers are each node's own worst case plus room, not a guess:
 *   `action.webhook`        its own `TIMEOUT_MS` is 10s (outbound-webhook.ts).
 *   `action.send_whatsapp`  one Graph API call.
 *   `action.start_voice_call` dials and returns; the WAIT is a park, not a call.
 *   `action.import_guest_list` / `action.start_for_each_guest` walk a guest list
 *                           and write many rows — minutes, legitimately.
 */
export const NODE_ACTIVITY_PROFILES: Readonly<Partial<Record<KalfaNodeType, NodeActivityProfile>>> =
  Object.freeze({
    [conditionDefinition.type]: conditionDefinition.activityProfile,
    'logic.switch': { timeoutMs: 5_000 },
    [setValueDefinition.type]: setValueDefinition.activityProfile,
    'logic.wait': { timeoutMs: 5_000 },
    'action.webhook': { timeoutMs: 20_000 },
    'action.send_whatsapp': { timeoutMs: 30_000 },
    'action.send_template': { timeoutMs: 30_000 },
    'action.notify_team': { timeoutMs: 20_000 },
    'action.update_guest_status': { timeoutMs: 20_000 },
    'action.set_guest_field': { timeoutMs: 20_000 },
    'action.create_callback_request': { timeoutMs: 30_000 },
    'action.start_voice_call': { timeoutMs: 60_000 },
    'action.start_rsvp_ai_callback': { timeoutMs: 60_000 },
    'action.import_guest_list': { timeoutMs: 300_000 },
    'action.start_for_each_guest': { timeoutMs: 300_000 },
  });

/**
 * The largest budget any node may be given.
 *
 * ⚠️ THIS IS THE BOTTOM OF A CHAIN OF THREE, and the order is the invariant:
 *
 *   node budget  <  queue `expireInSeconds`  <  `STEP_LEASE_MS`
 *
 * A node must finish or fail before pg-boss gives the job to a retry, and the
 * retry must not be able to reclaim the step row before the first attempt is
 * genuinely dead. Collapse any gap and the failure is silent: with the node
 * budget above the queue expiry, a retry arrives while the first handler is
 * still inside the node; with the queue expiry at the lease — which is exactly
 * where they sat, both at 900s, by inheritance rather than by choice — the retry
 * reclaims the row in the same second the previous attempt was given up on, and
 * two handlers run the same node.
 *
 * `workflow-budgets.test.ts` asserts the chain rather than trusting the comment.
 */
export const MAX_NODE_TIMEOUT_MS = 300_000;

/**
 * The budget for one node, by type.
 *
 * Validates rather than trusting the table: a zero, a negative, a NaN or an
 * over-ceiling entry is a bug that would otherwise present as a node that never
 * times out (or times out instantly), and both look like something else.
 */
export function nodeBudgetMs(nodeType: string): number {
  return resolveBudgetMs(
    (NODE_ACTIVITY_PROFILES as Record<string, NodeActivityProfile | undefined>)[nodeType],
  );
}

/**
 * The validation, separated from the lookup so it can be tested at all.
 *
 * `NODE_ACTIVITY_PROFILES` is frozen — deliberately, so nothing rewrites a
 * budget at run time — which also means a test cannot inject a bad entry through
 * it. The rule is the thing worth pinning, so the rule gets its own function.
 */
export function resolveBudgetMs(profile: NodeActivityProfile | undefined): number {
  const ms = profile?.timeoutMs ?? DEFAULT_NODE_ACTIVITY_PROFILE.timeoutMs;
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_NODE_TIMEOUT_MS) {
    return DEFAULT_NODE_ACTIVITY_PROFILE.timeoutMs;
  }
  return ms;
}

/** The code a node's own timeout raises, shared with whatever reads it. */
export const NODE_TIMEOUT_CODE = 'node_timeout';
