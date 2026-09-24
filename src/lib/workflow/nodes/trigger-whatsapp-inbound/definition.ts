// `trigger.whatsapp_inbound`: the pure contract, shared by the editor and the server.
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
export const type = 'trigger.whatsapp_inbound' as const;

/**
 * A trigger: an inbound WhatsApp message may begin a flow. The catalogue reads
 * this flag, and it — not the stored JSON — is what decides who may start.
 */
export const isTrigger = true;

export type WhatsappInboundConfig = {
  // Optional pre-filter: run only when the message contains this text. Empty or
  // absent means every inbound message on the account starts a run.
  keyword?: string;
  /**
   * Which of OUR WhatsApp numbers the message must have arrived on.
   *
   * META'S phone_number_id, not an E.164 and not our provider_numbers UUID. It
   * is the value the webhook actually carries, so matching needs no lookup and
   * `planRuns` stays pure; an E.164 would break the day a number is registered
   * again, and our UUID would put a database read inside the one module that
   * must not have one.
   *
   * EMPTY OR ABSENT MEANS ANY NUMBER — the same rule as `keyword`, so every
   * diagram saved before this keeps firing exactly as it did.
   *
   * WHY IT EXISTS. The account has had two live numbers since 2026-09-10: the
   * RSVP sender and the import line. `startWorkflowRuns` runs beside
   * `processWebhookEvent` rather than behind it (worker/main.ts), so the inbound
   * ROUTER's decision — which sends import-line traffic to stageWhatsAppImport
   * and returns — never reached workflows. Every armed workflow has therefore
   * been firing on messages to BOTH numbers with no way to tell them apart.
   * This is the field that tells them apart.
   */
  phoneNumberId?: string;
  /**
   * WHICH KINDS OF MESSAGE may start this workflow.
   *
   * ⚠️ ABSENT OR EMPTY MEANS `DEFAULT_WHATSAPP_MESSAGE_KINDS`, and that default
   * is what keeps every diagram saved before this field behaving EXACTLY as it
   * did: only a guest actually speaking to us — text, a button tap, an
   * interactive reply, a reaction.
   *
   * WHY IT EXISTS. Guest import from WhatsApp — an owner sending a CSV or a
   * batch of contact cards — was a mechanism entirely outside workflows, and
   * unreachable from one: those messages are not "billable" (they are not a
   * guest being reached), and `createRunsForInboundMessage` used the BILLING
   * classifier as its automation gate, so a file or a contact card never created
   * a run at all. A billing concept was deciding what an owner may automate.
   *
   * The two are separated now. Billing still counts exactly what it counted;
   * which messages start a flow is a property of the TRIGGER, chosen per
   * workflow, and the owner opts in.
   *
   * A FREE LIST OF STRINGS, not a closed enum: Meta adds message types on its
   * own schedule, and a new one must be usable by editing a catalogue list
   * rather than by a migration of every stored diagram.
   */
  messageKinds?: string[];
};

/**
 * The message kinds the trigger offers, and what each one is.
 *
 * `label` is Hebrew because it is read in the properties panel. The `value` is
 * Meta's own `type` string from the webhook payload, so matching needs no
 * translation table.
 *
 * This list is the EDITOR's menu, never the enforcement: `matchesKind` compares
 * against whatever the diagram stored, so a kind added here works immediately
 * and a kind stored by a future version still matches after a downgrade.
 */
export const WHATSAPP_MESSAGE_KINDS = [
  { value: 'text', label: 'הודעת טקסט' },
  { value: 'button', label: 'לחיצה על כפתור' },
  { value: 'interactive', label: 'בחירה מתפריט' },
  { value: 'reaction', label: 'תגובה (אימוג׳י)' },
  { value: 'document', label: 'קובץ (למשל רשימת אורחים)' },
  { value: 'contacts', label: 'כרטיסי אנשי קשר' },
  { value: 'image', label: 'תמונה' },
  { value: 'audio', label: 'הקלטה קולית' },
  { value: 'video', label: 'סרטון' },
] as const;

/**
 * What a trigger with no `messageKinds` means.
 *
 * EXACTLY today's `BILLABLE_MESSAGE_TYPES`, and that is the point: it is the
 * behaviour every saved diagram already has, preserved by construction rather
 * than by a migration. `inbound.test.ts` pins the two lists against each other.
 */
export const DEFAULT_WHATSAPP_MESSAGE_KINDS: readonly string[] = [
  'text',
  'button',
  'interactive',
  'reaction',
];

/**
 * The kinds that are an OWNER sending us something, not a guest speaking.
 *
 * A run started by one of these carries an event but NO contact: the sender is
 * the person who owns the event, so there is no guest the run is "about", and
 * every guest-touching node refuses inside it (`requireGuestContext`). That is
 * the same shape `trigger.webhook` produces, and for the same reason.
 */
export const OWNER_WHATSAPP_MESSAGE_KINDS: readonly string[] = ['document', 'contacts'];

/**
 * The message kinds whose payload carries text a `keyword` can match.
 *
 * ⚠️ EXACTLY ONE, AND THAT IS A FACT ABOUT `inbound.ts`, NOT A POLICY. The text
 * a keyword is tested against is `readTextBody(payload)`, which reads
 * `payload.text?.body` and nothing else — so for every other kind the string is
 * `''` and `matchesKeyword` returns false for any non-empty keyword. A button
 * tap carries its label under `button.text` and its payload under
 * `button.payload`; neither reaches the keyword filter (the payload is routed on
 * separately, by `logic.switch` against `{{trigger.button_payload}}`).
 *
 * `keyword-reach.test.ts` proves this against `planRuns` itself rather than
 * against this list, so the list cannot drift away from the engine silently.
 */
export const TEXT_BEARING_WHATSAPP_MESSAGE_KINDS: readonly string[] = ['text'];

/**
 * The properties this node cannot run without.
 *
 * Only the identity pair: every filter on this trigger is optional, and absent
 * means its widest reading (any text, any number, the default kinds).
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `phoneNumberId` is Meta's id for one of OUR numbers: it resolves to nothing in
 * another installation. Values are `'identifier' | 'secret' | 'catalogue'` —
 * spelled out here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  phoneNumberId: 'identifier',
};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The trigger's output is the inbound message itself. With this declared,
 * `{{nodes.<trigger-id>.message_text}}` appears in the picker — note that
 * `{{trigger.message_text}}` reaches the SAME value by the other namespace,
 * which upstream's guide warns are not interchangeable in general.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `message_text` and `button_payload` keys by hand;
 * `references.test.ts` is what catches a template naming a key this list does
 * not declare.
 */
export const outputFields = {
  message_text: { type: 'string', label: 'תוכן ההודעה', description: 'מה שהאורח כתב' },
  button_payload: { type: 'string', label: 'כפתור שנלחץ' },
} as const;
