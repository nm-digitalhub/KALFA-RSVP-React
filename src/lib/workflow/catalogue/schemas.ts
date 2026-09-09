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
import { NodeType, getScope, sharedProperties } from '@workflowbuilder/sdk';
import type { NodeSchema, PaletteItem, UISchema } from '@workflowbuilder/sdk';

import { RSVP_STATUSES } from '@/lib/constants';

import {
  CONDITION_BRANCH_HANDLES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  ERROR_POLICIES,
  type KalfaNodeType,
} from './types';

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

// Hebrew labels, authored here rather than taken from the SDK's exported
// `errorPolicyProperty`. That fragment ships English strings ("Fail workflow")
// inside the JSON schema, where our i18n bundle cannot reach them — i18n
// translates SDK chrome, not schema option labels. The `value` strings are the
// SDK's own, because the runner compares against those.
const errorPolicyOptions = {
  fail: { label: 'עצור את כל התהליך', value: ERROR_POLICIES[0] },
  continue: { label: 'המשך, וסמן את ההרצה כהושלמה', value: ERROR_POLICIES[1] },
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
    // The node's two outgoing ports, declared as DATA because that is what the
    // SDK's decision renderer reads. `templateType: 'decision-node'` on the
    // palette item below draws one labelled handle per entry of this array —
    // which is the only way this editor can produce an edge whose `sourceHandle`
    // is anything but the bare 'source'. Without it both branches leave the node
    // on the same handle and the runner cannot tell them apart.
    //
    // Not exposed in the uischema: there is no `DecisionBranches` control below,
    // so the owner sees the two handles on the canvas but cannot add, rename or
    // delete them from the properties panel. That is deliberate — this node's
    // meaning is binary, and `logic.condition`'s handler routes to exactly these
    // two ids.
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
    // Surfaced on THIS node only. Upstream's guidance is to spread the fragment
    // "on node types that should surface the choice; omit it elsewhere — the
    // runner defaults to 'fail' when the field is absent."
    //
    // The trigger is excluded because a trigger that throws has produced no run
    // to continue. The condition is excluded for a sharper reason: under
    // 'continue' the runner schedules EVERY outgoing edge, so a condition that
    // failed would fire both branches at once and the guest would be marked
    // attending and declined in the same run.
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
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
    {
      type: 'Select',
      scope: updateGuestStatusScope('properties.errorPolicy'),
      label: 'אם הצעד נכשל',
    },
    // The label above says what is chosen; this says what it costs. 'continue'
    // does not retry and does not recover — the guest's status stays unwritten
    // and only the run's own verdict changes. Without this line the option
    // reads like a safety net.
    {
      type: 'Label',
      text: 'בחירה ב"המשך" לא כותבת את הסטטוס — היא רק מונעת מהכשל לסמן את ההרצה ככושלת. הכשל עצמו עדיין נרשם ביומן.',
    },
  ],
};

// ---------------------------------------------------------------------------
// action.send_whatsapp
// ---------------------------------------------------------------------------

const sendWhatsappSchema = {
  type: 'object',
  required: ['label', 'description', 'body'],
  properties: {
    ...sharedProperties,
    body: { type: 'string' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

const sendWhatsappScope = getScope<typeof sendWhatsappSchema>;

const sendWhatsappUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: sendWhatsappScope('properties.label'), label: 'שם הצעד' },
    {
      // `VariableTextArea`, and this is the control the SDK ships for exactly
      // this shape. Typing `{{` opens the variable picker; the picker writes
      // `{{nodes.<id>.<field>}}`; `activity-runner.ts` resolves it against the
      // live execution context before this handler ever sees the string.
      //
      // It was `TextArea` until the resolver was vendored, because the picker
      // would have written a reference the adapter then refused to run.
      type: 'VariableTextArea',
      scope: sendWhatsappScope('properties.body'),
      label: 'ההודעה שתישלח',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
      minRows: 3,
    },
    {
      type: 'Label',
      text: 'ההודעה נשלחת לאורח ששלח את ההודעה הנכנסת, ורק לו. אין אפשרות לבחור נמען אחר.',
    },
    {
      type: 'Select',
      scope: sendWhatsappScope('properties.errorPolicy'),
      label: 'אם השליחה נכשלת',
    },
  ],
};

// ---------------------------------------------------------------------------
// action.notify_team
// ---------------------------------------------------------------------------

const notifyLevelOptions = {
  info: { label: 'מידע', value: 'info' },
  warn: { label: 'אזהרה', value: 'warn' },
  error: { label: 'שגיאה', value: 'error' },
} as const;

const notifyTeamSchema = {
  type: 'object',
  required: ['label', 'description', 'title'],
  properties: {
    ...sharedProperties,
    title: { type: 'string' },
    detail: { type: 'string' },
    level: { type: 'string', options: Object.values(notifyLevelOptions) },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

const notifyTeamScope = getScope<typeof notifyTeamSchema>;

const notifyTeamUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: notifyTeamScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Text',
      scope: notifyTeamScope('properties.title'),
      label: 'כותרת ההתראה',
      placeholder: 'למשל: אורח כתב משהו שלא זוהה',
    },
    {
      type: 'VariableTextArea',
      scope: notifyTeamScope('properties.detail'),
      label: 'פירוט',
      placeholder: 'הקלידו {{ כדי לצטט ערך מהצעדים הקודמים',
      minRows: 3,
    },
    { type: 'Select', scope: notifyTeamScope('properties.level'), label: 'רמה' },
    {
      type: 'Label',
      // Not a caveat — a fact an owner needs before writing the title. Slack
      // suppresses a repeated title inside the dedup window, so a per-message
      // alert with a fixed title arrives once and then goes quiet.
      text: 'ההתראה נשלחת לערוץ הצוות בלבד ולא לאורח. כותרת זהה שחוזרת נדחסת לפי חלון הכיווץ של ההתראות.',
    },
    { type: 'Select', scope: notifyTeamScope('properties.errorPolicy'), label: 'אם ההתראה נכשלת' },
  ],
};

// ---------------------------------------------------------------------------
// logic.set_value
// ---------------------------------------------------------------------------

const setValueSchema = {
  type: 'object',
  required: ['label', 'description', 'value'],
  properties: {
    ...sharedProperties,
    value: { type: 'string' },
  },
} satisfies NodeSchema;

const setValueScope = getScope<typeof setValueSchema>;

const setValueUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: setValueScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'VariableTextArea',
      scope: setValueScope('properties.value'),
      label: 'הערך',
      placeholder: 'למשל: שלום {{trigger.guest_name}}, מה שלומך?',
      minRows: 2,
    },
    {
      type: 'Label',
      text: 'הצעד לא שולח ולא כותב דבר — הוא מחשב ערך אחד שצעדים אחרי־כן יכולים לצטט.',
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
    // Renders with the SDK's start-node body, which draws ONE handle —
    // `type: 'source'` — where the default body draws a source AND a target.
    // The target dot on a trigger is an affordance for a connection rule 6
    // forbids and `isValidConnection` always rejects: the owner can aim at it,
    // and nothing lands. This removes the dot instead of refusing the drop, so
    // the rule is visible rather than merely enforced.
    //
    // Not `isStartNode: true` — that field does not exist in 2.3.0 (it is
    // queued in an unreleased changeset), and even once it does it is a data
    // marker the editor writes into `data`, which rule 3 forbids us to read.
    // `templateType` is only ever about the visual template, which upstream
    // states explicitly, so the two concerns stay separate.
    templateType: NodeType.StartNode,
    schema: triggerSchema,
    uischema: triggerUiSchema,
    // The trigger's output is the inbound message itself. With this declared,
    // `{{nodes.<trigger-id>.message_text}}` appears in the picker — note that
    // `{{trigger.message_text}}` reaches the SAME value by the other namespace,
    // which upstream's guide warns are not interchangeable in general.
    outputSchema: {
      type: 'default',
      properties: {
        message_text: { type: 'string', label: 'תוכן ההודעה', description: 'מה שהאורח כתב' },
        button_payload: { type: 'string', label: 'כפתור שנלחץ' },
      },
    },
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
    // Renders with the SDK's built-in decision body instead of the default
    // one-in/one-out node. `jb(paletteType, templateType, customTemplates)`
    // in the SDK resolves this to the React Flow node type at drop time, so the
    // node gets the branch handles, the OptionalNodeContent slot our execution
    // badges mount into, and the NodeAsPortWrapper drag behaviour — none of
    // which a hand-written `nodeTemplates` entry would have kept.
    // `NodeType` is an enum (a VALUE), not a string union — the literal
    // 'decision-node' does not type-check even though it is the same string.
    //
    // This is the vendor's own canonical shape for a branching node, not an
    // invention: apps/demo/src/app/data/nodes/decision/ declares exactly
    // `templateType: NodeType.DecisionNode` plus a `decisionBranches` array of
    // `{ id, sourceHandle, label, conditions }`. Two deliberate differences:
    //
    //   * We omit `conditions` from the item shape and the `DecisionBranches`
    //     control from the uischema. Their branch conditions are `{x, y,
    //     comparisonOperator}` strings resolved through `resolveTemplate`, which
    //     we did not vendor — an owner typing `{{trigger.x}}` there would get
    //     literal text. Our condition evaluates server-side from
    //     `field`/`operator`/`value` instead, so the branches are fixed.
    //   * We omit `outputSchema` for the reason recorded at the top of this
    //     file: it is what puts a node in the variable picker, and the picker
    //     would suggest references nothing can resolve.
    //
    // The starter (examples/workflow-builder-starter) has a node also called
    // "condition", and it is NOT this pattern — it is a single-output node with
    // a free-text `condition` string and no runner behind it. Modelling a
    // branching node on it is what produced the dead-branch defect this entry
    // now fixes.
    templateType: NodeType.DecisionNode,
    schema: conditionSchema,
    uischema: conditionUiSchema,
    // Declared so the variable picker can OFFER this node's output instead of
    // making an owner type a node id by hand. Declaring it also makes the shape
    // a deliberate contract: renaming `result` now breaks saved workflows, so
    // the name is chosen once and kept.
    outputSchema: {
      type: 'default',
      properties: {
        result: {
          type: 'boolean',
          label: 'תוצאת התנאי',
          description: 'האם התנאי התקיים',
        },
      },
    },
    defaultPropertiesData: {
      label: 'תנאי',
      description: 'מפצל את התהליך לשני מסלולים',
      field: conditionFieldOptions.message_text.value,
      operator: conditionOperatorOptions.contains.value,
      value: '',
      // Seeded, and never generated. The SDK's own "add branch" mints
      // `crypto.randomUUID()` for both fields; ours are fixed so the worker can
      // name the port it wants without reading the diagram. `id` is only React's
      // list key. The labels are what the owner reads beside each handle.
      decisionBranches: [
        { id: 'true', sourceHandle: CONDITION_BRANCH_HANDLES.true, label: 'מתקיים' },
        { id: 'false', sourceHandle: CONDITION_BRANCH_HANDLES.false, label: 'לא מתקיים' },
      ],
    },
  },
  {
    type: 'action.update_guest_status' satisfies KalfaNodeType,
    label: 'עדכון סטטוס אורח',
    description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
    icon: 'UserCheck',
    schema: updateGuestStatusSchema,
    uischema: updateGuestStatusUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        guestId: { type: 'string', label: 'מזהה האורח', description: 'האורח שעודכן' },
        status: { type: 'string', label: 'הסטטוס שנקבע' },
      },
    },
    defaultPropertiesData: {
      label: 'עדכון סטטוס אורח',
      description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
      status: rsvpStatusOptions.attending.value,
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.send_whatsapp' satisfies KalfaNodeType,
    label: 'שליחת הודעת וואטסאפ',
    description: 'משיב לאורח ששלח את ההודעה',
    icon: 'WhatsappLogo',
    schema: sendWhatsappSchema,
    uischema: sendWhatsappUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        sent: { type: 'boolean', label: 'נשלח', description: 'האם ההודעה התקבלה אצל Meta' },
      },
    },
    defaultPropertiesData: {
      label: 'שליחת הודעת וואטסאפ',
      description: 'משיב לאורח ששלח את ההודעה',
      body: '',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.notify_team' satisfies KalfaNodeType,
    label: 'התראה לצוות',
    description: 'שולח הודעה לערוץ הצוות',
    icon: 'Bell',
    schema: notifyTeamSchema,
    uischema: notifyTeamUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        sent: { type: 'boolean', label: 'נשלח', description: 'האם ההתראה יצאה או נדחסה' },
      },
    },
    defaultPropertiesData: {
      label: 'התראה לצוות',
      description: 'שולח הודעה לערוץ הצוות',
      title: '',
      detail: '',
      level: notifyLevelOptions.warn.value,
      errorPolicy: errorPolicyOptions.continue.value,
    },
  },
  {
    type: 'logic.set_value' satisfies KalfaNodeType,
    label: 'קביעת ערך',
    description: 'מחשב ערך אחד לשימוש בצעדים הבאים',
    icon: 'Tag',
    schema: setValueSchema,
    uischema: setValueUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        value: { type: 'string', label: 'הערך', description: 'הערך שחושב' },
      },
    },
    defaultPropertiesData: {
      label: 'קביעת ערך',
      description: 'מחשב ערך אחד לשימוש בצעדים הבאים',
      value: '',
    },
  },
];
