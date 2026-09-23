// What every step handler shares: the payload a run carries, the context a
// handler is called with, the config readers, and the guest-context guard.
//
// ⚠️ ITS OWN MODULE SO A NODE FOLDER CAN IMPORT IT. `steps/index.ts` is the
// registry — it imports every node's `runtime.ts` — so a runtime that imported
// these from the registry would close a cycle (`no-circular` counts type-only
// edges). Handlers import from here; the registry re-exports for its callers.
//
// SERVER-SAFE: no SDK, no `server-only`, no I/O. Enforced by
// `server-code-must-not-reach-the-editor-sdk` in .dependency-cruiser.cjs.
import type { KalfaNodeType } from '../catalogue/types';
import type {
  GuestActionsPort,
  AccountingPort,
  AiAgentPort,
  IntegrationsPort,
  OutboundWebhookPort,
  TeamAlertsPort,
} from '../engine/ports';
import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';
import type { NodeExecutionResult } from '../vendor/workflowbuilder/execution-core/ports/activity-runner.port';

// ---------------------------------------------------------------------------
// The trigger payload a run carries
// ---------------------------------------------------------------------------

// What the webhook drain hands a run. Narrow and explicit: the condition node's
// readable fields (CONDITION_FIELDS) are exactly the keys here, so the two
// cannot drift without a type error.
/**
 * What a run starts with, and — since the template resolver landed — the whole
 * of what `{{trigger.…}}` can name.
 *
 * The first four fields are the message. The last three are CONTEXT, added
 * 2026-09-10 because a resolver with nothing to resolve is not a feature: the
 * pipe was open and `{{trigger.message_text}}` was the only interesting thing
 * in it, so a personalised reply still could not say the guest's name.
 *
 * `guest_name` is a FIRST name, through `deriveGuestFirstName` — the same
 * derivation both WhatsApp send paths already use, so an automated greeting
 * reads exactly like a manual one, household rows included ("משפחת כהן" yields
 * nothing rather than greeting "שלום משפחת,").
 *
 * It is EMPTY when the phone backs more than one guest. That is the same
 * refusal `action.update_guest_status` makes, for the same reason: with several
 * guests behind one contact there is no answer to "whose name", and greeting
 * the wrong person by name is worse than not greeting at all.
 *
 * ON PII. These land in `workflow_runs.trigger_payload` and in the
 * `node_started` event payload. That store already holds `message_text` — the
 * guest's own words — so a first name and the event they were invited to add no
 * new CATEGORY of exposure. `redact.ts` is key-based and will not mask them, by
 * design: a workflow that cannot see a name cannot personalise a message, which
 * is the entire point of the field.
 */
export type WorkflowTriggerPayload = {
  /**
   * OPTIONAL SINCE `trigger.webhook` LANDED, and that is the whole point.
   *
   * A run started by an inbound WhatsApp message is always about a known guest
   * on a known event. A run started by an external system calling in is about
   * whatever that system sent — there may be no guest at all. Rather than invent
   * a placeholder id (which would make every guest-touching node write to the
   * wrong row), the fields are absent and `requireGuestContext` below refuses
   * the nodes that need them, by name.
   */
  eventId?: string;
  contactId?: string;
  /**
   * The inbox row this run started from.
   *
   * NOT the message content — a REFERENCE to it. `action.import_guest_list`
   * needs to reach the file or the contact cards, and the alternative was to
   * copy them into `trigger_payload`: a second permanent copy of a guest list,
   * with names and phones, in a jsonb column built for step context. The
   * reference costs one read at execution time and keeps the personal data in
   * the one row that already holds it.
   *
   * Absent for a run that did not start from an inbound message (a webhook).
   */
  inboxRowId?: string;
  /**
   * The arbitrary JSON an inbound webhook delivered, readable as
   * `{{trigger.body.<anything>}}`.
   *
   * NOT a fixed shape, deliberately: the point of a webhook trigger is that the
   * caller decides what it sends. Whatever arrives is what the templates can
   * name — no field list to maintain, and a new caller needs no code change.
   */
  body?: Record<string, unknown>;
  /**
   * The URL's query string on an inbound webhook call, as a flat object.
   *
   * Separate from `body` on purpose: GET and DELETE have no body, and merging
   * the two would make `{{trigger.body.x}}` mean different things on different
   * verbs. Absent for every trigger that is not a webhook.
   */
  query?: Record<string, string>;
  message_text: string;
  button_payload: string;
  /**
   * How many fan-outs deep this run is. Absent means zero — a run nobody fanned
   * out to.
   *
   * ⚠️ CARRIED ON THE PAYLOAD RATHER THAN IN A COLUMN, deliberately. The depth
   * is a property of THIS run's lineage and is read exactly once, by the fan-out
   * that might create the next generation; a column would need a migration, a
   * backfill answer for existing rows, and would still say nothing a payload
   * field does not. `workflow_runs` has no parent link at all — measured — so
   * this is also the only place the chain is recorded.
   */
  fanoutDepth?: number;
  /**
   * The three below are OMITTED when unknown, never set to `''`, and the
   * difference is the whole behaviour of the fallback modifiers.
   *
   * `resolveTemplate` fires `?` and `| default:'…'` only when the resolved value
   * is strictly `undefined` — `''`, `null` and `0` are real values, which the
   * vendor's own suite pins (resolve-template.test.ts, "the modifier only fires
   * for undefined"). So normalising an unknown name to `''` did not merely lose
   * the name: it silently defeated the owner's own fallback. Someone writing
   *
   *     שלום {{trigger.guest_name | default:'אורח יקר'}}
   *
   * got `שלום ` — a sentence with a hole — because the empty string resolved.
   * Absent, the same template reads `שלום אורח יקר`.
   *
   * A strict `{{trigger.guest_name}}` now throws when the name is unknown, which
   * is the documented contract and the loud half of the same choice.
   */
  /** First name of the single linked guest. Absent when there is not exactly one. */
  guest_name?: string;
  event_name?: string;
  /** dd.MM.yyyy in Israel time — display-ready, never re-parsed. */
  event_date?: string;
};

export type StepContext = {
  runId: string;
  /**
   * The workflow this run is executing — read ONLY by the fan-out, to refuse
   * starting itself. See `MAX_FANOUT_DEPTH`.
   */
  workflowId: string;
  nodeId: string;
  /**
   * This attempt took over a PARKED step whose deadline has passed.
   *
   * Only `logic.wait` reads it, and only it should: see the note in that
   * handler for why a wait cannot recognise its own resumption without being
   * told.
   */
  resumedFromWait?: boolean;
  trigger: WorkflowTriggerPayload;
  deps: {
    guests: GuestActionsPort;
    alerts: TeamAlertsPort;
    webhook: OutboundWebhookPort;
    integrations: IntegrationsPort;
    accounting: AccountingPort;
    /** One headless Claude run. See AiAgentPort. */
    ai: AiAgentPort;
  };
};

export type StepHandler = (
  config: Record<string, unknown>,
  ctx: StepContext,
) => Promise<NodeExecutionResult>;

// ---------------------------------------------------------------------------
// Config readers
// ---------------------------------------------------------------------------

// A node's config reached us through the editor and a jsonb column. The property
// SCHEMA constrains what the form can produce; it constrains nothing about what
// is in the row. These readers are the narrowing, and a bad value is a
// PermanentNodeExecutionError — it will fail identically on every retry, so the
// engine must not spend three attempts discovering that.
/**
 * The keys of a config type whose value is text — what `readString` may read.
 *
 * Two signatures: without a type argument the key is plain `string`, so every
 * existing caller (including ones passing a computed key) is unchanged. With one — `readString<SetValueConfig>(config, 'value')` — a key
 * the node's config does not declare, or declares as something other than text,
 * is a COMPILE error. The config itself stays `Record<string, unknown>`: it came
 * from a jsonb row nobody validated, and typing it as the node's config would
 * claim a check that never ran. Only the NAME of the field is checked.
 */
export type StringKeyOf<C> = {
  [K in keyof C]-?: NonNullable<C[K]> extends string ? K : never;
}[keyof C] &
  string;

export function readString(config: Record<string, unknown>, key: string): string;
export function readString<C>(config: Record<string, unknown>, key: StringKeyOf<C>): string;
export function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

export function readEnum<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  nodeType: KalfaNodeType,
): T {
  const value = config[key];
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new PermanentNodeExecutionError(
    'invalid_config',
    `הצעד "${nodeType}" הוגדר עם ערך לא חוקי בשדה "${key}".`,
  );
}

/**
 * The guest a step is about — or a refusal that names the step.
 *
 * Five handlers write to a guest, and all five need an event and a contact. A
 * webhook-triggered run may have neither. This is where that is caught: a
 * PERMANENT error, because no retry will add a guest to a run that never had
 * one, and the message says which step and why rather than surfacing as a
 * confusing null-id write.
 */
export function requireGuestContext(
  ctx: StepContext,
  nodeType: KalfaNodeType,
): { eventId: string; contactId: string } {
  const { eventId, contactId } = ctx.trigger;
  if (!eventId || !contactId) {
    throw new PermanentNodeExecutionError(
      'missing_guest_context',
      `הצעד "${nodeType}" פועל על אורח, וההרצה הזו לא התחילה מאורח. השתמשו בו רק בתהליך שמתחיל מהודעת וואטסאפ.`,
    );
  }
  return { eventId, contactId };
}
