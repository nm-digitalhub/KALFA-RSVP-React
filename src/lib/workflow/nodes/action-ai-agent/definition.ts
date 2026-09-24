// `action.ai_agent`: the pure contract, shared by the editor and the server.
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
export const type = 'action.ai_agent' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * The models this node may ask, spelled as the `claude` CLI spells them.
 *
 * ⚠️ ALIASES, NOT MODEL IDS. `run-role.sh` passes `--model "$MODEL"` with values
 * from `fleet.json` (`haiku`, `sonnet`), and the CLI resolves an alias to
 * whatever the current model behind it is. Pinning an id here would freeze this
 * node on a model that is eventually retired, and the fleet would already have
 * moved on.
 */
export const AI_AGENT_MODELS = ['haiku', 'sonnet'] as const;
export type AiAgentModel = (typeof AI_AGENT_MODELS)[number];

/** Bounds a single step. Low on purpose — a workflow step is not a conversation. */
export const AI_AGENT_MAX_TURNS = { min: 1, max: 20, default: 4 } as const;

export type AiAgentConfig = {
  /** Free text with `{{…}}` references, resolved before the handler sees it. */
  systemPrompt: string;
  model: AiAgentModel;
  maxTurns: number;
  /**
   * The tools the node asks for, in the SDK's fixed `AiTools` row shape.
   *
   * ⚠️ `apiKey` IS PART OF THAT SHAPE AND WE LEAVE IT EMPTY. The vendor's control
   * is a repeater bound to `{ id, sourceHandle, tool, description, apiKey }` and
   * the shape cannot be changed (its own docs: "Surface specific to the demo's
   * AI-agent node"). Our tools are KALFA capabilities reached through the
   * settings file, so none of them has a per-tool key — and a diagram is
   * exportable, which is why nothing would justify putting one there.
   */
  tools?: readonly { tool?: string; description?: string; apiKey?: string }[];
};

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'systemPrompt', 'model'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 *
 * ⚠️ `secret`, WHICH STRIPS THE WHOLE ARRAY ON EXPORT — and that is the right
 * trade even though the tool NAMES would travel fine.
 *
 * `AiTools` is a repeater bound to a row shape we cannot change:
 * `{ id, sourceHandle, tool, description, apiKey }`, per the vendor's own
 * docs ("Surface specific to the demo's AI-agent node"). The handler never
 * reads `apiKey` and the panel tells the owner not to type one — but a
 * diagram is EXPORTABLE, the editor's menu puts one in a copyable box, and a
 * field that CAN hold a credential eventually does. Losing re-enterable tool
 * names at the destination costs a minute; exporting a key someone typed
 * anyway is not recoverable.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  tools: 'secret',
};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `text`, `costUsd` and `sessionId` keys by hand.
 */
export const outputFields = {
  text: {
    type: 'string',
    label: 'תשובת המודל',
    description: 'זמינה כ-{{nodes.<מזהה>.text}}',
  },
  // Published so a run's cost is visible on the step that spent it — the
  // way the fleet's own index line records it per role.
  costUsd: { type: 'number', label: 'עלות הקריאה', description: 'בדולרים; ריק בהרצה יבשה' },
  sessionId: { type: 'string', label: 'מזהה הסשן', description: 'לאיתור מול עקבת ה-CLI' },
} as const;
