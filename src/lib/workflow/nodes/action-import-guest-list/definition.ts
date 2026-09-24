// `action.import_guest_list`: the pure contract, shared by the editor and the
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
export const type = 'action.import_guest_list' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * `action.import_guest_list` — take the list that started this run and stage it.
 *
 * NO CONFIGURATION, deliberately. Every judgement a list needs is either already
 * made (which event: the trigger resolved the owner's, and refuses when there is
 * more than one active) or is the WORKFLOW's to make with the nodes around it
 * (notify? branch on how many rows? call the office?). A `mode` field here would
 * be a business rule buried in a node instead of drawn on the canvas.
 *
 * IT STAGES; IT DOES NOT CREATE GUESTS. The rows land as PENDING and a human
 * confirms them in the app — the same gate the hard-coded import has always had,
 * and the reason a leaked or mistaken list cannot put strangers into an event.
 * Direct creation is a separate decision, not an option hidden in a checkbox.
 */
export type ImportGuestListConfig = Record<string, never>;

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description'];

/**
 * The budget for one call of the handler. It walks a guest list and writes many
 * rows through `GuestActionsPort` — minutes, legitimately — so it takes the
 * ceiling (`MAX_NODE_TIMEOUT_MS`).
 */
export const activityProfile = { timeoutMs: 300_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. The node carries no business fields (see
 * `ImportGuestListConfig`): the list and the event come from the run, not from
 * the diagram, so nothing here names a row or a resource. Declaring `{}` rather
 * than leaving the key out is what lets `node-definitions.test.ts` tell "nothing
 * to bind" from "forgot". Values are `'identifier' | 'secret' | 'catalogue'` —
 * spelled out here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same keys by hand.
 *
 * NOT GUEST-SCOPED, deliberately: this run is about an OWNER sending a list, so
 * it has no contact — the handler checks for an event and an inbox row instead
 * of calling `requireGuestContext`.
 */
export const outputFields = {
  // Declared so the variable picker OFFERS it: a later step can post the
  // list onward, or a condition can branch on it. `array` is a real
  // VariableType in the SDK, not a widening.
  rows: { type: 'array', label: 'הרשימה עצמה', description: 'שם, טלפון, כמות וקבוצה לכל שורה' },
  rowCount: { type: 'number', label: 'כמה שורות נקלטו' },
  errorCount: { type: 'number', label: 'כמה שורות עם שגיאה' },
  fileName: { type: 'string', label: 'שם הקובץ', description: 'ריק כשנשלחו אנשי קשר' },
  reviewUrl: { type: 'string', label: 'קישור לסקירה ואישור' },
  created: { type: 'boolean', label: 'נקלט עכשיו', description: 'שקר אם הרשימה כבר נקלטה קודם' },
  // ⚠️ THE FAILURE BRANCH, PRODUCED SINCE DAY ONE AND NEVER DECLARED. The
  // handler returns TWO shapes: `{ staged: true, rows, … }` on success and
  // `{ staged: false, reason, message }` down the error port. Only the
  // first was published, so the picker never offered the other — and the
  // guest-import starter had to hard-code `{{…reason?}}` and
  // `{{…message?}}` from knowledge of the source file.
  //
  // Declared on the SAME schema rather than through the SDK's `variant`
  // output form. That form exists — `OutputVariant`, keyed on a
  // `dataPropertyName`/`dataPropertyValue` pair that `staged` would fit
  // exactly — and the bundle does consume it. But NO node in this
  // catalogue uses it, and whether the picker RENDERS it is a claim about
  // a UI that only a browser can settle. A field absent on the other
  // branch resolves to empty with `?`, which is what the templates
  // already do.
  staged: { type: 'boolean', label: 'נקלט בהצלחה', description: 'שקר במסלול "נכשל"' },
  reason: { type: 'string', label: 'סיבת הכישלון', description: 'קיים רק במסלול "נכשל"' },
  message: { type: 'string', label: 'פירוט הכישלון', description: 'קיים רק במסלול "נכשל"' },
} as const;
