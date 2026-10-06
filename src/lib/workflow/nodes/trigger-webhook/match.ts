// `trigger.webhook` — its own pure matching predicate. Server side and SDK-free.
//
// Only the predicate lives here. The lookup that applies it —
// `findWorkflowForEndpoint` in `webhook-trigger.ts` — stays where it is: it is
// orchestration (armed-workflow scan, hash comparison through `webhook-token.ts`)
// and serves `trigger.sumit_card` behind the same route. `arm-check.ts` reads
// this too, so the arming gate and the live lookup answer "does this node admit
// that verb" with the same function.
//
// Imports nothing.

/**
 * Whether a configured method list admits this call.
 *
 * ⚠️ AN EMPTY LIST MEANS POST, NOT "EVERYTHING". Every webhook saved before this
 * field existed was POST-only by construction, so an absent value has to keep
 * meaning exactly that — reading it as "any method" would silently widen a live
 * public endpoint on deploy. Same rule, and the same reason, as `messageKinds`.
 *
 * Accepts BOTH shapes for the same reason `matchesKind` does: the SDK's
 * `ArrayFieldSchema` cannot describe an array of strings, so the control stores
 * `[{ value: 'POST' }]` while a hand-written or older diagram may hold
 * `['POST']`.
 */
export function webhookAllowsMethod(configured: unknown, method: string): boolean {
  const list = Array.isArray(configured)
    ? configured
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object' && typeof (entry as { value?: unknown }).value === 'string'
              ? (entry as { value: string }).value
              : '',
        )
        .filter((value) => value !== '')
    : [];
  const allowed = list.length === 0 ? ['POST'] : list;
  return allowed.includes(method);
}
