// `action.webhook`: the pure contract, shared by the editor and the server.
//
// ⚠️ IMPORTS NOTHING, not even a type. `catalogue/types.ts` imports this file to
// build `NODE_TYPES`, `NODE_REQUIRED_FIELDS` and `KalfaNodeConfig`, so an import
// back into types.ts (even a type-only one, which `no-circular` counts) would
// close a cycle. It is also read by the pg-boss worker, so it must stay SDK-free.
// `server-code-must-not-reach-the-editor-sdk` in .dependency-cruiser.cjs enforces
// the second half.

/**
 * The node type, stored verbatim in the diagram's `data.type`.
 *
 * A persistence contract: renaming it orphans every saved workflow that used it.
 */
export const type = 'action.webhook' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * An HTTP call to a system that is not ours.
 *
 * WIDENED 2026-09-13 from a POST-only "webhook" to a real HTTP request: method,
 * headers and an optional response capture. The node type id stays
 * `action.webhook` because nothing stored uses it (measured: 0 of 20 workflows)
 * and churning the id would touch the adapter, the catalogue and every test for
 * no behavioural gain.
 *
 * ⚠️ THE HEADERS FIELD REVERSES AN EARLIER DECISION, and the reason it can is
 * `secrets` below.
 *
 * The old note here argued: "a headers map is how an API key gets typed into a
 * diagram — and the diagram is a jsonb column the editor loads into a browser".
 * That reasoning was sound about the HAZARD and wrong about the CONCLUSION. The
 * answer to "a secret must not be in the diagram" is not "no headers" — it is
 * "headers hold a REFERENCE, and the value is fetched at the socket". Without
 * headers this node cannot call any authenticated API, which is most of them.
 *
 * So a header value may be `{{secrets.<NAME>}}`. That token is what is stored,
 * what the browser loads, what the dry run prints and what the run log echoes —
 * the secret itself exists only inside the worker process, for the microseconds
 * between the lookup and the socket write. `resolveTemplate` is explicitly
 * taught to LEAVE this namespace alone (see its `secrets` case) so the value
 * cannot leak by being resolved into the config early, and `redact.ts` cannot
 * help here: its matching is key-based, and the key on a header row is `value`.
 *
 * ON `captureResponse`. Off by default. A GET whose answer nobody can read is
 * pointless, so the response may be captured into the node's output and named as
 * `{{nodes.<id>.body}}` — but it is a THIRD PARTY's bytes landing in our run
 * store, so the owner has to ask for it, and it is capped.
 *
 * Declared here rather than in `catalogue/types.ts` because this module imports
 * nothing and the conditional contract below needs them. `catalogue/types.ts`
 * re-exports them for `outbound-webhook.ts`, the port in `engine/ports.ts` and
 * every other existing reader.
 */
export const HTTP_METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The method used when a diagram does not name one — what every saved node meant. */
export const DEFAULT_HTTP_METHOD: HttpMethod = 'POST';

/** Methods that carry a request body. A GET with a body is meaningless. */
export const HTTP_METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH'] as const;

/** One header row, as the `ArrayFieldSchema` control persists it. */
export type HttpHeader = { name: string; value: string };

export type WebhookConfig = {
  /** Absent means POST — the only thing this node could do before the widening. */
  method?: HttpMethod;
  url: string;
  headers?: HttpHeader[];
  /**
   * Free text, template-resolved like every other field, so it can carry
   * `{{trigger.guest_name}}` or `{{nodes.<id>.value}}`. Sent with
   * `Content-Type: application/json` unless a header row overrides it; the node
   * does not parse or validate it, because a body the receiver accepts is
   * between them and the receiver.
   */
  body: string;
  /** Opt in to reading the answer back. See the note above. */
  captureResponse?: boolean;
};

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 *
 * `body` is NOT here: it is required only on the verbs that send one — see
 * `conditionalRequirements` below.
 */
export const requiredFields: string[] = ['label', 'description', 'url'];

/**
 * The budget for one call of the handler. The port's own `TIMEOUT_MS` is 10s
 * (outbound-webhook.ts); this is that plus room.
 */
export const activityProfile = { timeoutMs: 20_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * Both `secret`: `dry-run.ts` already refuses to print header values, because an
 * owner may type a literal secret before reading the warning, and a URL can be
 * ENTIRELY a secret (a Slack incoming webhook). An export file is the same class
 * of artefact. Values are `'identifier' | 'secret' | 'catalogue'` — spelled out
 * here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  url: 'secret',
  headers: 'secret',
};

/**
 * The field that is required only on some verbs — `NODE_CONDITIONAL_REQUIRED_FIELDS`
 * reads this, and through it both the editor schema's `allOf` and `arm-check.ts`.
 *
 * `sendOutboundWebhook` genuinely branches on the verb: it builds, resolves and
 * secret-checks the body and then, for GET and DELETE, does not send it. So the
 * body is mandatory on exactly the three verbs that send one.
 *
 * The element shape is `ConditionalRequirement` from `catalogue/types.ts`,
 * spelled out rather than imported because this file imports nothing; the
 * registry's own type checks the assignment. `fallback` is inside `whenIn`, as
 * that type's warning requires.
 */
export const conditionalRequirements: readonly {
  readonly decidedBy: string;
  readonly whenIn: readonly string[];
  readonly fallback: string;
  readonly require: string;
  readonly message: string;
}[] = [
  {
    decidedBy: 'method',
    whenIn: HTTP_METHODS_WITH_BODY,
    fallback: DEFAULT_HTTP_METHOD,
    require: 'body',
    message:
      'סוג הבקשה שנבחר שולח גוף, והגוף ריק. כתבו את גוף הבקשה, או החליפו ל-GET / DELETE שאינם שולחים גוף.',
  },
];

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same keys by hand.
 */
export const outputFields = {
  ok: { type: 'boolean', label: 'הצליח', description: 'האם התקבלה תשובת 2xx' },
  status: { type: 'number', label: 'קוד התגובה' },
  reason: { type: 'string', label: 'סיבת הכישלון' },
  // Declared unconditionally even though it is written only when the owner
  // turned the switch on: outputSchema is static palette data and cannot
  // vary per node instance. Offering it always is the lesser fault — the
  // reference resolves to '' on a node that did not capture, which the `?`
  // and `| default:` modifiers both handle, whereas withholding it would
  // hide a real field from the picker on every node that DID capture.
  body: { type: 'string', label: 'גוף התשובה', description: 'רק אם הופעלה שמירת התשובה' },
  truncated: { type: 'boolean', label: 'התשובה נחתכה', description: 'התשובה ארוכה מ-8KB' },
} as const;
