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

export type ConditionConfig = {
  field: ConditionField;
  operator: ConditionOperator;
  // Unused by 'is_empty'. Kept optional rather than a union so the property form
  // can show one shape and hide the field with a JSONForms rule.
  value?: string;
};

export type UpdateGuestStatusConfig = {
  status: RsvpStatus;
};

// The discriminated union the step handlers narrow on. `BaseNode.config` in the
// vendored runner is `unknown`; this is the vocabulary we give it.
export type KalfaNodeConfig =
  | { type: 'trigger.whatsapp_inbound'; config: WhatsappInboundConfig }
  | { type: 'logic.condition'; config: ConditionConfig }
  | { type: 'action.update_guest_status'; config: UpdateGuestStatusConfig };

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
   */
  isTrigger: boolean;
};
