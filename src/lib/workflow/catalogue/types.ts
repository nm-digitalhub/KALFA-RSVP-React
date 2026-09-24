// The KALFA node-type catalogue: what a step can be, what it may be configured
// with, and — rule 1 of the conversion contract — which types are allowed to
// begin a flow.
//
// This module is PURE DATA and imports nothing from the SDK — not even a type.
// Its only imports are a type from `@/lib/constants` and the SDK-free
// `nodes/<name>/definition.ts` of each node that has moved to its own folder,
// which import nothing themselves. It is read by the editor (browser) AND by
// the adapter and step handlers (pg-boss worker), and the worker must never
// load @workflowbuilder/sdk, whose import runs module-level side effects
// (immer.setAutoFreeze(false), i18next.init) and which is browser-only.
//
// Everything the EDITOR needs — property schemas, labels, icons — lives in
// ./schemas.ts instead, or, for a node that has moved to its own folder, in that
// folder's editor files.
import type { RsvpStatus } from '@/lib/constants';

import * as aiAgentDefinition from '../nodes/action-ai-agent/definition';
import * as callbackRequestDefinition from '../nodes/action-create-callback-request/definition';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import * as notifyTeamDefinition from '../nodes/action-notify-team/definition';
import * as setGuestFieldDefinition from '../nodes/action-set-guest-field/definition';
import * as sumitCreateCustomerDefinition from '../nodes/action-sumit-create-customer/definition';
import * as sumitCreateDocumentDefinition from '../nodes/action-sumit-create-document/definition';
import * as updateGuestStatusDefinition from '../nodes/action-update-guest-status/definition';
import * as webhookDefinition from '../nodes/action-webhook/definition';
import * as conditionDefinition from '../nodes/logic-condition/definition';
import * as setValueDefinition from '../nodes/logic-set-value/definition';
import * as switchDefinition from '../nodes/logic-switch/definition';

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

// The three types of the first slice. Stored verbatim in the diagram's
// `data.type`, so these strings are a persistence contract: renaming one
// orphans every saved workflow that used it.
export const NODE_TYPES = [
  'trigger.whatsapp_inbound',
  'trigger.webhook',
  'trigger.schedule',
  'trigger.sumit_card',
  conditionDefinition.type,
  switchDefinition.type,
  updateGuestStatusDefinition.type,
  'action.send_whatsapp',
  microsoftSendEmailDefinition.type,
  'action.start_rsvp_ai_callback',
  notifyTeamDefinition.type,
  webhookDefinition.type,
  setGuestFieldDefinition.type,
  callbackRequestDefinition.type,
  'action.import_guest_list',
  'logic.wait',
  'action.send_template',
  'action.start_for_each_guest',
  'action.start_voice_call',
  setValueDefinition.type,
  sumitCreateDocumentDefinition.type,
  sumitCreateCustomerDefinition.type,
  aiAgentDefinition.type,
] as const;

export type KalfaNodeType = (typeof NODE_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type configuration, narrowed by `type`
// ---------------------------------------------------------------------------

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
 * `logic.wait` — the run stops here and comes back later.
 *
 * A DURATION, not a wall-clock time, and that is the smaller of the two useful
 * shapes: "three days after this point in the flow" composes with any trigger,
 * while "next Tuesday at 9" only makes sense against a calendar and belongs to
 * the schedule trigger instead.
 *
 * MINUTES IS THE FLOOR. Anything shorter is not a wait an owner can reason
 * about — the queue's own delivery jitter is measured in seconds — and offering
 * seconds would invite a flow that parks and wakes hundreds of times a day.
 */
export const WAIT_UNIT_VALUES = ['minutes', 'hours', 'days'] as const;
export type WaitUnitValue = (typeof WAIT_UNIT_VALUES)[number];

/**
 * `action.start_for_each_guest` — fan a run out, one per matching guest.
 *
 * ⚠️ CHILD RUNS, NOT A LOOP, and that is the design decision worth defending.
 * A loop inside one run would need a nested executor the vendored `runGraph`
 * does not have. A run per guest reuses the engine exactly as it stands: each
 * child gets its own step ledger, its own retries and its own log, so one guest
 * whose message fails does not stop the other 299 — and each child is already
 * a run that guest-touching nodes work inside, because it carries a contact.
 *
 * ⚠️ AND IT IS THE MOST DANGEROUS NODE IN THE PALETTE. One press can start
 * hundreds of runs that each message a real person. `maxGuests` is therefore
 * REQUIRED with no generous default, and the dry run prints the number before
 * anything is armed.
 */
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

export const GUEST_FILTER_STATUSES = ['pending', 'attending', 'declined', 'maybe'] as const;
export type GuestFilterStatus = (typeof GUEST_FILTER_STATUSES)[number];

export type ForEachGuestConfig = {
  /** The workflow to start for each guest. Must be a different workflow. */
  targetWorkflowId: string;
  /** RSVP statuses to include. Empty or absent: every status. */
  statuses?: GuestFilterStatus[];
  /** Only guests who have a phone. Default true — a run about a guest we cannot reach is noise. */
  requirePhone?: boolean;
  /** Hard ceiling. Required; the node refuses without it. */
  maxGuests: number;
};

/**
 * The most guests one fan-out may ever start runs for, whatever the config says.
 *
 * A SECOND ceiling above the owner's own, because `maxGuests` is a field in a
 * jsonb row: the form constrains what can be typed and not what is there. This
 * one is in code and cannot be edited from a browser.
 */
export const FAN_OUT_HARD_CAP = 500;

export type WaitConfig = {
  amount: number;
  unit: WaitUnitValue;
};

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
 * An external system calls in, and a run starts.
 *
 * THE DYNAMIC TRIGGER. It declares no field list: whatever JSON the caller POSTs
 * is published as `{{trigger.body.<path>}}`. A new caller with a different shape
 * needs no code change, no migration and no new node type — which is exactly the
 * difference between this and a trigger whose fields someone has to hard-code.
 *
 * ⚠️ THE TOKEN IS THE ONLY THING STANDING IN FRONT OF A PUBLIC ENDPOINT.
 * It lives in the diagram rather than in a column, the same way n8n shows a
 * webhook URL in its editor — it is an ADDRESS for this workflow, not a
 * credential to somebody else's system, and whoever can open the workflow is
 * exactly who needs to copy it. It is generated server-side (never in the
 * browser) and a workflow with an empty token cannot be armed.
 *
 * The endpoint it unlocks starts a run and nothing else: it cannot read a guest,
 * cannot name an event, and every guest-touching node refuses in a run that came
 * from here (`requireGuestContext`). The blast radius of a leaked token is
 * "someone can make this workflow run", not "someone can reach our data".
 */
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
 * The HTTP methods an inbound webhook may be called with.
 *
 * ⚠️ NOT AN ARBITRARY LIST. n8n's Webhook node offers exactly DELETE / GET /
 * HEAD / PATCH / POST / PUT (its README §HTTP Method, read in full 2026-09-22),
 * and a caller that can only send one of those is the whole reason this field
 * exists — before it, every non-POST call was refused with a 405 and the
 * integration simply could not be built.
 *
 * HEAD is omitted: it is defined to return no body, so a run started by one
 * could never answer anything, and Next would dispatch it to GET regardless.
 */
export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

/** Which methods carry a request body at all. */
export const WEBHOOK_METHODS_WITH_BODY: readonly WebhookMethod[] = ['POST', 'PUT', 'PATCH'];

export const webhookMethodOptions = WEBHOOK_METHODS.map((value) => ({ value, label: value }));

/**
 * Whether a configured method list admits this call.
 *
 * ⚠️ AN EMPTY LIST MEANS POST, NOT "EVERYTHING". Every webhook saved before this
 * field existed was POST-only by construction, so an absent value has to keep
 * meaning exactly that — reading it as "any method" would silently widen a live
 * public endpoint on deploy. Same rule, and the same reason, as `messageKinds`.
 *
 * Accepts BOTH shapes for the same reason `matchesKind` does: the SDK's
 * `ArrayFieldSchema` cannot describe an array of strings, so the control stores
 * `[{ value: 'POST' }]` while a hand-written or older diagram may hold
 * `['POST']`.
 */
export function webhookAllowsMethod(configured: unknown, method: string): boolean {
  const list = Array.isArray(configured)
    ? configured
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object' && typeof (entry as { value?: unknown }).value === 'string'
              ? (entry as { value: string }).value
              : '',
        )
        .filter((value) => value !== '')
    : [];
  const allowed = list.length === 0 ? ['POST'] : list;
  return allowed.includes(method);
}

/**
 * WHERE an inbound call proves itself.
 *
 * ⚠️ TWO MODES BECAUSE TWO CALLERS EXIST, not because one shape was unfinished.
 *
 *   `header`  — the address is public and the secret rides in
 *               `x-kalfa-webhook-secret`. The DEFAULT, and what every diagram
 *               saved before this field means: a secret in a path is written to
 *               every access log, proxy record and Referer that stores a URL,
 *               and the address has to stay showable so the owner can recover
 *               it. See plans/webhook-address-vs-secret.md.
 *
 *   `address` — the path segment IS the credential and nothing else is asked
 *               for. Not a weakening: the segment is the same 32 CSPRNG bytes
 *               the header secret was, only its sha256 is stored, and it is
 *               displayed exactly once. What it costs is the recoverability
 *               `header` buys — which is the trade the owner made on 2026-09-23.
 *
 * ⚠️ IT EXISTS BECAUSE A REAL CALLER CANNOT SEND A HEADER. SUMIT's
 * `/triggers/triggers/subscribe/` takes one field for the destination — `URL` —
 * and its help article's HTTP-call step offers nowhere to put a header. Make's
 * own hook address (`hook.eu2.make.com/<random>`) is built the same way. A
 * header-only endpoint simply cannot be reached by either.
 */
export const WEBHOOK_AUTH_MODES = ['header', 'address'] as const;
export type WebhookAuthMode = (typeof WEBHOOK_AUTH_MODES)[number];

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

export type WebhookTriggerConfig = {
  /**
   * The PUBLIC half of the address, in `header` mode. Safe to show, copy and
   * export — it proves nothing on its own.
   *
   * ⚠️ ABSENT IN `address` MODE, on purpose. There the path segment is the
   * credential, so storing it would put the credential back in the diagram —
   * and from there into every run's `definitionSnapshot`. Only `tokenHash`
   * is kept, and the path is hashed on the way in.
   */
  endpointId?: string;
  /**
   * sha256 of whichever half is the credential: the header secret in `header`
   * mode, the path segment in `address` mode. The value itself is never stored.
   * See `webhook-token.ts`.
   */
  tokenHash: string;
  /** Empty means POST only — see `webhookAllowsMethod`. */
  methods?: readonly { value: string }[] | readonly string[];
  /** Absent means `header` — see `readWebhookAuthMode`. */
  auth?: WebhookAuthMode;
};

/**
 * `trigger.sumit_card` — SUMIT tells us a card changed.
 *
 * A `trigger.webhook` whose caller is known, so its shape can be too. SUMIT's
 * trigger module POSTs `{ Folder, EntityID, Type, Properties }` to a URL it is
 * given and to nothing else (help article 10442304; the payload is visible in
 * its own "פעולות אוטומציה" log). It cannot send a header, so this node is
 * ALWAYS in `address` mode — the node TYPE decides that, never a stored field.
 *
 * ⚠️ NO FOLDER, VIEW OR CHANGE-TYPE FIELD, and that is deliberate. All three are
 * chosen in SUMIT's own "יצירת טריגר" screen, which is where the filtering
 * happens: SUMIT sends only what its trigger selects. The same values stored
 * here would filter nothing — and on an unsigned payload they would add no
 * security either, since a caller holding the address can put any `Folder` in
 * the body. The panel tells the owner what to choose over there instead.
 */
export type SumitCardTriggerConfig = {
  /** sha256 of the path segment. The address is shown once and never stored. */
  tokenHash: string;
};

/**
 * The triggers an inbound HTTP call can start — both resolved by
 * `findWorkflowForEndpoint` behind the one public route.
 *
 * ONE ROUTE, NOT ONE PER CALLER. A second route would be a second place that
 * decides who gets in, and the whole security story of that endpoint is that
 * there is exactly one.
 */
export const INBOUND_HTTP_TRIGGER_TYPES: readonly KalfaNodeType[] = [
  'trigger.webhook',
  'trigger.sumit_card',
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
  if (nodeType === 'trigger.sumit_card') return 'address';
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

// The reply the workflow sends back to the guest who wrote in.
//
// One field, and no recipient among them: the recipient is ALWAYS the contact
// that started this run. A workflow cannot be pointed at an arbitrary phone
// number, which is what keeps an automation from becoming a broadcast tool.
export type SendWhatsappConfig = {
  body: string;
};

// `action.microsoft_send_email` — its config, and the content-type and importance
// values only it reads, are declared with the rest of its contract in
// `nodes/action-microsoft-send-email/definition.ts`, re-exported here for
// existing readers.
export type MicrosoftSendEmailConfig = microsoftSendEmailDefinition.MicrosoftSendEmailConfig;

// Starts the existing RSVP voice agent through KALFA's production dispatcher.
// Agent/provider/model/knowledge configuration deliberately lives outside the diagram.
export type StartRsvpAiCallbackConfig = Record<string, unknown>;

/**
 * `action.start_voice_call` — dial the guest through a configured voice purpose.
 *
 * Written from what the node actually carries: the fields its schema declares
 * (`voiceCallSchemaFor` in schemas.ts) and the ones its handler reads
 * (`startVoiceCall` in steps). It was the one type with no member in
 * `KalfaNodeConfig`, and nothing noticed — `_KALFA_NODE_CONFIG_COVERS_ALL_TYPES`
 * below is what notices now.
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
  | { type: 'trigger.whatsapp_inbound'; config: WhatsappInboundConfig }
  | { type: 'trigger.webhook'; config: WebhookTriggerConfig }
  | { type: typeof aiAgentDefinition.type; config: AiAgentConfig }
  | { type: 'trigger.schedule'; config: ScheduleTriggerConfig }
  | { type: 'trigger.sumit_card'; config: SumitCardTriggerConfig }
  | { type: typeof conditionDefinition.type; config: ConditionConfig }
  | { type: typeof switchDefinition.type; config: SwitchConfig }
  | { type: typeof updateGuestStatusDefinition.type; config: UpdateGuestStatusConfig }
  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }
  | { type: typeof microsoftSendEmailDefinition.type; config: MicrosoftSendEmailConfig }
  | { type: 'action.start_rsvp_ai_callback'; config: StartRsvpAiCallbackConfig }
  | { type: 'action.start_voice_call'; config: StartVoiceCallConfig }
  | { type: typeof notifyTeamDefinition.type; config: NotifyTeamConfig }
  | { type: typeof webhookDefinition.type; config: WebhookConfig }
  | { type: typeof setGuestFieldDefinition.type; config: SetGuestFieldConfig }
  | { type: typeof callbackRequestDefinition.type; config: CreateCallbackRequestConfig }
  | { type: 'action.import_guest_list'; config: ImportGuestListConfig }
  | { type: 'logic.wait'; config: WaitConfig }
  | { type: 'action.send_template'; config: SendTemplateConfig }
  | { type: 'action.start_for_each_guest'; config: ForEachGuestConfig }
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
// live in ./schemas.ts, which imports @workflowbuilder/sdk at run time and is
// therefore client-only.
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
 * Which properties each node type cannot run without.
 *
 * ⚠️ THIS LIVES HERE, NOT IN `schemas.ts`, AND THE REASON IS A PRODUCTION OUTAGE.
 *
 * `schemas.ts` imports runtime values from `@workflowbuilder/sdk` and is reached
 * from a `'use client'` editor, so Next puts it in the CLIENT module graph. A
 * server module that imports it does NOT get the values — it gets a client
 * reference stub, and `PALETTE_ITEMS.find` is then a function that throws.
 * Measured on 2026-09-14 in `.next/server/chunks`:
 *
 *     registerClientReference(function(){ throw Error("Attempted to call
 *       PALETTE_ITEMS() from the server but PALETTE_ITEMS is on the client…") })
 *
 * The arm-time check runs on the server and needs exactly this data, so the data
 * moved to the module BOTH graphs can hold. `types.ts` imports nothing from the
 * SDK — the same rule `nodes.ts` states for the worker.
 *
 * `schemas.ts` reads these instead of declaring its own copy, so the editor form
 * and the arming gate cannot drift apart: a field required in one is required in
 * the other, by construction rather than by discipline.
 */
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
 * the 21 nodes present in this installation's saved workflows missed
 * `trigger.webhook.token` and `action.start_for_each_guest.targetWorkflowId`
 * outright — neither node type had ever been used here. Anything classified
 * below was read from the property schemas in `schemas.ts`, which is the list of
 * what a node CAN hold rather than what one happens to.
 *
 * Each entry was then checked at its use site rather than from its name:
 *
 *   token             `webhook-trigger.ts` compares it in constant time and the
 *                     field's own label calls it a password. It IS the trigger's
 *                     whole credential.
 *   targetWorkflowId  a `workflows.id` uuid.
 *   url / headers     `dry-run.ts` already refuses to print header values,
 *                     because an owner may type a literal secret before reading
 *                     the warning. An export file is the same class of artefact.
 *   topic             a closed `callbackTopicOptions` list compiled into the app,
 *                     so it travels — unlike `purposeKey`, which names a row.
 *
 * Fail-closed: `portability.test.ts` refuses a property that neither appears
 * here nor in its allow-list of reviewed portable names, so a new node cannot
 * ship unclassified.
 */
export const NODE_DEPLOYMENT_BINDINGS: Partial<
  Record<KalfaNodeType, Record<string, DeploymentBinding>>
> = {
  // A moved node declares its own — even `{}` — in its definition.
  [setValueDefinition.type]: setValueDefinition.deploymentBindings,
  [conditionDefinition.type]: conditionDefinition.deploymentBindings,
  [switchDefinition.type]: switchDefinition.deploymentBindings,
  [notifyTeamDefinition.type]: notifyTeamDefinition.deploymentBindings,
  [setGuestFieldDefinition.type]: setGuestFieldDefinition.deploymentBindings,
  [updateGuestStatusDefinition.type]: updateGuestStatusDefinition.deploymentBindings,
  'trigger.whatsapp_inbound': { phoneNumberId: 'identifier' },
  // A HASH, not the token — so this is no longer a secret that must not travel,
  // but it still authenticates to THIS installation and resolves to nothing
  // anywhere else. See webhook-token.ts for why the value moved out.
  'trigger.webhook': { endpointId: 'identifier', tokenHash: 'identifier' },
  // The same reasoning: a hash that authenticates to THIS installation only.
  'trigger.sumit_card': { tokenHash: 'identifier' },
  [microsoftSendEmailDefinition.type]: microsoftSendEmailDefinition.deploymentBindings,
  'action.send_template': { messageKey: 'catalogue' },
  [callbackRequestDefinition.type]: callbackRequestDefinition.deploymentBindings,
  'action.start_for_each_guest': { targetWorkflowId: 'identifier' },
  [webhookDefinition.type]: webhookDefinition.deploymentBindings,
  [aiAgentDefinition.type]: aiAgentDefinition.deploymentBindings,
  // Both SUMIT ids point INTO this installation: they are our own reference for
  // a customer, so a diagram carrying one would reach for a record that does not
  // exist anywhere else.
  [sumitCreateDocumentDefinition.type]: sumitCreateDocumentDefinition.deploymentBindings,
  [sumitCreateCustomerDefinition.type]: sumitCreateCustomerDefinition.deploymentBindings,
  'action.start_voice_call': {
    purposeKey: 'catalogue',
    callerId: 'identifier',
    ruleId: 'identifier',
    agentId: 'identifier',
    toOverride: 'identifier',
  },
};

export const NODE_REQUIRED_FIELDS: Record<KalfaNodeType, string[]> = {
  'trigger.whatsapp_inbound': ['label', 'description'],
  // ⚠️ `endpointId` IS NOT HERE — it moved to the conditional table. It exists
  // only in `header` mode; in `address` mode the path segment is the credential
  // and is never stored, so requiring it would make that mode unarmable.
  // `tokenHash` stays: BOTH modes have one, it is just a hash of a different
  // half.
  'trigger.webhook': ['label', 'description', 'tokenHash'],
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [aiAgentDefinition.type]: aiAgentDefinition.requiredFields,
  'trigger.schedule': ['label', 'description', 'time'],
  'trigger.sumit_card': ['label', 'description', 'tokenHash'],
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [conditionDefinition.type]: conditionDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [switchDefinition.type]: switchDefinition.requiredFields,
  'logic.wait': ['label', 'description', 'amount', 'unit'],
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [setValueDefinition.type]: setValueDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [updateGuestStatusDefinition.type]: updateGuestStatusDefinition.requiredFields,
  'action.send_whatsapp': ['label', 'description', 'body'],
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [microsoftSendEmailDefinition.type]: microsoftSendEmailDefinition.requiredFields,
  'action.send_template': ['label', 'description', 'messageKey'],
  'action.start_rsvp_ai_callback': ['label', 'description'],
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
  'action.import_guest_list': ['label', 'description'],
  'action.start_for_each_guest': ['label', 'description', 'targetWorkflowId', 'maxGuests'],
  'action.start_voice_call': ['label', 'description', 'purposeKey'],
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sumitCreateDocumentDefinition.type]: sumitCreateDocumentDefinition.requiredFields,
  // The SAME array the node's editor schema uses — `arm-check.test.ts` asserts
  // identity with `toBe`, so this must not become a copy.
  [sumitCreateCustomerDefinition.type]: sumitCreateCustomerDefinition.requiredFields,
};

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

export const GUEST_SCOPED_NODE_TYPES: readonly KalfaNodeType[] = [
  updateGuestStatusDefinition.type,
  'action.send_whatsapp',
  'action.send_template',
  setGuestFieldDefinition.type,
  callbackRequestDefinition.type,
  'action.start_voice_call',
  'action.start_rsvp_ai_callback',
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
  if (triggerType !== 'trigger.whatsapp_inbound') return false;

  const kinds = properties.messageKinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return true;

  return kinds.some((entry) => {
    const value =
      typeof entry === 'string'
        ? entry
        : (entry as { value?: unknown } | null)?.value;
    return typeof value === 'string' && !OWNER_WHATSAPP_MESSAGE_KINDS.includes(value);
  });
}

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
 * Has this trigger been narrowed until nothing can ever match it?
 *
 * ⚠️ THE TWO FILTERS ARE ANDed, AND THAT IS WHY THIS CAN HAPPEN. `planRuns`
 * applies `matchesKind` and then `matchesKeyword` to the same message. A keyword
 * is only ever tested against `text.body`, so a trigger that accepts NO
 * text-bearing kind and still carries a keyword has asked for a message that
 * does not exist: every candidate either fails the kind filter or arrives with
 * an empty body and fails the keyword.
 *
 * ⚠️ AND THIS IS NOT EXPRESSIBLE IN THE NODE'S SCHEMA. Both halves live in one
 * node, so a JsonForms rule could see them — but the only honest UI response is
 * to HIDE or DISABLE the keyword box, and neither CLEARS the stored value. A
 * trigger that already carries `keyword: 'שיחה'` with kinds excluding `text`
 * would stay just as dead while losing the one visible clue why. So the refusal
 * belongs at arming, where it can name the fix.
 *
 * Absent or empty `messageKinds` is NEVER dead: it means
 * `DEFAULT_WHATSAPP_MESSAGE_KINDS`, which includes `text`.
 *
 * Both persisted shapes are accepted, the same tolerance `matchesKind` has.
 */
export function triggerKeywordCanNeverMatch(
  triggerType: string,
  properties: Record<string, unknown>,
): boolean {
  if (triggerType !== 'trigger.whatsapp_inbound') return false;

  const keyword = properties.keyword;
  if (typeof keyword !== 'string' || keyword.trim() === '') return false;

  const kinds = properties.messageKinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return false;

  return !kinds.some((entry) => {
    const value =
      typeof entry === 'string' ? entry : (entry as { value?: unknown } | null)?.value;
    return typeof value === 'string' && TEXT_BEARING_WHATSAPP_MESSAGE_KINDS.includes(value);
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
 * ⚠️ ONE ENTRY TODAY, AND THAT IS DELIBERATE. All 24 handler refusals were read
 * before this existed and not one of them is of the form "field X is required
 * because field Y is Z" — so this is not a mechanism looking for a use. It is
 * here because `sendOutboundWebhook` genuinely branches on the verb: it builds,
 * resolves and secret-checks the body and then, for GET and DELETE, does not
 * send it. The panel offered a three-row editor for a field that went nowhere.
 */
export const NODE_CONDITIONAL_REQUIRED_FIELDS: Partial<
  Record<KalfaNodeType, readonly ConditionalRequirement[]>
> = {
  // Declared with the rest of the node's contract — the SAME array, read here.
  [webhookDefinition.type]: webhookDefinition.conditionalRequirements,
  // The address half is required in `header` mode and MUST NOT exist in
  // `address` mode — see `WebhookTriggerConfig.endpointId`. `fallback: 'header'`
  // is what keeps every diagram saved before the field behaving exactly as it
  // did, and it is inside `whenIn` as the type's own warning requires.
  'trigger.webhook': [
    {
      decidedBy: 'auth',
      whenIn: ['header'],
      fallback: 'header',
      require: 'endpointId',
      message:
        'לא נוצרה כתובת. לחצו על יצירת סוד — הכתובת תיווצר יחד איתו ותישאר גלויה.',
    },
  ],
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
  'logic.wait': { amount: { minimum: 1 } },
  'action.start_for_each_guest': { maxGuests: { minimum: 1, maximum: FAN_OUT_HARD_CAP } },
};

/**
 * How many fan-outs deep a chain may go before the next generation is refused.
 *
 * ⚠️ WHY A DEPTH CAP AND NOT ONLY A SELF-CHECK. Refusing a workflow that fans
 * out to ITSELF stops the obvious shape and nothing else: W1 → W2 → W1 is the
 * same exponential with one more hop, and no single node in it points at its own
 * workflow. Depth is the property that actually bounds the tree; "self" is just
 * its shortest cycle.
 *
 * The arithmetic is the reason this matters. `FAN_OUT_HARD_CAP` bounds the
 * WIDTH of one generation, never the number of generations — and the child
 * dedupe key is `fanout:${parentRunId}:${nodeId}:${contactId}`, whose parent run
 * id is NEW in every generation, so it does not stop the next one either. With a
 * cap of 10 per level an unbounded chain is 10 → 100 → 1,000 → 10,000 runs, and
 * every leaf may message a real guest.
 *
 * A run nobody fanned out to is depth 0, so 3 permits three generations of
 * children and refuses the fourth. Chosen with the owner on 2026-09-14; no real
 * flow needs more, and a chain that does is better stopped and read than run.
 */
export const MAX_FANOUT_DEPTH = 3;
