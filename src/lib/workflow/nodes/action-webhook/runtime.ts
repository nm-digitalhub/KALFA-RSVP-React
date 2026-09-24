// `action.webhook` — the step handler. Server side: SDK-free, and it imports
// the shared step contract from `steps/shared`, never from `steps/index` (the
// registry imports this file, so that would be a cycle).
import { ACTION_BRANCH_HANDLES } from '../../catalogue/types';
import { readString, type StepHandler } from '../../steps/shared';

import { HTTP_METHODS, type HttpHeader, type WebhookConfig } from './definition';

// POST to a system that is not ours.
//
// The handler is deliberately thin: it reads two fields, builds the dedup key,
// and hands everything to the port. Every security decision — https, no private
// space, no redirect following, the timeout, the capped response — lives in the
// implementation behind that port, so there is no path from here to a socket
// that skips them.
//
// THE DEDUP KEY IS `<runId>:<nodeId>`, and the choice matters. It is the same on
// every replay of this node in this run, which is exactly the case the step
// lease can produce: a POST that completed but whose `completeStep` never landed
// gets sent again, and the receiver can recognise it. It is DIFFERENT for the
// same node in a different run, so two genuine messages from two guests are two
// calls and not one deduplicated away.
//
// A failure is an ANSWER, not a throw: it routes to the error branch so a
// workflow can carry on — notify the team, try a second endpoint — instead of
// ending `failed` because someone else's server was down.
export const webhook: StepHandler = async (config, ctx) => {
  // The keys are checked against WebhookConfig at compile time; the values are
  // still read defensively, because the config is an unvalidated jsonb row.
  const url = readString<WebhookConfig>(config, 'url').trim();
  // Already resolved: `resolveConfigTemplates` walked the config first, so this
  // is the rendered body and not `{{trigger.…}}`.
  //
  // With ONE exception, and it is the whole secrets design: `{{secrets.<NAME>}}`
  // is skipped by the resolver and is still a literal token here. The handler
  // must therefore never inspect, log or copy a header value — it passes the
  // rows straight to the port, which substitutes them at the socket.
  const body = readString<WebhookConfig>(config, 'body');
  const method = readOptionalEnum(config, 'method', HTTP_METHODS);
  const headers = readHeaderRows(config);
  const captureResponse = config.captureResponse === true;

  const result = await ctx.deps.webhook.post({
    url,
    method,
    headers,
    body,
    idempotencyKey: `${ctx.runId}:${ctx.nodeId}`,
    captureResponse,
  });

  // The URL is NOT in the output. It is already on the node in the editor, and
  // repeating it in the run log would copy a path segment — the one place this
  // node can legitimately carry a secret — into a second store.
  //
  // Neither are the HEADERS, for a stronger version of the same reason: after
  // the port ran they would be the substituted values.
  const base = {
    status: result.status,
    // Only when asked for. `undefined` rather than `null` so a node that did not
    // capture does not advertise an empty `body` in the variable picker.
    ...(captureResponse
      ? { body: result.body ?? '', truncated: result.truncated === true }
      : {}),
  };

  return result.ok
    ? { output: { ok: true, ...base } }
    : {
        output: { ok: false, ...base, reason: result.reason ?? null },
        nextPort: ACTION_BRANCH_HANDLES.error,
      };
};

/**
 * Header rows as the owner typed them — shape-checked, contents untouched.
 *
 * DELIBERATELY NOT VALIDATED BEYOND THE SHAPE. Reserved names, newlines and
 * secret substitution are all the port's job, because the port is the only thing
 * between here and a socket and a second copy of those rules would drift.
 */
function readHeaderRows(config: Record<string, unknown>): HttpHeader[] {
  const raw = config.headers;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const { name, value } = row as Partial<HttpHeader>;
    return typeof name === 'string' ? [{ name, value: typeof value === 'string' ? value : '' }] : [];
  });
}

/**
 * An enum field that may legitimately be absent.
 *
 * Distinct from `readEnum`, which THROWS on a missing value. `method` was added
 * after nodes were already saved without it, and a node that meant POST must
 * keep meaning POST rather than failing permanently on its next run.
 */
function readOptionalEnum<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = config[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}
