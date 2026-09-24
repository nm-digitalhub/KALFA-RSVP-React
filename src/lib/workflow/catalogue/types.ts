// The KALFA node-type catalogue: what a step can be, what it may be configured
// with, and — rule 1 of the conversion contract — which types are allowed to
// begin a flow.
//
// This module is PURE DATA and imports nothing from the SDK — not even a type.
// Its only imports are a type from `@/lib/constants` and every node's SDK-free
// `nodes/<name>/definition.ts`, which import nothing themselves. It is read by
// the editor (browser) AND by the adapter and step handlers (pg-boss worker),
// and the worker must never load @workflowbuilder/sdk, whose import runs
// module-level side effects (immer.setAutoFreeze(false), i18next.init) and
// which is browser-only.
//
// Everything the EDITOR needs — property schemas, labels, icons — lives in each
// node folder's editor files instead, assembled into the palette by ./schemas.ts.
//
// Besides data and a few pure helpers, it holds two COMPILE-TIME drift guards
// (the `_…MatchesTheDefinition` / `_KALFA_NODE_CONFIG_COVERS_ALL_TYPES`
// constants). Each emits one inert constant and a `void` at run time and has no
// side effect.
import type { RsvpStatus } from '@/lib/constants';

import * as aiAgentDefinition from '../nodes/action-ai-agent/definition';
import * as callbackRequestDefinition from '../nodes/action-create-callback-request/definition';
import * as importGuestListDefinition from '../nodes/action-import-guest-list/definition';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import * as notifyTeamDefinition from '../nodes/action-notify-team/definition';
import * as sendTemplateDefinition from '../nodes/action-send-template/definition';
import * as sendWhatsappDefinition from '../nodes/action-send-whatsapp/definition';
import * as setGuestFieldDefinition from '../nodes/action-set-guest-field/definition';
import * as startForEachGuestDefinition from '../nodes/action-start-for-each-guest/definition';
import * as startRsvpAiCallbackDefinition from '../nodes/action-start-rsvp-ai-callback/definition';
import * as startVoiceCallDefinition from '../nodes/action-start-voice-call/definition';
import * as sumitCreateCustomerDefinition from '../nodes/action-sumit-create-customer/definition';
import * as sumitCreateDocumentDefinition from '../nodes/action-sumit-create-document/definition';
import * as updateGuestStatusDefinition from '../nodes/action-update-guest-status/definition';
import * as webhookDefinition from '../nodes/action-webhook/definition';
import * as conditionDefinition from '../nodes/logic-condition/definition';
import * as setValueDefinition from '../nodes/logic-set-value/definition';
import * as switchDefinition from '../nodes/logic-switch/definition';
import * as waitDefinition from '../nodes/logic-wait/definition';
import * as scheduleDefinition from '../nodes/trigger-schedule/definition';
import * as sumitCardTriggerDefinition from '../nodes/trigger-sumit-card/definition';
import * as webhookTriggerDefinition from '../nodes/trigger-webhook/definition';
import * as whatsappInboundDefinition from '../nodes/trigger-whatsapp-inbound/definition';

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

// Every node type, each read from its definition. Stored verbatim in the
// diagram's `data.type`, so these strings are a persistence contract: renaming
// one orphans every saved workflow that used it.
export const NODE_TYPES = [
  whatsappInboundDefinition.type,
  webhookTriggerDefinition.type,
  scheduleDefinition.type,
  sumitCardTriggerDefinition.type,
  conditionDefinition.type,
  switchDefinition.type,
  updateGuestStatusDefinition.type,
  sendWhatsappDefinition.type,
  microsoftSendEmailDefinition.type,
  startRsvpAiCallbackDefinition.type,
  notifyTeamDefinition.type,
  webhookDefinition.type,
  setGuestFieldDefinition.type,
  callbackRequestDefinition.type,
  importGuestListDefinition.type,
  waitDefinition.type,
  sendTemplateDefinition.type,
  startForEachGuestDefinition.type,
  startVoiceCallDefinition.type,
  setValueDefinition.type,
  sumitCreateDocumentDefinition.type,
  sumitCreateCustomerDefinition.type,
  aiAgentDefinition.type,
] as const;

export type KalfaNodeType = (typeof NODE_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type configuration, narrowed by `type`
// ---------------------------------------------------------------------------

// `trigger.whatsapp_inbound` — its config and the message-kind lists (the
// editor's menu, the default, the owner kinds and the text-bearing ones) are
// declared with the rest of its contract in
// `nodes/trigger-whatsapp-inbound/definition.ts`. Re-exported here for existing
// readers (`inbound.ts`, `arm-check.ts` and the admin data layer among them).
export {
  DEFAULT_WHATSAPP_MESSAGE_KINDS,
  OWNER_WHATSAPP_MESSAGE_KINDS,
  TEXT_BEARING_WHATSAPP_MESSAGE_KINDS,
  WHATSAPP_MESSAGE_KINDS,
} from '../nodes/trigger-whatsapp-inbound/definition';
export type WhatsappInboundConfig = whatsappInboundDefinition.WhatsappInboundConfig;

// `action.start_for_each_guest` — its config, the RSVP statuses it filters on,
// the hard cap and the fan-out depth cap are declared with the rest of its
// contract in `nodes/action-start-for-each-guest/definition.ts`. Re-exported here
// for existing readers (the port implementation in guest-actions.ts among them).
export {
  FAN_OUT_HARD_CAP,
  GUEST_FILTER_STATUSES,
  type GuestFilterStatus,
} from '../nodes/action-start-for-each-guest/definition';
export type ForEachGuestConfig = startForEachGuestDefinition.ForEachGuestConfig;

// `logic.wait` — its config and the units it offers are declared with the rest
// of its contract in `nodes/logic-wait/definition.ts`. The config type is
// re-exported here for existing readers.
export type WaitConfig = waitDefinition.WaitConfig;

// `action.import_guest_list` — declared with the rest of its contract in
// `nodes/action-import-guest-list/definition.ts`, re-exported here for
// existing readers.
export type ImportGuestListConfig = importGuestListDefinition.ImportGuestListConfig;

// `trigger.schedule` — declared with the rest of its contract in
// `nodes/trigger-schedule/definition.ts`, re-exported here for existing readers.
export type ScheduleTriggerConfig = scheduleDefinition.ScheduleTriggerConfig;

// `trigger.webhook` — the HTTP methods it may be called with and the verbs that
// carry a body are declared with the rest of its contract in
// `nodes/trigger-webhook/definition.ts`, re-exported here for existing readers
// (the public hook route among them). `webhookAllowsMethod` moved to that
// folder's `match.ts` and is read from there.
export {
  WEBHOOK_METHODS,
  WEBHOOK_METHODS_WITH_BODY,
  type WebhookMethod,
} from '../nodes/trigger-webhook/definition';

// WHERE an inbound call proves itself — `header` or `address`. The modes are
// declared, with the reason there are two, as `WEBHOOK_AUTH_MODES` in
// `nodes/trigger-webhook/definition.ts`, the node whose `auth` field they are.
// The type is derived from there; `readWebhookAuthMode` and `authModeFor` stay
// here because they answer for `trigger.sumit_card` too.
export type WebhookAuthMode = webhookTriggerDefinition.WebhookAuthMode;

/**
 * The mode a stored node is in.
 *
 * ⚠️ ABSENT IS `header`, AND THAT IS THE WHOLE COMPATIBILITY STORY. Every
 * webhook trigger saved before this field carries a public `endpointId` that has
 * been displayed and copied since the split — treating an absent value as
 * `address` would retroactively turn a published id into a credential.
 * Anything that is not one of the two known strings reads as `header` for the
 * same reason: a jsonb column can hold a number or a null, and the narrower
 * answer is the safe one here.
 */
export function readWebhookAuthMode(value: unknown): WebhookAuthMode {
  return value === 'address' ? 'address' : 'header';
}

// `trigger.webhook` — its config (whose `auth` field is a `WebhookAuthMode`) is
// declared with the rest of its contract in
// `nodes/trigger-webhook/definition.ts`, re-exported here for existing readers.
export type WebhookTriggerConfig = webhookTriggerDefinition.WebhookTriggerConfig;

// `trigger.sumit_card` — declared with the rest of its contract (and with its
// output fields) in `nodes/trigger-sumit-card/definition.ts`, re-exported here
// for existing readers.
export type SumitCardTriggerConfig = sumitCardTriggerDefinition.SumitCardTriggerConfig;

/**
 * The triggers an inbound HTTP call can start — both resolved by
 * `findWorkflowForEndpoint` behind the one public route.
 *
 * ONE ROUTE, NOT ONE PER CALLER. A second route would be a second place that
 * decides who gets in, and the whole security story of that endpoint is that
 * there is exactly one.
 */
export const INBOUND_HTTP_TRIGGER_TYPES: readonly KalfaNodeType[] = [
  webhookTriggerDefinition.type,
  sumitCardTriggerDefinition.type,
];

/**
 * How an inbound call to THIS node proves itself.
 *
 * ⚠️ THE TYPE OUTRANKS THE ROW. `trigger.sumit_card` is `address` whatever its
 * properties say — a hand-edited diagram carrying `auth: 'header'` must not
 * turn a SUMIT trigger into one that waits for a header SUMIT cannot send, nor
 * into one that accepts a stored public id as its credential. Only
 * `trigger.webhook` consults its own `auth` field.
 *
 * One function, three callers — the lookup, the token control and arm-check —
 * so the question cannot be answered differently in two of them.
 */
export function authModeFor(nodeType: string, properties: Record<string, unknown>): WebhookAuthMode {
  if (nodeType === sumitCardTriggerDefinition.type) return 'address';
  return readWebhookAuthMode(properties.auth);
}

// `logic.condition` — its config, trigger fields, operators and the two branch
// handles are declared with the rest of its contract in
// `nodes/logic-condition/definition.ts`. The handles and the config type are
// re-exported here for existing readers.
export { CONDITION_BRANCH_HANDLES, type ConditionBranchHandle } from '../nodes/logic-condition/definition';
export type ConditionConfig = conditionDefinition.ConditionConfig;

// `logic.switch` — its config, branch and condition shapes, the SDK's operators
// and the default handle are declared with the rest of its contract in
// `nodes/logic-switch/definition.ts`. Re-exported here for existing readers.
export {
  SWITCH_COMPARISON_OPERATORS,
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
  SWITCH_LOGICAL_OPERATORS,
  switchBranchHandle,
  type SwitchBranch,
  type SwitchComparisonOperator,
  type SwitchCondition,
  type SwitchLogicalOperator,
} from '../nodes/logic-switch/definition';
export type SwitchConfig = switchDefinition.SwitchConfig;

// Per-STEP on/off, distinct from the workflow-level `is_active` switch.
//
// Every built-in node in the vendor's own library carries this field, and the
// SDK exports the canonical option set as `statusOptions` — `active` / `draft`
// / `disabled`, each with its own status icon. The values here are theirs; the
// MEANING below is ours, because the SDK stores the field and never reads it:
// `BaseNode` in the vendored runner has no status at all.
//
//   active    runs.
//   draft     half-built. BLOCKS ARMING, with the step named — a step nobody
//             finished must not fire on a live guest, and discovering that
//             after the fact is the expensive way to learn it.
//   disabled  deliberately off. The run reaches it, records a skipped step,
//             and CONTINUES to its successors. That is what makes it different
//             from deleting the node: the wiring survives, so switching it back
//             on is one click rather than a redraw.
//
// Offered on ACTION nodes only. On a condition, "skip and continue" has no
// honest answer — the node's whole job is to pick a port, and skipping it
// would either fire every branch or dead-end the run. Same reason
// `errorPolicy` is action-only.
export const NODE_STATUSES = ['active', 'draft', 'disabled'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

// What the runner does when a step throws.
//
// All THREE values the vendored runner accepts. Two of them used to be exposed,
// and the comment here argued that the third could not work: "'errorRoute' tells
// the runner to fire only outgoing edges whose sourceHandle is the reserved
// literal 'errorRoute'. Nothing in this editor can draw such an edge."
//
// The premise was right and the conclusion was wrong. Nothing in the editor
// MINTS that literal — `getHandleId` always produces `source:inner:<id>` — but
// nothing has to. The adapter already rewrites the diagram into the runner's
// vocabulary, so it rewrites this too: an edge drawn from the action node's
// error branch leaves the editor as `source:inner:error` and enters the
// definition as `errorRoute`. See `ACTION_BRANCH_HANDLES` below.
//
// The mechanism that makes the branch drawable is the one already proven on
// `logic.condition`: `templateType: NodeType.DecisionNode` plus a
// `decisionBranches` array renders one labelled handle per entry.
//
// 'errorRoute' tells the runner to fire only outgoing edges whose
// `sourceHandle` is the reserved literal 'errorRoute'. Nothing in this editor
// can draw such an edge: `errorRoute` appears in the SDK bundle exactly twice,
// both times inside that schema fragment's option list and its English label
// map, and NOWHERE in any node template's handle rendering (verified against
// dist/index-CEBfv0NZ.js at 2.3.0). So a node set to 'errorRoute' names a port
// no edge can carry, and `isEdgeLive` prunes every branch — which is the
// definition of a dead end, so the run ends `execution_incomplete`. Offering it
// would be offering a setting whose only outcome is a broken run.
//
// The two we do expose keep the SDK's own value spelling, because that string
// is what the runner compares against.
export const ERROR_POLICIES = ['fail', 'continue', 'errorRoute'] as const;
export type ErrorPolicy = (typeof ERROR_POLICIES)[number];

/**
 * The port the vendored runner reserves for error routing.
 *
 * `RESERVED_ERROR_HANDLE` in graph-runner.ts, a bare literal rather than a
 * handle id. An edge must carry EXACTLY this string as its `sourceHandle` to
 * fire when a node error-routes; `isEdgeLive` tests it before anything else.
 */
export const RUNNER_ERROR_PORT = 'errorRoute';

/**
 * The two outgoing handles an ACTION node draws, as the editor spells them.
 *
 * Why a translation exists at all: the runner wants the bare literal
 * `'errorRoute'`, and the editor mints every handle through `getHandleId`, which
 * produces `source:inner:<id>`. The two vocabularies cannot meet without one
 * side moving, so the ADAPTER moves — it rewrites `source:inner:error` to
 * `RUNNER_ERROR_PORT` on the way into a definition. That keeps the whole
 * translation in the one module whose job is translation, and means nothing
 * depends on how the SDK happens to mint a handle today.
 *
 * `ok` is a named branch rather than the bare 'source' for a reason that only
 * shows up when the node fails: with the error edge present, the success edge
 * needs its own handle so the two can be told apart on the canvas. Diagrams
 * saved before this carry the bare 'source' and keep firing, because
 * `isEdgeLive` treats an unset `nextPort` as "every non-error edge is live".
 */
export const ACTION_BRANCH_HANDLES = {
  ok: 'source:inner:ok',
  error: 'source:inner:error',
} as const;

// `action.update_guest_status` — declared with the rest of its contract in
// `nodes/action-update-guest-status/definition.ts`, re-exported here for
// existing readers.
export type UpdateGuestStatusConfig = updateGuestStatusDefinition.UpdateGuestStatusConfig;

/**
 * ⚠️ A COMPILE ERROR IF THE DEFINITION'S RSVP STATUSES DRIFT FROM `RsvpStatus`.
 * The definition imports nothing, so it spells the union out; assigning across
 * it in both directions fails the moment the two lists disagree.
 */
type _DefinitionRsvpStatus = UpdateGuestStatusConfig['rsvpStatus'];
const _rsvpStatusMatchesTheDefinition: [_DefinitionRsvpStatus, RsvpStatus] = [
  null as unknown as RsvpStatus,
  null as unknown as _DefinitionRsvpStatus,
];
void _rsvpStatusMatchesTheDefinition;

// `action.send_whatsapp` — declared with the rest of its contract in
// `nodes/action-send-whatsapp/definition.ts`, re-exported here for existing
// readers.
export type SendWhatsappConfig = sendWhatsappDefinition.SendWhatsappConfig;

// `action.send_template` — its config and the message keys it offers are
// declared with the rest of its contract in
// `nodes/action-send-template/definition.ts`. The config type is re-exported
// here for existing readers.
export type SendTemplateConfig = sendTemplateDefinition.SendTemplateConfig;

// `action.microsoft_send_email` — its config, and the content-type and importance
// values only it reads, are declared with the rest of its contract in
// `nodes/action-microsoft-send-email/definition.ts`, re-exported here for
// existing readers.
export type MicrosoftSendEmailConfig = microsoftSendEmailDefinition.MicrosoftSendEmailConfig;

// `action.start_rsvp_ai_callback` — declared with the rest of its contract in
// `nodes/action-start-rsvp-ai-callback/definition.ts`, re-exported here for
// existing readers.
export type StartRsvpAiCallbackConfig = startRsvpAiCallbackDefinition.StartRsvpAiCallbackConfig;

// `action.start_voice_call` — declared with the rest of its contract in
// `nodes/action-start-voice-call/definition.ts`, re-exported here for existing
// readers.
export type StartVoiceCallConfig = startVoiceCallDefinition.StartVoiceCallConfig;

// `action.notify_team` — its config and alert levels are declared with the rest
// of its contract in `nodes/action-notify-team/definition.ts`. Re-exported here
// for existing readers (the `TeamAlertsPort` in engine/ports.ts among them).
export { NOTIFY_LEVELS, type NotifyLevel } from '../nodes/action-notify-team/definition';
export type NotifyTeamConfig = notifyTeamDefinition.NotifyTeamConfig;

// `action.webhook` — its config, HTTP methods, default method, with-body verbs
// and header-row shape are declared with the rest of its contract in
// `nodes/action-webhook/definition.ts`. Re-exported here for existing readers
// (`outbound-webhook.ts` and the `OutboundWebhookPort` in engine/ports.ts among
// them). The two limits below stay here: only the port implementation reads them.
export {
  DEFAULT_HTTP_METHOD,
  HTTP_METHODS,
  HTTP_METHODS_WITH_BODY,
  type HttpHeader,
  type HttpMethod,
} from '../nodes/action-webhook/definition';
export type WebhookConfig = webhookDefinition.WebhookConfig;

/**
 * Headers the node refuses to let an owner set, lower-cased.
 *
 * Not paranoia — each one would break a guarantee made elsewhere in this file:
 * `host` defeats the URL check by addressing a different vhost than the one
 * validated; `content-length` and the `transfer-encoding` family are how request
 * smuggling is spelled; and `x-kalfa-idempotency-key` is the receiver's only
 * defence against the replay a step lease can cause, so it must stay ours.
 */
export const FORBIDDEN_HTTP_HEADERS = [
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'expect',
  'x-kalfa-idempotency-key',
] as const;

/** How much of a captured response is kept. Beyond this it is truncated, not failed. */
export const MAX_CAPTURED_RESPONSE_BYTES = 8 * 1024;

/**
 * `{{secrets.<NAME>}}` — the ONE namespace that is not resolved with the others.
 *
 * A name is word characters and dashes, ANY CASE. It was upper-snake only until
 * 2026-09-13, which refused `{{secrets.acme_key}}` for no reason anyone could
 * defend: the security property is the `KALFA_WORKFLOW_SECRET_` prefix on the
 * environment lookup, not the shape of what follows it. A case rule bought
 * nothing and cost a support question.
 *
 * The characters are still constrained, and that part IS load-bearing: the name
 * is concatenated into an environment key, so `.` and `/` must never appear.
 *
 * Deliberately NOT built from the generic template grammar: this pattern is the
 * whole allow-list. A reference that does not match it is not a secret, is never
 * looked up, and is left in place — where the outbound port refuses to send it.
 */
export const SECRET_REFERENCE_REGEX = /\{\{\s*secrets\.([A-Za-z0-9_-]+)\s*\}\}/g;
export const SECRET_NAME_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The node types whose fields may carry `{{secrets.…}}`.
 *
 * SCOPED BY NODE, NOT BY FIELD — and the first version got this wrong.
 *
 * It allowed secrets only under a field literally named `headers`, on the
 * reasoning that headers are where credentials go. They are not the only place:
 * a Slack incoming webhook is a URL that is ENTIRELY a secret, and plenty of
 * APIs want the key in the JSON body or a query string. Restricting by field
 * name refused all of that for no gain.
 *
 * The honest boundary is the NODE: `action.webhook` is the only step whose port
 * knows how to substitute a secret before the socket, so it is the only step
 * where the reference means anything. Everywhere else — above all in a WhatsApp
 * body, which is delivered to a guest — an unresolved `{{secrets.…}}` still
 * throws, loudly, on the first run.
 */
export const SECRET_BEARING_NODE_TYPES: readonly string[] = [webhookDefinition.type];

// `action.ai_agent` — its config, the model aliases and the turn bounds are
// declared with the rest of its contract in `nodes/action-ai-agent/definition.ts`.
// The config type is re-exported here for existing readers.
export type AiAgentConfig = aiAgentDefinition.AiAgentConfig;

// `action.set_guest_field` — its config and the guest fields it may write are
// declared with the rest of its contract in `nodes/action-set-guest-field/definition.ts`.
// Re-exported here for existing readers (the `GuestActionsPort` in
// engine/ports.ts among them).
export { GUEST_FIELDS, type GuestField } from '../nodes/action-set-guest-field/definition';
export type SetGuestFieldConfig = setGuestFieldDefinition.SetGuestFieldConfig;

// `action.create_callback_request` — its config, the closed topic list and the
// sales topic it refuses are declared with the rest of its contract in
// `nodes/action-create-callback-request/definition.ts`. Re-exported here for
// existing readers (`arm-check.ts` and the export check among them).
export {
  CALLBACK_TOPICS,
  SALES_CALLBACK_TOPIC,
  type CallbackTopic,
} from '../nodes/action-create-callback-request/definition';
export type CreateCallbackRequestConfig = callbackRequestDefinition.CreateCallbackRequestConfig;

// `logic.set_value` — declared with the rest of its contract in
// `nodes/logic-set-value/definition.ts`, re-exported here for existing readers.
export type SetValueConfig = setValueDefinition.SetValueConfig;

// `action.sumit_create_document` — declared with the rest of its contract (and
// with `SUMIT_DOCUMENT_TYPES`, which only it reads) in
// `nodes/action-sumit-create-document/definition.ts`, re-exported here for
// existing readers.
export type SumitCreateDocumentConfig = sumitCreateDocumentDefinition.SumitCreateDocumentConfig;

// `action.sumit_create_customer` — declared with the rest of its contract in
// `nodes/action-sumit-create-customer/definition.ts`, re-exported here for
// existing readers.
export type SumitCreateCustomerConfig = sumitCreateCustomerDefinition.SumitCreateCustomerConfig;

// The discriminated union the step handlers narrow on. `BaseNode.config` in the
// vendored runner is `unknown`; this is the vocabulary we give it.
export type KalfaNodeConfig =
  | { type: typeof whatsappInboundDefinition.type; config: WhatsappInboundConfig }
  | { type: typeof webhookTriggerDefinition.type; config: WebhookTriggerConfig }
  | { type: typeof aiAgentDefinition.type; config: AiAgentConfig }
  | { type: typeof scheduleDefinition.type; config: ScheduleTriggerConfig }
  | { type: typeof sumitCardTriggerDefinition.type; config: SumitCardTriggerConfig }
  | { type: typeof conditionDefinition.type; config: ConditionConfig }
  | { type: typeof switchDefinition.type; config: SwitchConfig }
  | { type: typeof updateGuestStatusDefinition.type; config: UpdateGuestStatusConfig }
  | { type: typeof sendWhatsappDefinition.type; config: SendWhatsappConfig }
  | { type: typeof microsoftSendEmailDefinition.type; config: MicrosoftSendEmailConfig }
  | { type: typeof startRsvpAiCallbackDefinition.type; config: StartRsvpAiCallbackConfig }
  | { type: typeof startVoiceCallDefinition.type; config: StartVoiceCallConfig }
  | { type: typeof notifyTeamDefinition.type; config: NotifyTeamConfig }
  | { type: typeof webhookDefinition.type; config: WebhookConfig }
  | { type: typeof setGuestFieldDefinition.type; config: SetGuestFieldConfig }
  | { type: typeof callbackRequestDefinition.type; config: CreateCallbackRequestConfig }
  | { type: typeof importGuestListDefinition.type; config: ImportGuestListConfig }
  | { type: typeof waitDefinition.type; config: WaitConfig }
  | { type: typeof sendTemplateDefinition.type; config: SendTemplateConfig }
  | { type: typeof startForEachGuestDefinition.type; config: ForEachGuestConfig }
  | { type: typeof setValueDefinition.type; config: SetValueConfig }
  | { type: typeof sumitCreateDocumentDefinition.type; config: SumitCreateDocumentConfig }
  | { type: typeof sumitCreateCustomerDefinition.type; config: SumitCreateCustomerConfig };

/**
 * ⚠️ A COMPILE ERROR IF `KalfaNodeConfig` MISSES A TYPE. `action.start_voice_call`
 * was absent for its whole life and no check saw it. This resolves to `true`
 * only when every `KalfaNodeType` has a member; otherwise the assignment below
 * fails to type-check and names nothing, which is enough.
 */
type _MissingFromKalfaNodeConfig = Exclude<KalfaNodeType, KalfaNodeConfig['type']>;
const _KALFA_NODE_CONFIG_COVERS_ALL_TYPES: [_MissingFromKalfaNodeConfig] extends [never] ? true : never = true;
void _KALFA_NODE_CONFIG_COVERS_ALL_TYPES;

// ---------------------------------------------------------------------------
// A catalogue entry — METADATA ONLY
// ---------------------------------------------------------------------------

// What the ADAPTER and the STEP HANDLERS need to know about a node type, and
// nothing more. Property schemas, labels and icons are the editor's concern and
// live in each node folder's editor files (`nodes/<name>/schema.ts`,
// `uischema.ts` and the palette item), which import @workflowbuilder/sdk at run
// time and are therefore client-only; ./schemas.ts assembles them into the
// palette.
//
// The split is not tidiness. `sharedProperties` and `getScope` — the two SDK
// exports a correct schema is built from — are runtime VALUES, not types. Had
// the schemas stayed here, the pg-boss worker would load the SDK, and with it
// the module-level `immer.setAutoFreeze(false)` and `i18next.init`.
export type CatalogueEntry = {
  type: KalfaNodeType;
  /**
   * RULE 1. The catalogue decides who may begin a flow — not the SDK, not the
   * stored JSON. `isStartNode` does not exist in @workflowbuilder/sdk@2.3.0, so
   * the editor can neither write nor preserve such a marker; this flag is the
   * only source of truth, and the adapter is its only reader.
   *
   * That first sentence stays true after the SDK gains the marker, and the
   * distinction is the point. An unreleased upstream changeset
   * (.changeset/sdk-is-start-node-flag.md) adds `isStartNode?: boolean` to
   * `NodeDefinition`, which the editor then copies into the node's `data` —
   * and invites integrations to "read `data.isStartNode`". We will not.
   * `data` is browser-authored and arrives through a jsonb column; reading a
   * start marker out of it is exactly what rule 3 forbids. Declaring the flag
   * on our palette items once it exists is fine and even useful (it drives
   * their visuals), but the adapter keeps asking `isTriggerType`.
   */
  isTrigger: boolean;
};

/**
 * Property keys that were RENAMED, and the older key still found in saved diagrams.
 *
 * ⚠️ WHY THIS EXISTS AS DATA RATHER THAN AN `if` INSIDE ONE HANDLER. `rsvpStatus`
 * was called `status` until the SDK claimed `status` for the node's own lifecycle
 * (Active / Draft / Disabled) in the same properties object. Every diagram saved
 * before that carries the old key and must keep working untouched.
 *
 * The handler honoured that from the start. The ARM CHECK did not, and the first
 * time it ran against the real database it refused to arm a stored workflow that
 * runs perfectly — a rule stricter than the code it was meant to describe.
 *
 * Both read this map now, so "which old names still count" is answered once.
 */
export const LEGACY_PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  rsvpStatus: 'status',
};

/**
 * How a stored property's value relates to the installation it was saved in.
 *
 * Absent means PORTABLE, which is the common case and therefore the default: a
 * label, a delay, a condition operator mean the same thing anywhere.
 */
export type DeploymentBinding =
  /**
   * A pointer to a row or resource in THIS installation — a connection uuid,
   * another workflow, a provider-side numbering id, an agent. It cannot resolve
   * elsewhere, and several of these are also somebody's phone number.
   */
  | 'identifier'
  /**
   * Operator-typed material that may be a credential. Distinct from
   * `identifier` because the remedy differs — one is re-selected from a list,
   * the other has to be re-entered from somewhere only the operator has.
   */
  | 'secret'
  /**
   * A key into a catalogue. Survives only where the same key exists, decided
   * PER VALUE rather than per field, because the catalogues differ in kind.
   */
  | 'catalogue';

/**
 * Per node type, the properties that do NOT simply travel with the diagram.
 *
 * ⚠️ DERIVED FROM THE CATALOGUE, NOT FROM SAVED DATA. A first pass built from
 * the 21 nodes present in this installation's saved workflows missed the
 * webhook trigger's credential field (then `token`, since split into
 * `endpointId` and `tokenHash`) and `action.start_for_each_guest.targetWorkflowId`
 * outright — neither node type had ever been used here. The classification was
 * read from the node property schemas (then all in `schemas.ts`, now each in
 * its `nodes/<name>/schema.ts`), which is the list of what a node CAN hold
 * rather than what one happens to.
 *
 * Each node declares its own bindings in its folder's `definition.ts`, together
 * with the reason for each one, checked at its use site rather than from its
 * name; this map only reads them.
 *
 * Fail-closed: `portability.test.ts` refuses a property that neither appears
 * here nor in its allow-list of reviewed portable names, so a new node cannot
 * ship unclassified.
 */
export const NODE_DEPLOYMENT_BINDINGS: Partial<
  Record<KalfaNodeType, Record<string, DeploymentBinding>>
> = {
  // Every node declares its own — even `{}` — in its definition, together with
  // the reason for each binding.
  [setValueDefinition.type]: setValueDefinition.deploymentBindings,
  [conditionDefinition.type]: conditionDefinition.deploymentBindings,
  [switchDefinition.type]: switchDefinition.deploymentBindings,
  [notifyTeamDefinition.type]: notifyTeamDefinition.deploymentBindings,
  [setGuestFieldDefinition.type]: setGuestFieldDefinition.deploymentBindings,
  [updateGuestStatusDefinition.type]: updateGuestStatusDefinition.deploymentBindings,
  [sendWhatsappDefinition.type]: sendWhatsappDefinition.deploymentBindings,
  [startRsvpAiCallbackDefinition.type]: startRsvpAiCallbackDefinition.deploymentBindings,
  [importGuestListDefinition.type]: importGuestListDefinition.deploymentBindings,
  [waitDefinition.type]: waitDefinition.deploymentBindings,
  [scheduleDefinition.type]: scheduleDefinition.deploymentBindings,
  [whatsappInboundDefinition.type]: whatsappInboundDefinition.deploymentBindings,
  [webhookTriggerDefinition.type]: webhookTriggerDefinition.deploymentBindings,
  [sumitCardTriggerDefinition.type]: sumitCardTriggerDefinition.deploymentBindings,
  [microsoftSendEmailDefinition.type]: microsoftSendEmailDefinition.deploymentBindings,
  [sendTemplateDefinition.type]: sendTemplateDefinition.deploymentBindings,
  [callbackRequestDefinition.type]: callbackRequestDefinition.deploymentBindings,
  [startForEachGuestDefinition.type]: startForEachGuestDefinition.deploymentBindings,
  [webhookDefinition.type]: webhookDefinition.deploymentBindings,
  [aiAgentDefinition.type]: aiAgentDefinition.deploymentBindings,
  [sumitCreateDocumentDefinition.type]: sumitCreateDocumentDefinition.deploymentBindings,
  [sumitCreateCustomerDefinition.type]: sumitCreateCustomerDefinition.deploymentBindings,
  [startVoiceCallDefinition.type]: startVoiceCallDefinition.deploymentBindings,
};

/**
 * Which properties each node type cannot run without.
 *
 * ⚠️ THIS LIVES HERE, NOT IN `schemas.ts`, AND THE REASON IS A PRODUCTION OUTAGE.
 *
 * `schemas.ts` loads runtime values from `@workflowbuilder/sdk` (through the node
 * palette files it imports) and is reached from a `'use client'` editor, so
 * Next puts it in the CLIENT module graph. A server module that imports it does
 * NOT get the values — it gets a client reference stub, and `PALETTE_ITEMS.find`
 * is then a function that throws.
 * Measured on 2026-09-14 in `.next/server/chunks`:
 *
 *     registerClientReference(function(){ throw Error("Attempted to call
 *       PALETTE_ITEMS() from the server but PALETTE_ITEMS is on the client…") })
 *
 * The arm-time check runs on the server and needs exactly this data, so the data
 * moved to the module BOTH graphs can hold. `types.ts` imports nothing from the
 * SDK — the same rule `nodes.ts` states for the worker.
 *
 * Each node's editor schema (`nodes/<name>/schema.ts`) reads its definition's
 * `requiredFields` — the same array listed here — instead of declaring its own
 * copy, so the editor form and the arming gate cannot drift apart: a field
 * required in one is required in the other, by construction rather than by
 * discipline.
 */
export const NODE_REQUIRED_FIELDS: Record<KalfaNodeType, string[]> = {
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [whatsappInboundDefinition.type]: whatsappInboundDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [webhookTriggerDefinition.type]: webhookTriggerDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [aiAgentDefinition.type]: aiAgentDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [scheduleDefinition.type]: scheduleDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sumitCardTriggerDefinition.type]: sumitCardTriggerDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [conditionDefinition.type]: conditionDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [switchDefinition.type]: switchDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [waitDefinition.type]: waitDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [setValueDefinition.type]: setValueDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [updateGuestStatusDefinition.type]: updateGuestStatusDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sendWhatsappDefinition.type]: sendWhatsappDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [microsoftSendEmailDefinition.type]: microsoftSendEmailDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sendTemplateDefinition.type]: sendTemplateDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [startRsvpAiCallbackDefinition.type]: startRsvpAiCallbackDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [notifyTeamDefinition.type]: notifyTeamDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [webhookDefinition.type]: webhookDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [setGuestFieldDefinition.type]: setGuestFieldDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [callbackRequestDefinition.type]: callbackRequestDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [importGuestListDefinition.type]: importGuestListDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [startForEachGuestDefinition.type]: startForEachGuestDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [startVoiceCallDefinition.type]: startVoiceCallDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sumitCreateDocumentDefinition.type]: sumitCreateDocumentDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sumitCreateCustomerDefinition.type]: sumitCreateCustomerDefinition.requiredFields,
};

/**
 * The `instancePath` an arm refusal carries when it belongs to the NODE rather
 * than to one of its fields — and the `scope` of the control that displays it.
 *
 * ⚠️ IT LIVES HERE, NOT IN `schemas.ts`, FOR THE REASON THAT FILE'S HEADER
 * GIVES: `arm-check.ts` runs on the SERVER and `schemas.ts` pulls runtime values
 * out of `@workflowbuilder/sdk`, so a server import of it yields a client
 * reference rather than the value. `types.ts` imports nothing from the SDK, so
 * both halves can name the same constant.
 *
 * ⚠️ AND THE TWO HALVES MUST AGREE EXACTLY. JsonForms routes an external error
 * to a control by STRING-COMPARING this against the control's scope suffix; a
 * mismatch is not an error anywhere, it simply renders nothing — which is the
 * failure the `armNotice` control was added to close. One constant, both ends.
 */
export const ARM_NOTICE_PATH = '/armNotice';

/**
 * The node types that refuse to run outside a run about a GUEST.
 *
 * ⚠️ THIS LIST IS NOT A NEW RULE — it is the existing one, written down. Every
 * type here calls `requireGuestContext` in its handler and throws
 * `missing_guest_context` without an event AND a contact. What was missing is
 * that nothing said so before the run: a workflow of `לפי שעון → שליחת וואטסאפ`
 * armed cleanly and failed on its first fire, and the only warning was a
 * sentence of prose in the trigger's own panel.
 *
 * ⚠️ AND IT IS A CROSS-NODE INVARIANT, which is why it lives at arming and not
 * in a schema. JSON Schema validates ONE node's properties; a JsonForms rule
 * reads ONE node's data. "This action needs the node at the other end of the
 * graph to be a particular kind of trigger" is expressible in neither.
 *
 * `guest-context.test.ts` pins this list against the `requireGuestContext` call
 * sites in `steps/` and in every node folder's runtime, so a node that gains the
 * guard and is not added here fails a test rather than shipping an automation
 * that cannot run.
 */
export const GUEST_SCOPED_NODE_TYPES: readonly KalfaNodeType[] = [
  updateGuestStatusDefinition.type,
  sendWhatsappDefinition.type,
  sendTemplateDefinition.type,
  setGuestFieldDefinition.type,
  callbackRequestDefinition.type,
  startVoiceCallDefinition.type,
  startRsvpAiCallbackDefinition.type,
];

/**
 * Can a run started by THIS trigger carry a guest?
 *
 * Measured against `inbound.ts`, which is the only place the answer is decided:
 * a message whose kind is in `OWNER_WHATSAPP_MESSAGE_KINDS` resolves through
 * `resolveOwnerSender` and carries an event with NO contact; everything else
 * goes through `resolveGuestSender` and carries both.
 *
 *   `trigger.whatsapp_inbound`  yes — unless its kinds are ALL owner kinds
 *   `trigger.webhook`           no  — the caller is a system, not a guest
 *   `trigger.schedule`          no  — a clock is not a guest
 *   `trigger.sumit_card`        no  — SUMIT is a system, not a guest
 *
 * ⚠️ ABSENT OR EMPTY `messageKinds` IS YES, because absent means
 * `DEFAULT_WHATSAPP_MESSAGE_KINDS` — four kinds that are all a guest speaking.
 * Every diagram saved before that field existed is therefore unaffected.
 *
 * Both persisted shapes are accepted (`'document'` and `{ value: 'document' }`),
 * the same tolerance `matchesKind` has, because the checkbox control stores
 * objects and older saves stored strings.
 */
export function triggerSuppliesGuestContext(
  triggerType: string,
  properties: Record<string, unknown>,
): boolean {
  if (triggerType !== whatsappInboundDefinition.type) return false;

  const kinds = properties.messageKinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return true;

  return kinds.some((entry) => {
    const value =
      typeof entry === 'string'
        ? entry
        : (entry as { value?: unknown } | null)?.value;
    return (
      typeof value === 'string' &&
      !whatsappInboundDefinition.OWNER_WHATSAPP_MESSAGE_KINDS.includes(value)
    );
  });
}

/**
 * A field that is required only when ANOTHER field holds one of a set of values.
 *
 * ⚠️ WHY THIS EXISTS AT ALL, AND WHY IT IS NOT JUST THE SCHEMA. The contract is
 * real — a webhook body is meaningless on GET or DELETE and mandatory on the
 * three verbs that send one — and `NODE_REQUIRED_FIELDS` is FLAT: it lists field
 * names, with no way to say "this one, but only when that one is POST".
 *
 * JSON Schema expresses it with `allOf` + `if`/`then`, and the editor schema
 * emits exactly that (`conditionalRules` in editor-shared.ts) — `then`
 * carrying BOTH `required: [field]` and a `minLength` on it, so the schema
 * alone refuses an absent body and a blank one alike.
 *
 * ⚠️ AN EARLIER VERSION OF THIS COMMENT CLAIMED THE SCHEMA COULD NOT DO THAT,
 * on the grounds that the SDK's `ConditionalSchema` is typed as
 * `{ properties: Record<string, FieldValidationSchema> }` with no root
 * `required` slot. The type really is that narrow — and it does not matter.
 * TypeScript checks excess properties only on a FRESH LITERAL at the assignment
 * site; `conditionalRules()` is a function, so its return is compared
 * structurally, and an object carrying `required` ALONGSIDE `properties` is
 * assignable to one requiring only `properties`. It compiles with no cast, and
 * `@cfworker/json-schema` — the validator the SDK bundles — honours `required`
 * there, which `conditional-required.test.ts` proves against the real schema.
 *
 * `arm-check.ts` reads the SAME declaration and applies it again. Not because
 * the schema is insufficient, but because the schema runs in the EDITOR: a
 * definition written by an import, an API call or a direct row edit never meets
 * it. Arming is the layer nothing bypasses.
 *
 * ⚠️ AND THE `if` USES `const`, ONE ENTRY PER VALUE, BECAUSE THAT IS THE WHOLE
 * TYPED SUBSET. `SchemaCondition` is `{ properties: Record<string, { const?:
 * string | number | boolean }> }` — no `enum`. `allOf` is an array, so N values
 * become N entries with the same `then`, which `conditionalRules` builds by
 * mapping over `whenIn` rather than by hand.
 */
export type ConditionalRequirement = {
  /** The field whose value decides. */
  readonly decidedBy: string;
  /** The deciding values that make `require` mandatory. */
  readonly whenIn: readonly string[];
  /**
   * What the runtime uses when `decidedBy` is ABSENT.
   *
   * ⚠️ IT MUST BE A MEMBER OF `whenIn` OR THE TWO GATES CONTRADICT EACH OTHER,
   * and `palette-defaults.test.ts` asserts that. The reason is a JSON Schema
   * subtlety: `if: { properties: { method: { const: 'POST' } } }` MATCHES an
   * object with no `method` at all, because `properties` does not constrain
   * absent keys — so every branch fires at once on a legacy diagram. That is
   * harmless while all branches share one `then`, which is exactly what
   * "the fallback is inside the set" guarantees.
   */
  readonly fallback: string;
  /** The field that becomes required. */
  readonly require: string;
  /** What to tell the owner at arming. Names the fix, not the field. */
  readonly message: string;
};

/**
 * The conditional contracts, by node type.
 *
 * ⚠️ FEW ENTRIES, AND THAT IS DELIBERATE. All 24 handler refusals were read
 * before this existed and not one of them is of the form "field X is required
 * because field Y is Z" — so this is not a mechanism looking for a use. It is
 * here because `sendOutboundWebhook` genuinely branches on the verb: it builds,
 * resolves and secret-checks the body and then, for GET and DELETE, does not
 * send it. The panel offered a three-row editor for a field that went nowhere.
 *
 * TWO ENTRIES TODAY: that `action.webhook` body rule, and `trigger.webhook`'s
 * `endpointId`, which exists only in `header` auth mode. Only `action.webhook`'s
 * editor schema turns its rule into an `allOf`; both are enforced at arming.
 */
export const NODE_CONDITIONAL_REQUIRED_FIELDS: Partial<
  Record<KalfaNodeType, readonly ConditionalRequirement[]>
> = {
  // Declared with the rest of the node's contract — the SAME array, read here.
  [webhookDefinition.type]: webhookDefinition.conditionalRequirements,
  [webhookTriggerDefinition.type]: webhookTriggerDefinition.conditionalRequirements,
};

/**
 * The requirements that apply to a node RIGHT NOW, given its own properties.
 *
 * Read by `arm-check.ts`. Shared here rather than spelled there so the fallback
 * rule — an absent decider behaves as `fallback` — is stated once and cannot be
 * implemented differently in the two gates.
 */
export function activeConditionalRequirements(
  nodeType: string,
  properties: Record<string, unknown>,
): readonly ConditionalRequirement[] {
  const declared = NODE_CONDITIONAL_REQUIRED_FIELDS[nodeType as KalfaNodeType] ?? [];

  return declared.filter((rule) => {
    const raw = properties[rule.decidedBy];
    // Anything that is not a usable string behaves as absent, the same choice
    // `readMethod` makes: a jsonb column can hold a number or a null, and
    // refusing to decide would be stricter than the code that runs.
    const value = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : rule.fallback;
    return rule.whenIn.includes(value);
  });
}

/**
 * Numeric bounds, for the same reason and read by the same two places.
 *
 * Only the fields that HAVE a bound appear. `maxGuests` is the one that matters:
 * a cap of zero reaches nobody and a cap above the hard cap is clamped anyway,
 * so the form, the arming gate and the handler all say the same thing.
 */
export const NODE_NUMBER_RANGES: Partial<
  Record<KalfaNodeType, Record<string, { minimum?: number; maximum?: number }>>
> = {
  // Declared with the rest of the node's contract — the SAME object, read here.
  [waitDefinition.type]: waitDefinition.numberRanges,
  [startForEachGuestDefinition.type]: startForEachGuestDefinition.numberRanges,
};
