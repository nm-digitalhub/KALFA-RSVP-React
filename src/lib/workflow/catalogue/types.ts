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
  'trigger.schedule',
  'logic.condition',
  'logic.switch',
  'action.update_guest_status',
  'action.send_whatsapp',
  'action.microsoft_send_email',
  'action.start_rsvp_ai_callback',
  'action.notify_team',
  'action.webhook',
  'action.set_guest_field',
  'action.create_callback_request',
  'action.import_guest_list',
  'logic.wait',
  'action.send_template',
  'action.start_for_each_guest',
  'action.start_voice_call',
  'logic.set_value',
  'action.sumit_create_document',
  'action.sumit_create_customer',
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
 * `logic.switch` — N named branches, each with its own conditions.
 *
 * REBUILT 1:1 ON THE SDK'S OWN `DecisionBranches` CONTROL (2026-09-13). The first
 * version hard-coded three cases and a default because I had not read far enough:
 * the SDK ships a composer that gives the owner add / remove / reorder / rename
 * over the branch list, and `ArrayFieldSchema` to declare it. The ceiling was
 * mine, not the package's.
 *
 * The operators below are the SDK's own `comparisonsOperators`, copied as
 * literals rather than imported — this module is read by the pg-boss worker and
 * must not load `@workflowbuilder/sdk`. `branch-handles.test.ts` pins them
 * against the package so a drift fails a test rather than a live workflow.
 */
export const SWITCH_COMPARISON_OPERATORS = [
  'isEqual',
  'isNotEqual',
  'isGreaterThan',
  'isLessThan',
  'isLessThanOrEqual',
  'isGreaterThanOrEqual',
  'isContaining',
  'isNotContaining',
  'isBefore',
  'isAfter',
] as const;
export type SwitchComparisonOperator = (typeof SWITCH_COMPARISON_OPERATORS)[number];

/**
 * The SDK's `LogicalOperator`, joining the rows within ONE branch.
 *
 * ONE per branch, not one per join: the control renders its picker on the first
 * row only (measured — see `evaluateSwitchBranch`), so `conditions[0]` is the
 * only authoritative copy and the field on later rows is inert.
 */
export const SWITCH_LOGICAL_OPERATORS = ['AND', 'OR'] as const;
export type SwitchLogicalOperator = (typeof SWITCH_LOGICAL_OPERATORS)[number];

/**
 * One condition row, exactly the SDK's `DynamicCondition`.
 *
 * `x` and `y` are free values — literal text or `{{…}}` references — and both
 * arrive ALREADY RESOLVED, because `resolveConfigTemplates` walks the whole
 * config before the handler runs. That is what the earlier note in schemas.ts
 * said we could not do ("their conditions resolve through resolveTemplate, which
 * we did not vendor"); resolve-template IS vendored and wired, so the reason is
 * gone and the control can be exposed as designed.
 */
export type SwitchCondition = {
  x: string;
  comparisonOperator: SwitchComparisonOperator;
  y: string;
  logicalOperator: SwitchLogicalOperator;
};

/**
 * One branch: a handle, a label and the rows that select it.
 *
 * `sourceHandle` is minted by the EDITOR through `getHandleId`, so unlike the
 * fixed three-case version the worker cannot know the ports in advance — it
 * reads them from the branch the conditions selected. That is the whole reason
 * this shape can be dynamic at all.
 */
export type SwitchBranch = {
  id: string;
  sourceHandle: string;
  label?: string;
  conditions?: SwitchCondition[];
};

/**
 * The DEFAULT port — fired when no branch matched.
 *
 * Seeded by the palette and NOT removable from the control, because "none of the
 * above" is the one route that must always exist: without it an unmatched value
 * names no port, `isEdgeLive` prunes every edge, and the run ends `incomplete`
 * with a dead end rather than going somewhere a person chose.
 */
export const SWITCH_DEFAULT_HANDLE = 'source:inner:default';
export const SWITCH_DEFAULT_BRANCH_ID = 'default';

/**
 * The handle id a branch of `id` draws, spelled once.
 *
 * This is the SDK's `getHandleId({ handleType: 'source', innerId })` output —
 * reproduced as a string template rather than imported, because this module is
 * read by the pg-boss worker and must not load `@workflowbuilder/sdk`.
 * `branch-handles.test.ts` pins the two against each other, so a change in the
 * SDK's format fails a test instead of silently orphaning every seeded branch.
 *
 * Branches the OWNER adds get theirs minted by the control in this same shape;
 * this exists for the ones WE seed (the palette default, the diagram templates).
 */
export function switchBranchHandle(branchId: string): string {
  return `source:inner:${branchId}`;
}

export type SwitchConfig = {
  /** The value every branch's conditions are compared against, if they use it. */
  left?: string;
  /** Read by the SDK's node renderer AND by the handler. One array, one truth. */
  decisionBranches: SwitchBranch[];
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

/**
 * How Graph is told to read the body. Graph's own default is `Text`, which is
 * exactly what every diagram saved before this field existed meant — so an
 * absent value and an explicit `Text` produce the same mail.
 */
export const MICROSOFT_MAIL_CONTENT_TYPES = ['Text', 'HTML'] as const;
export type MicrosoftMailContentType = (typeof MICROSOFT_MAIL_CONTENT_TYPES)[number];

/** Graph's own `message.importance`. `normal` is its default, for the same reason. */
export const MICROSOFT_MAIL_IMPORTANCES = ['low', 'normal', 'high'] as const;
export type MicrosoftMailImportance = (typeof MICROSOFT_MAIL_IMPORTANCES)[number];

/**
 * Sends an email through a KALFA-managed Microsoft 365 connection.
 *
 * The workflow stores the connection identifier and message data only.
 * OAuth access/refresh tokens and client secrets never belong to diagram JSON.
 *
 * ⚠️ ONLY `connectionId`, `to`, `subject` AND `body` ARE REQUIRED, and the split
 * is deliberate: `NODE_REQUIRED_FIELDS` is the ARMING contract — what a step
 * cannot run without — while everything else here is an option the editor offers
 * and the transport defaults. A diagram saved before these fields existed
 * carries none of them and keeps sending exactly the mail it always did,
 * because every default below is Graph's own.
 *
 * ⚠️ `to` IS ONE ADDRESS; `cc`, `bcc` AND `replyTo` ARE LISTS. That asymmetry is
 * a decision, not an oversight (2026-09-17). Widening the primary recipient from
 * one address to many changes what an existing node means at run time, and it
 * deserves its own change with its own test rather than arriving as a side
 * effect of adding carbon copies. The three new fields are stored as one string
 * each and split on `,` or `;` by the transport — neither character can appear
 * in a legal address, so nothing that parsed as one address stops doing so.
 *
 * Addresses are not validated HERE, and that follows the rule every other field
 * follows: `resolveConfigTemplates` rewrites `{{trigger.…}}` before the handler
 * ever sees the config, so at save time a field may legitimately look like
 * nothing at all. The shape check belongs at the transport, where the value is
 * final.
 */
export type MicrosoftSendEmailConfig = {
  connectionId: string;
  /** One address. See the note above for why this one is not a list. */
  to: string;
  /** Zero or more addresses, separated by `,` or `;`. */
  cc?: string;
  /** Zero or more addresses, separated by `,` or `;`. */
  bcc?: string;
  /** Zero or more addresses, separated by `,` or `;`. */
  replyTo?: string;
  subject: string;
  body: string;
  contentType?: MicrosoftMailContentType;
  importance?: MicrosoftMailImportance;
  saveToSentItems?: boolean;
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
 * An HTTP call to a system that is not ours.
 *
 * WIDENED 2026-09-13 from a POST-only "webhook" to a real HTTP request: method,
 * headers and an optional response capture. The node type id stays
 * `action.webhook` because nothing stored uses it (measured: 0 of 20 workflows)
 * and churning the id would touch the adapter, the catalogue and every test for
 * no behavioural gain.
 *
 * ⚠️ THE HEADERS FIELD REVERSES AN EARLIER DECISION, and the reason it can is
 * `secrets` below.
 *
 * The old note here argued: "a headers map is how an API key gets typed into a
 * diagram — and the diagram is a jsonb column the editor loads into a browser".
 * That reasoning was sound about the HAZARD and wrong about the CONCLUSION. The
 * answer to "a secret must not be in the diagram" is not "no headers" — it is
 * "headers hold a REFERENCE, and the value is fetched at the socket". Without
 * headers this node cannot call any authenticated API, which is most of them.
 *
 * So a header value may be `{{secrets.<NAME>}}`. That token is what is stored,
 * what the browser loads, what the dry run prints and what the run log echoes —
 * the secret itself exists only inside the worker process, for the microseconds
 * between the lookup and the socket write. `resolveTemplate` is explicitly
 * taught to LEAVE this namespace alone (see its `secrets` case) so the value
 * cannot leak by being resolved into the config early, and `redact.ts` cannot
 * help here: its matching is key-based, and the key on a header row is `value`.
 *
 * ON `captureResponse`. Off by default. A GET whose answer nobody can read is
 * pointless, so the response may be captured into the node's output and named as
 * `{{nodes.<id>.body}}` — but it is a THIRD PARTY's bytes landing in our run
 * store, so the owner has to ask for it, and it is capped.
 */
export const HTTP_METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The method used when a diagram does not name one — what every saved node meant. */
export const DEFAULT_HTTP_METHOD: HttpMethod = 'POST';

/** Methods that carry a request body. A GET with a body is meaningless. */
export const HTTP_METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH'] as const;

/** One header row, as the `ArrayFieldSchema` control persists it. */
export type HttpHeader = { name: string; value: string };

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

export type WebhookConfig = {
  /** Absent means POST — the only thing this node could do before the widening. */
  method?: HttpMethod;
  url: string;
  headers?: HttpHeader[];
  /**
   * Free text, template-resolved like every other field, so it can carry
   * `{{trigger.guest_name}}` or `{{nodes.<id>.value}}`. Sent with
   * `Content-Type: application/json` unless a header row overrides it; the node
   * does not parse or validate it, because a body the receiver accepts is
   * between them and the receiver.
   */
  body: string;
  /** Opt in to reading the answer back. See the note above. */
  captureResponse?: boolean;
};

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
export const SECRET_BEARING_NODE_TYPES: readonly string[] = ['action.webhook'];

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

/**
 * `action.sumit_create_document` — issue an accounting document.
 *
 * Every field mirrors a name in swagger.json's `Accounting_Documents_Create_Request`
 * chain; nothing here was invented. The node NEVER carries credentials: the port
 * reads them from `app_settings`, the same reader the close-charge uses.
 *
 * ⚠️ NO MONEY MOVES. This records a document; it does not charge a card. The
 * `Payments[]` array the API also accepts is deliberately NOT exposed — on a
 * receipt it asserts that money was received, and a workflow that can assert
 * that without a charge having happened is a bookkeeping hazard, not a feature.
 */
export type SumitCreateDocumentConfig = {
  /** `Accounting_Typed_DocumentType`. See DOCUMENT_TYPES for why the list is narrowed. */
  documentType: SumitDocumentTypeOption;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  /** `Customer.ExternalIdentifier` — the anchor that ties the document back to us. */
  customerExternalId?: string;
  /** `Customer.NoVAT` — spec: "Set to true for VAT exempt customers". */
  customerNoVat?: boolean;
  itemName?: string;
  itemQuantity?: number;
  itemUnitPrice?: number;
  /**
   * `Details.Description` — printed on the document.
   *
   * NOT named `description`: every node already carries its own `description`
   * (the caption the owner reads on the canvas), and one object cannot hold
   * both. The document's text is the one that gets the qualified name, because
   * the node-level field is shared by all 21 node types.
   */
  documentDescription?: string;
  /** `Details.IsDraft` — spec: "Leave empty for final document". */
  isDraft?: boolean;
  /** `Details.SendByEmail`. */
  sendByEmail?: boolean;
};

/** `action.sumit_create_customer` — `Accounting_Typed_Customer`, creating side only. */
export type SumitCreateCustomerConfig = {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  city?: string;
  address?: string;
  /** `CompanyNumber` — spec: "Customer registered company number (VAT number)". */
  companyNumber?: string;
  externalId?: string;
  noVat?: boolean;
};

/**
 * The document types this node may issue.
 *
 * NARROWER than the API's 23-value enum, and narrower on purpose twice over:
 *
 *   • Expense and supplier documents describe something WE bought. An outgoing
 *     automation has no business writing one.
 *   • `Invoice` / `InvoiceAndReceipt` are חשבונית מס, which an עוסק פטור may
 *     not issue (the business's status — see the tax notes on close-charge).
 *     They are absent so the editor cannot offer them, rather than present with
 *     a warning nobody reads.
 *
 * `Receipt` (קבלה) is the document this business actually issues.
 */
export const SUMIT_DOCUMENT_TYPES = [
  'Receipt',
  'ProformaInvoice',
  'PriceQuotation',
  'PaymentRequest',
  'Order',
  'DeliveryNote',
  'CreditReceipt',
] as const;
export type SumitDocumentTypeOption = (typeof SUMIT_DOCUMENT_TYPES)[number];

// The discriminated union the step handlers narrow on. `BaseNode.config` in the
// vendored runner is `unknown`; this is the vocabulary we give it.
export type KalfaNodeConfig =
  | { type: 'trigger.whatsapp_inbound'; config: WhatsappInboundConfig }
  | { type: 'trigger.webhook'; config: WebhookTriggerConfig }
  | { type: 'trigger.schedule'; config: ScheduleTriggerConfig }
  | { type: 'logic.condition'; config: ConditionConfig }
  | { type: 'logic.switch'; config: SwitchConfig }
  | { type: 'action.update_guest_status'; config: UpdateGuestStatusConfig }
  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }
  | { type: 'action.microsoft_send_email'; config: MicrosoftSendEmailConfig }
  | { type: 'action.start_rsvp_ai_callback'; config: StartRsvpAiCallbackConfig }
  | { type: 'action.notify_team'; config: NotifyTeamConfig }
  | { type: 'action.webhook'; config: WebhookConfig }
  | { type: 'action.set_guest_field'; config: SetGuestFieldConfig }
  | { type: 'action.create_callback_request'; config: CreateCallbackRequestConfig }
  | { type: 'action.import_guest_list'; config: ImportGuestListConfig }
  | { type: 'logic.wait'; config: WaitConfig }
  | { type: 'action.send_template'; config: SendTemplateConfig }
  | { type: 'action.start_for_each_guest'; config: ForEachGuestConfig }
  | { type: 'logic.set_value'; config: SetValueConfig }
  | { type: 'action.sumit_create_document'; config: SumitCreateDocumentConfig }
  | { type: 'action.sumit_create_customer'; config: SumitCreateCustomerConfig };

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
  'trigger.whatsapp_inbound': { phoneNumberId: 'identifier' },
  // A HASH, not the token — so this is no longer a secret that must not travel,
  // but it still authenticates to THIS installation and resolves to nothing
  // anywhere else. See webhook-token.ts for why the value moved out.
  'trigger.webhook': { tokenHash: 'identifier' },
  'action.microsoft_send_email': { connectionId: 'identifier' },
  'action.send_template': { messageKey: 'catalogue' },
  'action.create_callback_request': { topic: 'catalogue' },
  'action.start_for_each_guest': { targetWorkflowId: 'identifier' },
  'action.webhook': { url: 'secret', headers: 'secret' },
  // Both SUMIT ids point INTO this installation: they are our own reference for
  // a customer, so a diagram carrying one would reach for a record that does not
  // exist anywhere else.
  'action.sumit_create_document': { customerExternalId: 'identifier' },
  'action.sumit_create_customer': { externalId: 'identifier' },
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
  'trigger.webhook': ['label', 'description', 'tokenHash'],
  'trigger.schedule': ['label', 'description', 'time'],
  'logic.condition': ['label', 'description', 'field', 'operator'],
  'logic.switch': ['label', 'description'],
  'logic.wait': ['label', 'description', 'amount', 'unit'],
  'logic.set_value': ['label', 'description', 'value'],
  'action.update_guest_status': ['label', 'description', 'rsvpStatus'],
  'action.send_whatsapp': ['label', 'description', 'body'],
  'action.microsoft_send_email': ['label', 'description', 'connectionId', 'to', 'subject', 'body'],
  'action.send_template': ['label', 'description', 'messageKey'],
  'action.start_rsvp_ai_callback': ['label', 'description'],
  'action.notify_team': ['label', 'description', 'title'],
  'action.webhook': ['label', 'description', 'url'],
  'action.set_guest_field': ['label', 'description', 'field'],
  'action.create_callback_request': ['label', 'description', 'topic'],
  'action.import_guest_list': ['label', 'description'],
  'action.start_for_each_guest': ['label', 'description', 'targetWorkflowId', 'maxGuests'],
  'action.start_voice_call': ['label', 'description', 'purposeKey'],
  // documentType + a customer name are the minimum SUMIT itself requires
  // (`Details.Type`, and `Customer.Name` "Required for creating a new customer").
  'action.sumit_create_document': ['label', 'description', 'documentType', 'customerName'],
  'action.sumit_create_customer': ['label', 'description', 'customerName'],
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
 * sites in `steps/index.ts`, so a node that gains the guard and is not added
 * here fails a test rather than shipping an automation that cannot run.
 */
export const GUEST_SCOPED_NODE_TYPES: readonly KalfaNodeType[] = [
  'action.update_guest_status',
  'action.send_whatsapp',
  'action.send_template',
  'action.set_guest_field',
  'action.create_callback_request',
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
 * JSON Schema expresses it with `allOf` + `if`/`then`, and `schemas.ts` emits
 * exactly that — `then` carrying BOTH `required: [field]` and a `minLength` on
 * it, so the schema alone refuses an absent body and a blank one alike.
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
 * become N entries with the same `then`, which `schemas.ts` builds by mapping
 * over `whenIn` rather than by hand.
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
  'action.webhook': [
    {
      decidedBy: 'method',
      whenIn: HTTP_METHODS_WITH_BODY,
      fallback: DEFAULT_HTTP_METHOD,
      require: 'body',
      message:
        'סוג הבקשה שנבחר שולח גוף, והגוף ריק. כתבו את גוף הבקשה, או החליפו ל-GET / DELETE שאינם שולחים גוף.',
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

/**
 * What a guest's callback request is about.
 *
 * ⚠️ CLOSED, AND THE REASON IS WHO GETS CALLED. `topic` is not a label — it is
 * the ROUTER. `enqueueSalesCallDispatch` gates on `topic !== 'מכירות'` and
 * `enqueueMeetingConfirmDispatch` on `topic === 'מכירות'`, so the string decides
 * which ElevenLabs agent dials the person.
 *
 * The node is guest-scoped: `requireGuestContext` refuses it without an event
 * and a contact, and the port reads `guests.full_name` / `guests.phone`. So the
 * person on the other end is always an EVENT GUEST — and `'מכירות'` would put
 * "עומר", the sales-closing agent, on the phone to a wedding guest to sell them
 * KALFA. As free text that was one natural Hebrew word away.
 *
 * Every value here routes to the callback-confirm agent, which is the one whose
 * own prompt describes this exact call: "מתקשר בנוגע לבקשה שלך לשיחה חוזרת".
 * `'מכירות'` is deliberately ABSENT, and refused again in the handler and at
 * arming, because the field lives in a jsonb row that no form re-validates.
 */
export const CALLBACK_TOPICS = [
  'שאלה על האירוע',
  'שינוי באישור ההגעה',
  'בקשה מיוחדת',
  'אחר',
] as const;
export type CallbackTopic = (typeof CALLBACK_TOPICS)[number];

/**
 * The topic that routes to the SALES agent — never valid from a guest node.
 *
 * Named rather than inlined so the two refusals and the router cannot drift:
 * this is the exact string `enqueueSalesCallDispatch` compares against.
 */
export const SALES_CALLBACK_TOPIC = 'מכירות';
