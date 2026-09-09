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
  'logic.condition',
  'action.update_guest_status',
  'action.send_whatsapp',
  'action.notify_team',
  'logic.set_value',
] as const;

export type KalfaNodeType = (typeof NODE_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type configuration, narrowed by `type`
// ---------------------------------------------------------------------------

// Fields of the trigger payload a condition may read. A closed set rather than a
// free path: the payload's shape is ours, and an unbounded accessor would be an
// invitation to reach into something that is not there and fail at run time
// instead of at save time.
export const CONDITION_FIELDS = ['message_text', 'button_payload'] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = [
  'contains',
  'equals',
  'not_equals',
  'is_empty',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type WhatsappInboundConfig = {
  // Optional pre-filter: run only when the message contains this text. Empty or
  // absent means every inbound message on the account starts a run.
  keyword?: string;
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
  field: ConditionField;
  operator: ConditionOperator;
  // Unused by 'is_empty'. Kept optional rather than a union so the property form
  // can show one shape and hide the field with a JSONForms rule.
  value?: string;
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
// `BaseNode.errorPolicy` in the vendored runner accepts THREE values —
// 'fail' | 'continue' | 'errorRoute' — and the SDK exports a ready-made schema
// fragment (`errorPolicyProperty`) offering all three in a Select. We expose
// two, deliberately.
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
export const ERROR_POLICIES = ['fail', 'continue'] as const;
export type ErrorPolicy = (typeof ERROR_POLICIES)[number];

export type UpdateGuestStatusConfig = {
  status: RsvpStatus;
};

// The reply the workflow sends back to the guest who wrote in.
//
// One field, and no recipient among them: the recipient is ALWAYS the contact
// that started this run. A workflow cannot be pointed at an arbitrary phone
// number, which is what keeps an automation from becoming a broadcast tool.
export type SendWhatsappConfig = {
  body: string;
};

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
  | { type: 'logic.condition'; config: ConditionConfig }
  | { type: 'action.update_guest_status'; config: UpdateGuestStatusConfig }
  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }
  | { type: 'action.notify_team'; config: NotifyTeamConfig }
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
