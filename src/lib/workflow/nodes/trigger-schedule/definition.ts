// `trigger.schedule`: the pure contract, shared by the editor and the server.
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
export const type = 'trigger.schedule' as const;

/**
 * A trigger: the clock may begin a flow. The catalogue reads this flag, and it —
 * not the stored JSON — is what decides who may start.
 */
export const isTrigger = true;

/**
 * `trigger.schedule` — the clock starts the flow.
 *
 * A TIME AND A SET OF DAYS, not a cron expression. A cron string is a
 * programmer's tool with five interdependent fields; an owner who mistypes one
 * gets an automation firing at a time nobody intended, and it still parses. This
 * shape cannot be wrong in a way that survives.
 *
 * Israel time, always — see `schedule.ts` for why the slot is formatted rather
 * than computed, and what breaks twice a year if it is not.
 *
 * EMPTY OR ABSENT `days` MEANS EVERY DAY, the same "unset is widest" rule the
 * keyword and receiving-number filters follow.
 */
export type ScheduleTriggerConfig = {
  /** `HH:MM`, 24-hour, Israel time. */
  time: string;
  /** Sunday = 0. Empty or absent: every day. */
  days?: number[];
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
export const requiredFields: string[] = ['label', 'description', 'time'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. A time of day and a set of weekdays mean
 * the same thing in any installation. Declaring `{}` rather than leaving the key
 * out is what lets `node-definitions.test.ts` tell "nothing to bind" from
 * "forgot". Values are `'identifier' | 'secret' | 'catalogue'` — spelled out
 * here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `firedAt` key by hand; `references.test.ts` is what
 * catches a template naming a key this list does not declare.
 */
export const outputFields = {
  firedAt: { type: 'string', label: 'מתי רץ', description: 'התאריך והשעה בשעון ישראל' },
} as const;
