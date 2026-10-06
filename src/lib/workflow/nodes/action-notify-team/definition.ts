// `action.notify_team`: the pure contract, shared by the editor and the server.
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
export const type = 'action.notify_team' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

// An internal alert to the KALFA team — never to a guest.
//
// The one action here whose audience is us. It exists because an automation
// that quietly does the wrong thing is worse than one that fails: a workflow
// can now say "a guest asked something I do not understand" and put it in front
// of a person.
// Declared here rather than beside the handler because THREE modules have to
// agree on it — the palette's Select options, the handler's `readEnum` guard,
// and the port the alert crosses — and this module is the one they can all
// import (it pulls in nothing, so the worker can bundle it). `catalogue/types.ts`
// re-exports both for the port and every other existing reader.
export const NOTIFY_LEVELS = ['info', 'warn', 'error'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

export type NotifyTeamConfig = {
  title: string;
  detail: string;
  level: NotifyLevel;
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
export const requiredFields: string[] = ['label', 'description', 'title'];

/** The budget for one call of the handler: one alert through `TeamAlertsPort`. */
export const activityProfile = { timeoutMs: 20_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. `title` and `detail` are an author's
 * literals and `level` is a closed list compiled into the app, so all three mean
 * the same thing in any installation. Declaring `{}` rather than leaving the key
 * out is what lets `node-definitions.test.ts` tell "nothing to bind" from
 * "forgot". Values are `'identifier' | 'secret' | 'catalogue'` — spelled out here
 * rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `sent` key by hand.
 */
export const outputFields = {
  sent: { type: 'boolean', label: 'נשלח', description: 'האם ההתראה יצאה או נדחסה' },
} as const;
