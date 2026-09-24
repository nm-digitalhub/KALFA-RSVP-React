// `action.send_template`: the pure contract, shared by the editor and the server.
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
export const type = 'action.send_template' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * `action.send_template` — an APPROVED WhatsApp template to the run's guest.
 *
 * THE COMPANION TO `action.send_whatsapp`, not a replacement, and the difference
 * is what WhatsApp permits:
 *
 *   `send_whatsapp` sends FREE TEXT, allowed only inside the 24-hour window a
 *     guest's own message opens. Right for answering someone who just wrote.
 *
 *   this sends a TEMPLATE, allowed at any time — so it is the only thing a
 *     workflow started by a clock can actually deliver.
 *
 * `messageKey` names a row in `message_templates`, never a Meta template name:
 * the row carries the approved name per language and per event type, so a brit
 * and a wedding resolve to different approved layouts from the same key.
 */
export type SendTemplateConfig = {
  messageKey: string;
};

// The message keys, NOT the Meta template names. A key resolves per event type
// and per language through `message_templates`, so one key sends the approved
// brit layout at a brit and the approved wedding one at a wedding.
//
// ⚠️ THE LABELS SAY WHICH ARE MARKETING. That is not decoration: a MARKETING
// template is subject to the consent gate (currently off, by the owner's
// decision) and routes through MM Lite, and an owner choosing one should know
// they are in a different regime from a reminder.
//
// Declared here, with the rest of the node's contract, because the editor's
// Select options (`schema.ts`) and the export check (`TEMPLATE_KEYS` below) both
// read it.
export const templateKeyOptions = [
  { value: 'invite', label: 'הזמנה' },
  { value: 'reminder_1', label: 'תזכורת ראשונה' },
  { value: 'reminder_2', label: 'תזכורת שנייה' },
  { value: 'final', label: 'הודעה אחרונה לפני האירוע' },
  { value: 'event_day_pay', label: 'תשלום ביום האירוע' },
  { value: 'thankyou', label: 'תודה אחרי האירוע (שיווקי)' },
  { value: 'gift', label: 'מתנה (שיווקי)' },
] as const;

/**
 * The same seven, as bare keys.
 *
 * DERIVED, never re-typed: the portability layer asks "does this key exist
 * wherever the workflow lands", and a second hand-written copy could answer yes
 * for a key the form no longer offers.
 */
export const TEMPLATE_KEYS: readonly string[] = templateKeyOptions.map((o) => o.value);

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'messageKey'];

/** The budget for one call of the handler: one template send through `GuestActionsPort`. */
export const activityProfile = { timeoutMs: 30_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `messageKey` is a key into a catalogue: it survives only where the same key
 * exists, which the export check decides against `TEMPLATE_KEYS`. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  messageKey: 'catalogue',
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
 * still writes the same `sent` and `reason` keys by hand.
 */
export const outputFields = {
  sent: { type: 'boolean', label: 'נשלח' },
  reason: { type: 'string', label: 'למה לא נשלח' },
} as const;
