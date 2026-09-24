import 'server-only';


import { editorDiagramSchema } from './adapter/editor-schema';
import { hashWebhookToken, webhookHashesMatch } from './webhook-token';
import { isTriggerType } from './catalogue/nodes';
import { authModeFor, INBOUND_HTTP_TRIGGER_TYPES } from './catalogue/types';
import * as sumitCardTriggerDefinition from './nodes/trigger-sumit-card/definition';
import { webhookAllowsMethod } from './nodes/trigger-webhook/match';
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
//   1. A 32-byte CSPRNG SECRET is the whole credential, compared in CONSTANT
//      TIME against a stored sha256 — never against a plaintext copy, because
//      the diagram is snapshotted into every run row. WHERE it arrives is the
//      node's `auth` mode and nothing else:
//        `header`  (default, and every diagram saved before the field) — in
//                  `x-kalfa-webhook-secret`, with a public endpoint id in the
//                  path, so no secret reaches an access log or a Referer.
//        `address` — the path segment itself, for a caller that can be given a
//                  URL and nothing else. Chosen by the owner on 2026-09-23 for
//                  SUMIT, whose `/triggers/triggers/subscribe/` has one field
//                  for the destination and no way to add a header.
//      See plans/webhook-address-vs-secret.md for the trade each mode makes.
//   2. Only ARMED workflows are searched. Disarming a workflow closes its URL.
//   3. The run carries NO event and NO contact, so every guest-touching node
//      refuses inside it (`requireGuestContext`). A leaked token means "someone
//      can make this workflow run", never "someone can reach our data".
//   4. The body is size-capped before it is parsed, and stored verbatim after.

/** Bigger than any sane hook payload, small enough that a run row stays sane. */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export type WebhookTriggerResult =
  | {
      ok: true;
      runId: string | undefined;
      /**
       * The status to answer a NEW run with. 202 for `trigger.webhook`, as it
       * always was; 200 for `trigger.sumit_card`, because SUMIT's help article
       * says it waits for "HTTP Status 200" and suspends the whole trigger after
       * five answers it does not accept. Decided here, by node type, so the
       * route stays transport and does not learn which caller is which.
       */
      acceptedStatus: 200 | 202;
    }
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
  // ⚠️ ONLY THE PATH IS REQUIRED UP FRONT NOW. It used to bail here on an empty
  // SECRET too, which was right while every node was header-authenticated and
  // is wrong now: an `address`-mode node asks for no header at all, so a blanket
  // refusal would make that mode unreachable. The secret is still mandatory —
  // per node, below, for every node that is in `header` mode.
  if (endpointId.trim() === '') return null;

  // Hashed ONCE, outside the loop: the diagram stores `tokenHash`, so the value
  // a caller sent is turned into the stored form before anything is compared.
  // The value itself never appears in a workflow's JSON — see webhook-token.ts.
  //
  // BOTH halves are hashed because either one can be the credential, and which
  // it is depends on the NODE, which is not known until the loop. Hashing the
  // path unconditionally also keeps the work per call identical in both modes.
  const presentedSecret = secret.trim() === '' ? '' : await hashWebhookToken(secret);
  const presentedPath = await hashWebhookToken(endpointId);

  for (const workflow of await listArmedWorkflows()) {
    const parsed = editorDiagramSchema.safeParse(workflow.definition);
    if (!parsed.success) continue;

    const triggers = parsed.data.nodes.filter((n) => isTriggerType(n.data.type));
    // Exactly one trigger, the same rule the adapter enforces. A diagram with
    // two is invalid and must not be reachable by either of its addresses.
    if (triggers.length !== 1) continue;

    const trigger = triggers[0]!;
    // Every trigger this route may start. `trigger.sumit_card` is the same
    // endpoint with a known caller — see `INBOUND_HTTP_TRIGGER_TYPES` for why it
    // is not a route of its own.
    if (!(INBOUND_HTTP_TRIGGER_TYPES as readonly string[]).includes(trigger.data.type)) continue;

    const properties = (trigger.data.properties ?? {}) as Record<string, unknown>;

    // The stored hash is the one thing BOTH modes have. What it is a hash OF is
    // what the mode decides.
    const configuredHash = properties.tokenHash;
    if (typeof configuredHash !== 'string' || configuredHash.trim() === '') continue;

    // ⚠️ THE NODE TYPE DECIDES THE MODE, NOT THE ROW. `authModeFor` returns
    // `address` for a SUMIT trigger whatever its stored `auth` says — so a
    // hand-edited row can neither make SUMIT wait for a header it cannot send,
    // nor promote a stored public id into a credential.
    if (authModeFor(trigger.data.type, properties) === 'address') {
      // ⚠️ THE PATH IS THE CREDENTIAL, so it is compared against the HASH and
      // never against a stored copy — there is no stored copy, which is the
      // point: a plaintext segment in the diagram would ride along in every
      // run's `definitionSnapshot`. A caller that presents a header as well is
      // neither helped nor refused by it; this mode simply does not read one.
      if (!webhookHashesMatch(configuredHash, presentedPath)) continue;
    } else {
      // ⚠️ HEADER MODE IS UNCHANGED, INCLUDING ITS REFUSALS. An empty header
      // hashes to `''` above and can never equal a 64-character digest, so a
      // caller who knows the public id and sends no secret still gets nothing.
      const configuredId = properties.endpointId;
      if (typeof configuredId !== 'string' || configuredId.trim() === '') continue;
      if (!webhookHashesMatch(configuredId, endpointId)) continue;
      if (!webhookHashesMatch(configuredHash, presentedSecret)) continue;
    }

    // ⚠️ THE METHOD IS CHECKED HERE, NOT IN THE ROUTE, and it is checked LAST.
    // Here, because the route would otherwise be a second place that decides who
    // gets in. Last, because answering "wrong method" before the secret is
    // verified would tell an unauthenticated caller that this endpoint exists.
    //
    // A SUMIT trigger is POST-ONLY by type: SUMIT's HTTP step posts JSON and
    // nothing else, so a stored `methods` list — which this node does not even
    // declare — is not consulted. `undefined` is `webhookAllowsMethod`'s own
    // "POST only".
    const allowedMethods =
      trigger.data.type === sumitCardTriggerDefinition.type ? undefined : properties.methods;
    if (!webhookAllowsMethod(allowedMethods, method)) continue;

    return { workflow, triggerType: trigger.data.type };
  }
  return null;
}

/**
 * The body a SUMIT trigger stores when what arrived is not one JSON object.
 *
 * ⚠️ SAVE FIRST, JUDGE LATER — SUMIT's own contract. Its help article asks the
 * receiver to store the call and answer that it was received, and to do the
 * processing afterwards; an answer it does not accept counts as a failure, and
 * five of them suspend the trigger. On 2026-09-23 the first live calls from
 * SUMIT were answered 400 by the shape check below (measured in the proxy log:
 * `expected_json_object`, 43 bytes plus HTTP/1.1 chunk framing = the 54 logged)
 * — so SUMIT does NOT always send the single `{ Folder, EntityID, … }` object
 * its screenshot shows, and nobody here has seen what it does send.
 *
 * So a SUMIT node keeps what arrived instead of refusing it, under a key that
 * says what it is: `value` for JSON that is not an object, `text` for a body
 * that is not JSON at all.
 *
 * ⚠️ THE REAL SHAPE, MEASURED on the first stored run (2026-09-23 09:31): SUMIT
 * sends a FORM, `json=<url-encoded JSON object>` — the `{ Folder, EntityID,
 * Type, Properties }` object its screenshot shows, wrapped in one form field.
 * That is why the object-only check answered 400. It is unwrapped here with
 * the platform's own `URLSearchParams`, and only when the field holds exactly
 * one JSON object; anything else still falls through to `text`, so an
 * unexpected shape is kept for a person to read rather than dropped.
 */
function sumitBody(rawBody: string): Record<string, unknown> {
  if (rawBody.trim() === '') return {};
  const asObject = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = asObject(rawBody);
  if (direct) return direct;
  try {
    return { value: JSON.parse(rawBody) as unknown };
  } catch {
    // Not JSON — SUMIT's form, or something else.
  }
  const formField = new URLSearchParams(rawBody).get('json');
  const fromForm = formField === null ? null : asObject(formField);
  return fromForm ?? { text: rawBody };
}

/**
 * Start a run from an inbound webhook call.
 *
 * `runId: undefined` with `ok: true` is a REDELIVERY — the dedupe key already
 * exists — and is reported as success, because the caller did nothing wrong and
 * retrying would only produce the same answer.
 */
export async function startRunFromWebhook(input: {
  /**
   * The path segment. In `header` mode it is a public id that proves nothing;
   * in `address` mode it IS the credential. The route cannot tell which — only
   * the node knows — so it always passes both this and the header through.
   */
  endpointId: string;
  /** From `WEBHOOK_SECRET_HEADER`. The credential in `header` mode; ignored in `address` mode. */
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

  // The object a `trigger.webhook` needs, or null when the body is not one.
  // Parsed BEFORE the lookup but not yet ACTED on: which rule applies depends on
  // the node the address resolves to, and only the lookup knows that.
  let objectBody: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = input.rawBody.trim() === '' ? {} : JSON.parse(input.rawBody);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      objectBody = parsed as Record<string, unknown>;
    }
  } catch {
    objectBody = null;
  }

  const found = await findWorkflowForEndpoint(input.endpointId, input.secret, input.method);

  // ⚠️ EVERY ANSWER A `trigger.webhook` CALLER COULD GET BEFORE, IT STILL GETS.
  // A body that is not one JSON object was refused BEFORE the lookup, so it was
  // 400 whether or not the address existed; checking it first here keeps that
  // exactly — an unknown address with a bad body is still 400, never a 404 that
  // would now say "the body was fine, the address was not".
  if (!found) return objectBody ? { ok: false, reason: 'not_found' } : { ok: false, reason: 'bad_json' };
  // ONE answer for "no such endpoint", "wrong secret", "verb not allowed", and
  // "belongs to a disarmed workflow" — above. Distinguishing them would turn
  // this endpoint into an oracle for which webhooks exist and which secrets are
  // close.

  const { workflow, triggerType } = found;
  const isSumit = triggerType === sumitCardTriggerDefinition.type;

  // An array or a bare scalar is valid JSON and not a usable `trigger.webhook`
  // body: `{{trigger.body.x}}` has nothing to name. Refused rather than coerced
  // — for that node. A SUMIT node keeps what arrived; see `sumitBody`.
  if (!isSumit && !objectBody) return { ok: false, reason: 'bad_json' };
  const body = isSumit ? sumitBody(input.rawBody) : objectBody!;

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

  return { ok: true, runId, acceptedStatus: isSumit ? 200 : 202 };
}
