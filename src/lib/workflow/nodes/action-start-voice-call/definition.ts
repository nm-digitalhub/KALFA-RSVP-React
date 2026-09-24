// `action.start_voice_call`: the pure contract, shared by the editor and the
// server.
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
export const type = 'action.start_voice_call' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * `action.start_voice_call` — dial the guest through a configured voice purpose.
 *
 * Written from what the node actually carries: the fields its schema declares
 * (`voiceCallSchemaFor` in ./schema.ts) and the ones its handler reads
 * (`startVoiceCall` in ./runtime.ts). It was the one type with no member in
 * `KalfaNodeConfig`, and nothing noticed — `_KALFA_NODE_CONFIG_COVERS_ALL_TYPES`
 * in catalogue/types.ts is what notices now.
 *
 * The four dial parameters are optional and EMPTY MEANS "NOT SET": the handler
 * trims each and drops an empty one rather than sending it, so the purpose and
 * the account defaults decide.
 */
export type StartVoiceCallConfig = {
  /** A `voice_purposes.key`. Required; a blank one is refused at run time. */
  purposeKey: string;
  /** Voximplant caller id. Empty: the account default. */
  callerId?: string;
  /** Voximplant rule id. Empty: the rule bound to the purpose. */
  ruleId?: string;
  /** The number to dial instead of the guest's; may be a `{{…}}` reference. */
  toOverride?: string;
  /** ElevenLabs agent id. Empty: the scenario's own agent. */
  agentId?: string;
  /** Park the run until the call reports. Absent means false — dial and carry on. */
  waitForOutcome?: boolean;
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
export const requiredFields: string[] = ['label', 'description', 'purposeKey'];

/**
 * The budget for one call of the handler. It dials and returns; the WAIT for
 * the call's outcome is a park, not a call, and is not bounded by this.
 */
export const activityProfile = { timeoutMs: 60_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `purposeKey` names a `voice_purposes` row — a key into a catalogue, which
 * survives only where the same key exists. The four dial parameters point at
 * this installation's own numbers, rules and agents. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  purposeKey: 'catalogue',
  callerId: 'identifier',
  ruleId: 'identifier',
  agentId: 'identifier',
  toOverride: 'identifier',
};

/**
 * Refuses to run outside a run about a GUEST: the handler calls
 * `requireGuestContext`, and `GUEST_SCOPED_NODE_TYPES` lists this type so arming
 * refuses it under a trigger that never supplies one.
 */
export const guestScoped = true;

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * writes these keys by hand, and which of them appear depends on the path — a
 * refusal, a dial that does not wait, or a wait that ended. It also writes
 * `resumed` on the resume path; that one was never declared and stays
 * undeclared, because adding it would change what the variable picker offers.
 */
export const outputFields = {
  dialed: { type: 'boolean', label: 'חויג' },
  status: { type: 'string', label: 'תוצאה' },
  reason: { type: 'string', label: 'סיבה' },
  attemptId: { type: 'string', label: 'מזהה ניסיון' },
  // ⚠️ THE FIELD TO BRANCH ON, derived from the call's own report — so a
  // diagram never has to know that `sip_486` means Busy Here. The
  // technical fields below stay for debugging, not for conditions.
  //
  // ⚠️ `description` CARRIES THE VOCABULARY BECAUSE `type` CANNOT. The
  // SDK's `OutputProperty` is `{ type, label, description? }` and nothing
  // else (index.d.ts:1121, verified in 2.3.0) — `type` is a
  // `VariableType`, one of string/number/boolean/datetime/date/object/
  // array, and there is no enum, no options, no allowed-values field. The
  // shipped bundle reads only `.properties[path].type` off this schema, so
  // a list of legal values has nowhere else to live.
  //
  // It is not decoration: the picker builder copies `description` onto
  // every item it mints (`Ih` in index-CEBfv0NZ.js: `{id, display, label,
  // description, type}`), so this is the one string that reaches an owner
  // at the moment they are typing the right-hand side of a condition.
  //
  // Three values, not four: `follow_up_required` is in the TYPE but no
  // mapping produces it (voice-outcome.ts), and listing a value the engine
  // cannot emit would send someone off to build a branch that never fires.
  outcome: {
    type: 'string',
    label: 'תוצאת השיחה',
    description: 'אחד מ: completed (התקיימה והסתיימה), no_answer (לא ענו / לא דיווחה), failed (לא יצאה לדרך)',
  },
  // Only populated when the step waited. Narrower than `outcome`: it says
  // the call ENDED AND REPORTED, nothing about whether it went well.
  concluded: { type: 'boolean', label: 'השיחה הסתיימה ודיווחה' },
  finishReason: { type: 'string', label: 'סיבת סיום' },
  durationSec: { type: 'number', label: 'משך השיחה (שניות)' },
} as const;
