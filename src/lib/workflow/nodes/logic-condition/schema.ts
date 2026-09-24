'use client';

// `logic.condition` — the JSON schema of its properties panel, and the two
// option lists it offers. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields, type ConditionField, type ConditionOperator } from './definition';

// Indexed by NAME, not by position in the tuple. The previous form read
// `CONDITION_FIELDS[0]`, `[1]`, `[2]` … which is correct exactly as long as
// nobody inserts an entry — and this list just grew from two to seven. Naming
// the member makes a reorder a type error instead of a silently relabelled
// dropdown.
export const conditionFieldOptions = {
  message_text: { label: 'תוכן ההודעה', value: 'message_text' },
  button_payload: { label: 'כפתור שנלחץ', value: 'button_payload' },
  guest_name: { label: 'שם האורח', value: 'guest_name' },
  event_name: { label: 'שם האירוע', value: 'event_name' },
  event_date: { label: 'תאריך האירוע', value: 'event_date' },
  contactId: { label: 'מזהה איש קשר', value: 'contactId' },
  eventId: { label: 'מזהה אירוע', value: 'eventId' },
} as const satisfies Record<ConditionField, { label: string; value: ConditionField }>;

export const conditionOperatorOptions = {
  contains: { label: 'מכיל', value: 'contains' },
  not_contains: { label: 'לא מכיל', value: 'not_contains' },
  equals: { label: 'שווה ל־', value: 'equals' },
  not_equals: { label: 'שונה מ־', value: 'not_equals' },
  starts_with: { label: 'מתחיל ב־', value: 'starts_with' },
  ends_with: { label: 'מסתיים ב־', value: 'ends_with' },
  is_empty: { label: 'ריק', value: 'is_empty' },
  is_not_empty: { label: 'אינו ריק', value: 'is_not_empty' },
} as const satisfies Record<
  ConditionOperator,
  { label: string; value: ConditionOperator }
>;

export const conditionSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    left: { type: 'string' },
    field: { ...requiredText, options: Object.values(conditionFieldOptions) },
    operator: { ...requiredText, options: Object.values(conditionOperatorOptions) },
    value: { type: 'string' },
    // The node's two outgoing ports, declared as DATA because that is what the
    // SDK's decision renderer reads. `templateType: 'decision-node'` on the
    // palette item (`logic-condition.ts`) draws one labelled handle per entry of
    // this array — which is the only way this editor can produce an edge whose
    // `sourceHandle` is anything but the bare 'source'. Without it both branches
    // leave the node on the same handle and the runner cannot tell them apart.
    //
    // Not exposed in the uischema: there is no `DecisionBranches` control in
    // `uischema.ts`, so the owner sees the two handles on the canvas but cannot
    // add, rename or delete them from the properties panel. That is deliberate —
    // this node's meaning is binary, and `logic.condition`'s handler routes to
    // exactly these two ids.
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceHandle: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
} satisfies NodeSchema;

export type ConditionSchema = typeof conditionSchema;
