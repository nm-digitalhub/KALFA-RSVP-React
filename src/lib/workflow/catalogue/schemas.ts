'use client';

// The editor's half of the catalogue: what each node type looks like in the
// palette and in the properties panel.
//
// CLIENT ONLY. `sharedProperties` and `getScope` are runtime values, so this
// module loads @workflowbuilder/sdk — and with it the module-level
// `immer.setAutoFreeze(false)` and `i18next.init`. The worker reads ./nodes.ts,
// which imports nothing.
//
// Written against the SDK's own vocabulary, verified against
// `dist/index.d.ts` and against how the reference app's own nodes are built
// (apps/demo/src/app/data/nodes/delay/{schema,uischema,select-options}.ts):
//
//   * `...sharedProperties` supplies `label` and `description`, which
//     `NodePropertiesSchema` REQUIRES on every node. Hand-rolling them and
//     omitting `description` is a contract violation that only a `satisfies`
//     catches.
//   * A select is `options: [{ label, value, icon? }]` on the FIELD, plus
//     `{ type: 'Select', scope }` in the uischema. There is no `oneOf`, no
//     `enum`, and no `title` in `FieldSchema` — those are generic JSONForms
//     conventions this SDK does not use.
//   * Visible text lives in the UISCHEMA (`label`, `placeholder`, and
//     `{ type: 'Label', text }`), never in the JSON schema.
//   * Scopes come from `getScope<Schema>('properties.x')` — a typed path, not a
//     hand-written `#/properties/x` string.
//
// Every entry ends in `satisfies NodeSchema` / typed as `PaletteItem`, so a
// mistake here is a compile error rather than an empty properties panel.
import { getScope, sharedProperties } from '@workflowbuilder/sdk';
import type { NodeSchema, PaletteItem, UISchema } from '@workflowbuilder/sdk';

import { RSVP_STATUSES } from '@/lib/constants';

import { CONDITION_FIELDS, CONDITION_OPERATORS, type KalfaNodeType } from './types';

// ---------------------------------------------------------------------------
// Option sets — the same `{ label, value }` shape the SDK's own statusOptions use
// ---------------------------------------------------------------------------

const conditionFieldOptions = {
  message_text: { label: 'תוכן ההודעה', value: CONDITION_FIELDS[0] },
  button_payload: { label: 'כפתור שנלחץ', value: CONDITION_FIELDS[1] },
} as const;

const conditionOperatorOptions = {
  contains: { label: 'מכיל', value: CONDITION_OPERATORS[0] },
  equals: { label: 'שווה ל־', value: CONDITION_OPERATORS[1] },
  not_equals: { label: 'שונה מ־', value: CONDITION_OPERATORS[2] },
  is_empty: { label: 'ריק', value: CONDITION_OPERATORS[3] },
} as const;

const rsvpStatusOptions = {
  attending: { label: 'מגיע/ה', value: RSVP_STATUSES[0] },
  declined: { label: 'לא מגיע/ה', value: RSVP_STATUSES[1] },
  maybe: { label: 'אולי', value: RSVP_STATUSES[2] },
} as const;

// ---------------------------------------------------------------------------
// trigger.whatsapp_inbound
// ---------------------------------------------------------------------------

const triggerSchema = {
  type: 'object',
  required: ['label', 'description'],
  properties: {
    ...sharedProperties,
    keyword: { type: 'string', placeholder: 'השאירו ריק כדי להפעיל על כל הודעה' },
  },
} satisfies NodeSchema;

const triggerScope = getScope<typeof triggerSchema>;

const triggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: triggerScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Text',
      scope: triggerScope('properties.keyword'),
      label: 'הפעל רק אם ההודעה מכילה',
    },
  ],
};

// ---------------------------------------------------------------------------
// logic.condition
// ---------------------------------------------------------------------------

const conditionSchema = {
  type: 'object',
  required: ['label', 'description', 'field', 'operator'],
  properties: {
    ...sharedProperties,
    field: { type: 'string', options: Object.values(conditionFieldOptions) },
    operator: { type: 'string', options: Object.values(conditionOperatorOptions) },
    value: { type: 'string' },
  },
} satisfies NodeSchema;

const conditionScope = getScope<typeof conditionSchema>;

const conditionUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: conditionScope('properties.label'), label: 'שם הצעד' },
    { type: 'Select', scope: conditionScope('properties.field'), label: 'בדוק את' },
    { type: 'Select', scope: conditionScope('properties.operator'), label: 'התנאי' },
    {
      type: 'Text',
      scope: conditionScope('properties.value'),
      label: 'ערך',
      // 'is_empty' takes no operand. Hiding the box is the difference between a
      // form that explains itself and one that invites a value it will ignore.
      rule: {
        effect: 'HIDE',
        condition: {
          scope: conditionScope('properties.operator'),
          schema: { const: conditionOperatorOptions.is_empty.value },
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// action.update_guest_status
// ---------------------------------------------------------------------------

const updateGuestStatusSchema = {
  type: 'object',
  required: ['label', 'description', 'status'],
  properties: {
    ...sharedProperties,
    status: { type: 'string', options: Object.values(rsvpStatusOptions) },
  },
} satisfies NodeSchema;

const updateGuestStatusScope = getScope<typeof updateGuestStatusSchema>;

const updateGuestStatusUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: updateGuestStatusScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Select',
      scope: updateGuestStatusScope('properties.status'),
      label: 'הסטטוס החדש',
    },
  ],
};

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

/**
 * Built at MODULE SCOPE.
 *
 * `<WorkflowBuilder.Root nodeTypes={…} />` wants a stable reference: an array
 * rebuilt each render re-renders the palette on every diagram change, which on a
 * large graph is the difference between a canvas that drags and one that
 * stutters. This is static data, so there is nothing to recompute anyway.
 *
 * No `outputSchema` on any entry, deliberately: it is what puts a node into the
 * variable picker's suggestion list, and until a template resolver exists a
 * suggested `{{nodes.x.y}}` would be stored as literal text and sent verbatim.
 * The adapter rejects such a reference anyway; omitting this means the owner is
 * never offered one.
 */
export const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'trigger.whatsapp_inbound' satisfies KalfaNodeType,
    label: 'הודעת וואטסאפ נכנסת',
    description: 'מתחיל את התהליך כשאורח שולח הודעה',
    icon: 'WhatsappLogo',
    schema: triggerSchema,
    uischema: triggerUiSchema,
    defaultPropertiesData: {
      label: 'הודעת וואטסאפ נכנסת',
      description: 'מתחיל את התהליך כשאורח שולח הודעה',
      keyword: '',
    },
  },
  {
    type: 'logic.condition' satisfies KalfaNodeType,
    label: 'תנאי',
    description: 'מפצל את התהליך לשני מסלולים',
    icon: 'GitBranch',
    schema: conditionSchema,
    uischema: conditionUiSchema,
    defaultPropertiesData: {
      label: 'תנאי',
      description: 'מפצל את התהליך לשני מסלולים',
      field: conditionFieldOptions.message_text.value,
      operator: conditionOperatorOptions.contains.value,
      value: '',
    },
  },
  {
    type: 'action.update_guest_status' satisfies KalfaNodeType,
    label: 'עדכון סטטוס אורח',
    description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
    icon: 'UserCheck',
    schema: updateGuestStatusSchema,
    uischema: updateGuestStatusUiSchema,
    defaultPropertiesData: {
      label: 'עדכון סטטוס אורח',
      description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
      status: rsvpStatusOptions.attending.value,
    },
  },
];
