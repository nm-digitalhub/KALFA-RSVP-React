import 'server-only';


import { editorDiagramSchema } from './adapter/editor-schema';
import { hashWebhookToken, webhookHashesMatch } from './webhook-token';
import { isTriggerType } from './catalogue/nodes';
import { webhookAllowsMethod } from './catalogue/types';
import { createRunIfNew, listArmedWorkflows } from './store';

import type { WorkflowTriggerPayload } from './steps';

// The inbound half of `trigger.webhook`: an external system POSTs, a run starts.
//
// THE DYNAMIC TRIGGER. Nothing here knows or cares what the caller sends — the
// parsed JSON becomes `trigger.body` and templates name it as
// `{{trigger.body.<path>}}`. A second caller with a completely different shape
// needs no code change, no migration and no new node type.
//
// ⚠️ THIS IS A PUBLIC, UNAUTHENTICATED-BY-SESSION ENDPOINT — the first one this
// subsystem has. Four things bound it, and each is here rather than in the route
// so there is no second path that skips one:
//
//   1. The SECRET is the whole credential, compared in CONSTANT TIME — and it
//      arrives in a HEADER, never in the path. The path carries only a public
//      endpoint id, so a secret is no longer written into every access log and
//      Referer that records a URL. See plans/webhook-address-vs-secret.md.
//   2. Only ARMED workflows are searched. Disarming a workflow closes its URL.
//   3. The run carries NO event and NO contact, so every guest-touching node
//      refuses inside it (`requireGuestContext`). A leaked token means "someone
//      can make this workflow run", never "someone can reach our data".
//   4. The body is size-capped before it is parsed, and stored verbatim after.

/** Bigger than any sane hook payload, small enough that a run row stays sane. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export type WebhookTriggerResult =
  | { ok: true; runId: string | undefined }
  | { ok: false; reason: 'not_found' | 'too_large' | 'bad_json' };



/**
 * The armed workflow addressed by this endpoint id, IF the secret also matches.
 *
 * Scans armed workflows in memory rather than querying the jsonb. Measured
 * 2026-09-13: two armed workflows out of twenty rows, so the scan is trivial —
 * and it reuses `findTriggerNode`'s own rule (the CATALOGUE decides what may
 * start a flow, never the stored JSON) instead of writing a second, looser
 * matcher in SQL.
 *
 * ⚠️ BOTH HALVES ARE REQUIRED AND BOTH ARE COMPARED IN CONSTANT TIME. The
 * endpoint id is public, so a timing leak on it would reveal nothing an
 * attacker cannot already hold — but it is compared the same way regardless,
 * because "this one is safe to be sloppy with" is the reasoning that ages badly
 * when a field's meaning changes. A caller that presents a real id with a wrong
 * secret gets the same `null` as one that presents neither.
 */
async function findWorkflowForEndpoint(endpointId: string, secret: string, method: string) {
  if (endpointId.trim() === '' || secret.trim() === '') return null;

  // Hashed ONCE, outside the loop: the diagram stores `tokenHash`, so the value
  // a caller sent is turned into the stored form before anything is compared.
  // The secret itself never appears in a workflow's JSON — see webhook-token.ts.
  const presented = await hashWebhookToken(secret);

  for (const workflow of await listArmedWorkflows()) {
    const parsed = editorDiagramSchema.safeParse(workflow.definition);
    if (!parsed.success) continue;

    const triggers = parsed.data.nodes.filter((n) => isTriggerType(n.data.type));
    // Exactly one trigger, the same rule the adapter enforces. A diagram with
    // two is invalid and must not be reachable by either of its addresses.
    if (triggers.length !== 1) continue;

    const trigger = triggers[0]!;
    if (trigger.data.type !== 'trigger.webhook') continue;

    const configuredId = trigger.data.properties?.endpointId;
    if (typeof configuredId !== 'string' || configuredId.trim() === '') continue;
    if (!webhookHashesMatch(configuredId, endpointId)) continue;

    const configuredHash = trigger.data.properties?.tokenHash;
    if (typeof configuredHash !== 'string' || configuredHash.trim() === '') continue;
    if (!webhookHashesMatch(configuredHash, presented)) continue;

    // ⚠️ THE METHOD IS CHECKED HERE, NOT IN THE ROUTE, and it is checked LAST.
    // Here, because the route would otherwise be a second place that decides who
    // gets in. Last, because answering "wrong method" before the secret is
    // verified would tell an unauthenticated caller that this endpoint exists.
    if (!webhookAllowsMethod(trigger.data.properties?.methods, method)) continue;

    return workflow;
  }
  return null;
}

/**
 * Start a run from an inbound webhook call.
 *
 * `runId: undefined` with `ok: true` is a REDELIVERY — the dedupe key already
 * exists — and is reported as success, because the caller did nothing wrong and
 * retrying would only produce the same answer.
 */
export async function startRunFromWebhook(input: {
  /** Public, from the path. Identifies which webhook — proves nothing. */
  endpointId: string;
  /** The credential, from `WEBHOOK_SECRET_HEADER`. Never from the path. */
  secret: string;
  /** The verb this call arrived with. Checked against the node's allow-list. */
  method: string;
  rawBody: string;
  /**
   * The URL's query string, as a flat object.
   *
   * ⚠️ KEPT SEPARATE FROM `body`, NOT MERGED INTO IT. GET and DELETE carry no
   * body at all, so folding their parameters into `body` would make
   * `{{trigger.body.x}}` mean the request body on one verb and the query string
   * on another — resolving to nothing, silently, whenever a workflow's trigger
   * changed verb. n8n exposes `{ body, headers, params, query }` as distinct
   * members for the same reason.
   */
  query?: Record<string, string>;
  /** Caller-supplied idempotency key, if any. Falls back to a fresh run each call. */
  idempotencyKey?: string | null;
}): Promise<WebhookTriggerResult> {
  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  let body: Record<string, unknown>;
  try {
    const parsed = input.rawBody.trim() === '' ? {} : JSON.parse(input.rawBody);
    // An array or a bare scalar is valid JSON and not a usable trigger body:
    // `{{trigger.body.x}}` has nothing to name. Refused rather than coerced.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'bad_json' };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'bad_json' };
  }

  const workflow = await findWorkflowForEndpoint(input.endpointId, input.secret, input.method);
  // ONE answer for "no such endpoint", "wrong secret", "verb not allowed", and
  // "belongs to a disarmed workflow". Distinguishing them would turn this
  // endpoint into an oracle for which webhooks exist and which secrets are
  // close.
  if (!workflow) return { ok: false, reason: 'not_found' };

  // NO eventId and NO contactId, deliberately — see the header. The payload is
  // otherwise the same shape every trigger produces, so a template written
  // against one trigger does not silently resolve to nothing under another.
  const triggerPayload: WorkflowTriggerPayload = {
    message_text: '',
    button_payload: '',
    body,
    // Always present, even when empty — a template that names
    // `{{trigger.query.x}}` should resolve to nothing rather than throw on a
    // POST that happened to carry no query string.
    query: input.query ?? {},
  };

  const runId = await createRunIfNew({
    workflowId: workflow.id,
    eventId: null,
    triggerSource: 'webhook',
    definitionSnapshot: workflow.definition,
    // Only deduped when the CALLER asked for it. Without a key every call is a
    // new run, which is the right default for a hook: two identical POSTs from a
    // system that does not deduplicate are two genuine events.
    dedupeKey: input.idempotencyKey ? `webhook:${workflow.id}:${input.idempotencyKey}` : null,
    triggerPayload,
  });

  return { ok: true, runId };
}
