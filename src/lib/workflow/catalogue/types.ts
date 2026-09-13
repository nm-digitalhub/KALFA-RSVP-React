// The KALFA node-type catalogue: what a step can be, what it may be configured
// with, and — rule 1 of the conversion contract — which types are allowed to
// begin a flow.
//
// This module is PURE DATA and imports NOTHING — not even a type from the SDK.
// It is read by the editor (browser) AND by the adapter and step handlers
// (pg-boss worker), and the worker must never load @workflowbuilder/sdk, whose
// import runs module-level side effects (immer.setAutoFreeze(false),
// i18next.init) and which is browser-only.
//
// Everything the EDITOR needs — property schemas, labels, icons — lives in
// ./schemas.ts instead.
import type { RsvpStatus } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

// The three types of the first slice. Stored verbatim in the diagram's
// `data.type`, so these strings are a persistence contract: renaming one
// orphans every saved workflow that used it.
export const NODE_TYPES = [
  'trigger.whatsapp_inbound',
  'trigger.webhook',
  'logic.condition',
  'logic.switch',
  'action.update_guest_status',
  'action.send_whatsapp',
  'action.start_rsvp_ai_callback',
  'action.notify_team',
  'action.webhook',
  'action.set_guest_field',
  'action.create_callback_request',
  'logic.set_value',
] as const;

export type KalfaNodeType = (typeof NODE_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type configuration, narrowed by `type`
// ---------------------------------------------------------------------------

// Trigger fields offered in the condition's dropdown.
//
// This list used to hold two entries and to be the ONLY thing a condition could
// look at, on the reasoning that "an unbounded accessor would invite reaching
// into something that is not there and failing at run time instead of at save
// time". Two things make that reasoning obsolete:
//
//   1. the trigger payload grew from two fields to seven, so the closed set was
//      hiding five values a workflow was already carrying; and
//   2. `resolveConfigTemplates` now runs over every field of every config before
//      the handler sees it, and an unresolvable reference raises
//      `PermanentNodeExecutionError` naming the offending token. The failure the
//      closed set was protecting against is now loud, immediate and specific —
//      which was the only thing wrong with it.
//
// So the dropdown stays as the convenient path and is complete, while `left`
// below opens the door the docs describe: `nodes/conditional.md` specifies X and
// Y as free values that "support referencing data from earlier nodes and the
// trigger payload". A condition can now compare `{{nodes.<id>.value}}` to
// anything, which is what makes multi-step logic expressible at all.
export const CONDITION_FIELDS = [
  'message_text',
  'button_payload',
  'guest_name',
  'event_name',
  'event_date',
  'contactId',
  'eventId',
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// Operators that take no right-hand value. Named once, because THREE places have
// to agree — the form's HIDE rule, the handler's evaluation, and any reader
// asking why 'ערך' vanished.
export const UNARY_CONDITION_OPERATORS = ['is_empty', 'is_not_empty'] as const;

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
};

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
export type WebhookTriggerConfig = {
  /** Opaque, server-generated. Empty means the trigger is not wired up yet. */
  token: string;
};

// The two outgoing ports of a condition node, as HANDLE IDS.
//
// These strings are a persistence contract twice over, and getting them wrong
// is silent. The runner's `isEdgeLive` fires an outgoing edge only when
// `edge.sourceHandle === nextPort`, compared with `===` and nothing else. So the
// value the handler returns must be, character for character, the id the EDITOR
// wrote on the handle the owner dragged from.
//
// The editor mints handle ids with the SDK's `getHandleId({ handleType, innerId })`,
// documented as returning `<handleType>:inner:<innerId>` for a sub-handle. The
// SDK's own decision branches pass a `crypto.randomUUID()` as `innerId`, but the
// parser accepts any suffix (`/^(source|target):inner:/`), so a FIXED innerId is
// legal and gives us the one thing a UUID cannot: a value the worker can know
// without reading the diagram.
//
// They are spelled out as literals rather than computed, because this module is
// read by the pg-boss worker and must not import @workflowbuilder/sdk.
// `schemas.test.ts` asserts each literal equals `getHandleId(...)` on the SDK
// side, so if the SDK ever changes the format the test fails rather than the
// workflow.
export const CONDITION_BRANCH_HANDLES = {
  true: 'source:inner:true',
  false: 'source:inner:false',
} as const;

export type ConditionBranchHandle =
  (typeof CONDITION_BRANCH_HANDLES)[keyof typeof CONDITION_BRANCH_HANDLES];

export type ConditionConfig = {
  /**
   * The left-hand side, as a free expression.
   *
   * Empty or absent means "use `field`", which is what every diagram saved
   * before this existed contains — so old workflows keep evaluating exactly as
   * they did, and the fallback is a compatibility path rather than a second way
   * to write a new condition.
   */
  left?: string;
  field: ConditionField;
  operator: ConditionOperator;
  // Unused by the unary operators. Kept optional rather than a union so the
  // property form can show one shape and hide the field with a JSONForms rule.
  value?: string;
};

// ---------------------------------------------------------------------------
// logic.switch
// ---------------------------------------------------------------------------

/**
 * The four outgoing ports of a switch, as HANDLE IDS.
 *
 * Same contract and the same hazard as `CONDITION_BRANCH_HANDLES`: the string a
 * handler returns must equal, character for character, the id the editor wrote
 * on the handle the owner dragged from — `isEdgeLive` compares with `===` and
 * nothing else. `branch-handles.test.ts` pins each literal against the SDK's own
 * `getHandleId`, so a change to the SDK's format fails a test instead of
 * silently routing every switch into a dead end.
 *
 * THREE CASES, NOT N. The SDK can render a variable number of branches, and the
 * owner could in principle add them from the properties panel — but the WORKER
 * would then have to discover the port list from the diagram, and a handle the
 * owner renamed would route nowhere with nothing to say about why. Three plus a
 * default is what a fixed, worker-known set buys, and it is the shape most
 * routing actually has: two or three known answers and "anything else".
 *
 * The default branch is what a condition node cannot express. `logic.condition`
 * names one of two ports and both are "the test", so an unmatched value still
 * has to be modelled as false; here "none of the above" is its own route.
 */
export const SWITCH_CASE_HANDLES = [
  'source:inner:case1',
  'source:inner:case2',
  'source:inner:case3',
] as const;

export const SWITCH_DEFAULT_HANDLE = 'source:inner:default';

/** How many `caseN` fields the form offers. Ties the config, the schema and the handler together. */
export const SWITCH_CASE_COUNT = SWITCH_CASE_HANDLES.length;

/**
 * Route one value to one of three named cases, or to the default.
 *
 * `left` is a free expression for the same reason `ConditionConfig.left` is:
 * every field passes through `resolveConfigTemplates` before the handler sees
 * it, so it can name `{{trigger.button_payload}}`, `{{nodes.<id>.value}}` or any
 * mixture. The `caseN` values are free too — routing on one node's output
 * against another's is the point.
 *
 * An EMPTY caseN is an unused branch, not a match against the empty string. A
 * switch with one case filled in is a legal, if plain, two-way router; without
 * that rule, three empty fields would make every empty value match case 1 and
 * the default would be unreachable.
 */
export type SwitchConfig = {
  left: string;
  case1?: string;
  case2?: string;
  case3?: string;
};

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

export type UpdateGuestStatusConfig = {
  // `rsvpStatus`, not `status`: the SDK reserves `status` for the node's own
  // Active / Draft / Disabled lifecycle. See the schema for the full note.
  rsvpStatus: RsvpStatus;
};

// The reply the workflow sends back to the guest who wrote in.
//
// One field, and no recipient among them: the recipient is ALWAYS the contact
// that started this run. A workflow cannot be pointed at an arbitrary phone
// number, which is what keeps an automation from becoming a broadcast tool.
export type SendWhatsappConfig = {
  body: string;
};

// Starts the existing RSVP voice agent through KALFA's production dispatcher.
// Agent/provider/model/knowledge configuration deliberately lives outside the diagram.
export type StartRsvpAiCallbackConfig = Record<string, unknown>;

// An internal alert to the KALFA team — never to a guest.
//
// The one action here whose audience is us. It exists because an automation
// that quietly does the wrong thing is worse than one that fails: a workflow
// can now say "a guest asked something I do not understand" and put it in front
// of a person.
// Declared here rather than beside the handler because THREE modules have to
// agree on it — the palette's Select options, the handler's `readEnum` guard,
// and the port the alert crosses — and this module is the one they can all
// import (it pulls in nothing, so the worker can bundle it).
export const NOTIFY_LEVELS = ['info', 'warn', 'error'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

export type NotifyTeamConfig = {
  title: string;
  detail: string;
  level: NotifyLevel;
};

/**
 * POST to a system that is not ours.
 *
 * The first action whose effect leaves KALFA entirely. Two fields and no more:
 * a destination and a body.
 *
 * NO HEADERS FIELD, and that is a decision rather than an omission. A headers
 * map is how an API key gets typed into a diagram — and the diagram is a jsonb
 * column that the editor loads into a browser, the dry run prints, and the run
 * log echoes. A secret belongs in app_settings behind the masked-field
 * convention, not in a node an owner can screenshot. When a webhook needs
 * authentication, the honest shapes are a signed payload or a secret path
 * segment in the URL, both of which this supports today; a proper credential
 * store for this node is its own piece of work.
 *
 * NO METHOD FIELD either. POST is what a webhook is. GET with a body is
 * meaningless, and offering DELETE or PUT would make this an HTTP client rather
 * than a notification — a much larger surface to secure for a case nobody has
 * asked for.
 *
 * `body` is free text and template-resolved like every other field, so it can
 * carry `{{trigger.guest_name}}` or `{{nodes.<id>.value}}`. It is sent with
 * `Content-Type: application/json`, so an owner writing JSON gets JSON; the node
 * does not parse or validate it, because a body the receiver accepts is between
 * them and the receiver.
 */
export type WebhookConfig = {
  url: string;
  body: string;
};

// ---------------------------------------------------------------------------
// action.set_guest_field
// ---------------------------------------------------------------------------

/**
 * The guest fields a workflow may write, and the three that are deliberately absent.
 *
 * NOT `status` — `action.update_guest_status` owns it, and it goes through the
 * atomic `submit_rsvp` gate rather than a column write, so no RSVP rule is ever
 * reimplemented in a step.
 *
 * NOT the headcount columns (`expected_count`, `confirmed_adults`,
 * `confirmed_kids`, `confirmed_headcount`). They are derived together by the same
 * RPC; writing one of them directly produces a row whose numbers disagree with
 * each other, and nothing downstream would notice.
 *
 * NOT `phone` or `full_name` — identity. A workflow that could rewrite the phone
 * could silently redirect every future send for that guest.
 *
 * ⚠️ `note` AND `rsvp_note` ARE DIFFERENT FIELDS AND THE DIFFERENCE IS A PRIVACY
 * ONE. `guests.note` is the OWNER's internal annotation and is never shown to the
 * guest; `rsvp_note` is what the guest themself wrote, and the public RSVP page
 * renders it. Writing a guest's words into `note` hides them from the guest's own
 * view; writing an internal remark into `rsvp_note` shows the owner's private note
 * to the guest. Both labels below say which is which.
 */
export const GUEST_FIELDS = ['meal_pref', 'rsvp_note', 'note'] as const;
export type GuestField = (typeof GUEST_FIELDS)[number];

/**
 * Set one guest field on the contact that started this run.
 *
 * IDEMPOTENT BY CONSTRUCTION, which is what makes it a legal action node at all:
 * `StepClaim`'s lease can replay a step whose side effect completed, and writing
 * the same value to the same column twice is the same row. See ports.ts.
 */
export type SetGuestFieldConfig = {
  field: GuestField;
  /** Free text, template-resolved — so it can carry `{{trigger.message.text}}`. */
  value: string;
};

// ---------------------------------------------------------------------------
// action.create_callback_request
// ---------------------------------------------------------------------------

/**
 * Ask a human to call this guest back.
 *
 * The escape hatch every automation needs: a workflow that cannot answer a guest
 * should put them in front of a person rather than guess. `action.notify_team`
 * tells the team something happened; this one creates a row in the queue they
 * actually work from, with the guest's name and number already on it.
 *
 * ⚠️ NOT IDEMPOTENT ON ITS OWN — a second row is a second phone call to a real
 * person. The implementation therefore dedupes on an OPEN request for the same
 * phone inside a window, the same rule `console-calls.ts` already applies to
 * missed inbound calls. Without it, a guest who writes twice gets called twice.
 */
export type CreateCallbackRequestConfig = {
  /** What the callback is about — shown to whoever picks it up. */
  topic: string;
  /** Free text, template-resolved. */
  note: string;
};

// Compute a value and hand it to later steps.
//
// This node does no I/O at all, and that is exactly why it is worth having.
// Every field of every node now passes through `resolveConfigTemplates`, so
// `value` can be any mixture of literal text and `{{…}}` references — and its
// OUTPUT is readable downstream as `{{nodes.<id>.value}}`.
//
// That turns the resolver from a substitution feature into a composition one:
// build a greeting once, reuse it in three branches; or normalise something
// awkward in one visible place on the canvas instead of repeating the same
// expression in every message body. It is n8n's `Set` node, minus the parts
// that need a runtime we do not have.
export type SetValueConfig = {
  value: string;
};

// The discriminated union the step handlers narrow on. `BaseNode.config` in the
// vendored runner is `unknown`; this is the vocabulary we give it.
export type KalfaNodeConfig =
  | { type: 'trigger.whatsapp_inbound'; config: WhatsappInboundConfig }
  | { type: 'trigger.webhook'; config: WebhookTriggerConfig }
  | { type: 'logic.condition'; config: ConditionConfig }
  | { type: 'logic.switch'; config: SwitchConfig }
  | { type: 'action.update_guest_status'; config: UpdateGuestStatusConfig }
  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }
  | { type: 'action.start_rsvp_ai_callback'; config: StartRsvpAiCallbackConfig }
  | { type: 'action.notify_team'; config: NotifyTeamConfig }
  | { type: 'action.webhook'; config: WebhookConfig }
  | { type: 'action.set_guest_field'; config: SetGuestFieldConfig }
  | { type: 'action.create_callback_request'; config: CreateCallbackRequestConfig }
  | { type: 'logic.set_value'; config: SetValueConfig };

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
