import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { editorDiagramSchema } from './adapter/editor-schema';
import { isTriggerType } from './catalogue/nodes';
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
//   1. The token is the whole credential, compared in CONSTANT TIME.
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
 * Constant-time token comparison.
 *
 * `===` on a secret leaks its length and its matching prefix through timing. The
 * tokens are the same length by construction, but a caller controls the value it
 * sends, so the lengths are equalised before comparing rather than after.
 */
function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The armed workflow whose webhook trigger carries this token.
 *
 * Scans armed workflows in memory rather than querying the jsonb. Measured
 * 2026-09-13: two armed workflows out of twenty rows, so the scan is trivial —
 * and it reuses `findTriggerNode`'s own rule (the CATALOGUE decides what may
 * start a flow, never the stored JSON) instead of writing a second, looser
 * matcher in SQL.
 */
async function findWorkflowForToken(token: string) {
  if (token.trim() === '') return null;

  for (const workflow of await listArmedWorkflows()) {
    const parsed = editorDiagramSchema.safeParse(workflow.definition);
    if (!parsed.success) continue;

    const triggers = parsed.data.nodes.filter((n) => isTriggerType(n.data.type));
    // Exactly one trigger, the same rule the adapter enforces. A diagram with
    // two is invalid and must not be reachable by either of its tokens.
    if (triggers.length !== 1) continue;

    const trigger = triggers[0]!;
    if (trigger.data.type !== 'trigger.webhook') continue;

    const configured = trigger.data.properties?.token;
    if (typeof configured !== 'string' || configured.trim() === '') continue;
    if (!tokensMatch(configured, token)) continue;

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
  token: string;
  rawBody: string;
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

  const workflow = await findWorkflowForToken(input.token);
  // ONE answer for "no such token" and for "token belongs to a disarmed
  // workflow". Distinguishing them would turn this endpoint into an oracle for
  // which tokens exist.
  if (!workflow) return { ok: false, reason: 'not_found' };

  // NO eventId and NO contactId, deliberately — see the header. The payload is
  // otherwise the same shape every trigger produces, so a template written
  // against one trigger does not silently resolve to nothing under another.
  const triggerPayload: WorkflowTriggerPayload = {
    message_text: '',
    button_payload: '',
    body,
  };

  const runId = await createRunIfNew({
    workflowId: workflow.id,
    eventId: null,
    triggerSource: 'webhook',
    // Only deduped when the CALLER asked for it. Without a key every call is a
    // new run, which is the right default for a hook: two identical POSTs from a
    // system that does not deduplicate are two genuine events.
    dedupeKey: input.idempotencyKey ? `webhook:${workflow.id}:${input.idempotencyKey}` : null,
    triggerPayload,
  });

  return { ok: true, runId };
}
