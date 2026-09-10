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
import { NodeType, getScope, sharedProperties, statusOptions } from '@workflowbuilder/sdk';
import type { NodeSchema, PaletteItem, UISchema } from '@workflowbuilder/sdk';

import { RSVP_STATUSES } from '@/lib/constants';

import {
  CONDITION_BRANCH_HANDLES,
  ACTION_BRANCH_HANDLES,
  ERROR_POLICIES,
  NODE_STATUSES,
  UNARY_CONDITION_OPERATORS,
  type ConditionField,
  type ConditionOperator,
  type KalfaNodeType,
} from './types';

// ---------------------------------------------------------------------------
// Option sets — the same `{ label, value }` shape the SDK's own statusOptions use
// ---------------------------------------------------------------------------

// Indexed by NAME, not by position in the tuple. The previous form read
// `CONDITION_FIELDS[0]`, `[1]`, `[2]` … which is correct exactly as long as
// nobody inserts an entry — and this list just grew from two to seven. Naming
// the member makes a reorder a type error instead of a silently relabelled
// dropdown.
// Per-step Active / Draft / Disabled.
//
// `NODE_STATUSES` was declared early and then wired to nothing — the field
// existed in the vocabulary, appeared in no form, and was read by no runner.
// Every built-in node in the vendor's library carries it (`nodes/decision.md`,
// `nodes/delay.md`: "Status  Dropdown  Active / Draft / Disabled"), and the SDK
// exports the canonical option set WITH its status icons, which is why the
// `value` and `icon` here are taken from `statusOptions` rather than retyped.
// Only the labels are ours, for the same reason as the error policy: the SDK
// ships English inside the JSON schema, where i18n cannot reach.
const nodeStatusOptions = {
  active: { label: 'פעיל', value: statusOptions.active.value, icon: statusOptions.active.icon },
  draft: { label: 'טיוטה', value: statusOptions.draft.value, icon: statusOptions.draft.icon },
  disabled: {
    label: 'מושבת',
    value: statusOptions.disabled.value,
    icon: statusOptions.disabled.icon,
  },
} as const satisfies Record<(typeof NODE_STATUSES)[number], { label: string; value: string; icon: string }>;

// The two handles an action node draws, as DATA — the same mechanism already
// proven on `logic.condition`, whose branches were verified rendering on a live
// canvas. `templateType: NodeType.DecisionNode` on the palette entry turns each
// array member into a labelled handle.
//
// The error handle is what makes `errorPolicy: 'errorRoute'` reachable at all.
// It leaves the editor as `source:inner:error` and the adapter rewrites it to
// the runner's reserved `errorRoute` — see ACTION_BRANCH_HANDLES.
const actionBranches = [
  { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'הצליח' },
  { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
] as const;

const actionBranchesProperty = {
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
} as const;

const statusProperty = {
  status: { type: 'string', options: Object.values(nodeStatusOptions) },
} as const;

// The one control, spelled once. Every node's uischema ends with it, so the
// switch sits in the same place on every panel.
function statusControl(scope: string): UISchema {
  return { type: 'Select', scope, label: 'מצב הצעד' };
}

const conditionFieldOptions = {
  message_text: { label: 'תוכן ההודעה', value: 'message_text' },
  button_payload: { label: 'כפתור שנלחץ', value: 'button_payload' },
  guest_name: { label: 'שם האורח', value: 'guest_name' },
  event_name: { label: 'שם האירוע', value: 'event_name' },
  event_date: { label: 'תאריך האירוע', value: 'event_date' },
  contactId: { label: 'מזהה איש קשר', value: 'contactId' },
  eventId: { label: 'מזהה אירוע', value: 'eventId' },
} as const satisfies Record<ConditionField, { label: string; value: ConditionField }>;

const conditionOperatorOptions = {
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

// Hebrew labels, authored here rather than taken from the SDK's exported
// `errorPolicyProperty`. That fragment ships English strings ("Fail workflow")
// inside the JSON schema, where our i18n bundle cannot reach them — i18n
// translates SDK chrome, not schema option labels. The `value` strings are the
// SDK's own, because the runner compares against those.
const errorPolicyOptions = {
  fail: { label: 'עצור את כל התהליך', value: ERROR_POLICIES[0] },
  continue: { label: 'המשך, וסמן את ההרצה כהושלמה', value: ERROR_POLICIES[1] },
  errorRoute: { label: 'המשך במסלול השגיאה', value: ERROR_POLICIES[2] },
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
    ...statusProperty,
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
    statusControl(triggerScope('properties.status')),
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
    ...statusProperty,
    left: { type: 'string' },
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
    {
      // The escape hatch from the dropdown, and the reason the dropdown is no
      // longer a ceiling. `nodes/conditional.md` describes both sides of a
      // comparison as free values that may reference earlier nodes; this is that
      // side. Left blank, the dropdown above is used — which is how every
      // diagram saved before this keeps behaving.
      type: 'VariableText',
      scope: conditionScope('properties.left'),
      label: 'או השוו ערך משלכם (גובר על הבחירה למעלה)',
      placeholder: "למשל {{nodes.<id>.value}} או {{trigger.guest_name}}",
    },
    { type: 'Select', scope: conditionScope('properties.operator'), label: 'התנאי' },
    {
      // Also a VariableText: the right-hand side is as free as the left, so a
      // condition can compare one node's output against another's.
      type: 'VariableText',
      scope: conditionScope('properties.value'),
      label: 'ערך',
      // The unary operators take no operand. Hiding the box is the difference
      // between a form that explains itself and one that invites a value it will
      // ignore. Spelled as an enum rather than a const because there are now two
      // such operators and a `const` rule would only ever hide for one of them.
      rule: {
        effect: 'HIDE',
        condition: {
          scope: conditionScope('properties.operator'),
          schema: { enum: [...UNARY_CONDITION_OPERATORS] },
        },
      },
    },
    statusControl(conditionScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// action.update_guest_status
// ---------------------------------------------------------------------------

const updateGuestStatusSchema = {
  type: 'object',
  // `rsvpStatus`, not `status`. The SDK reserves `status` for the node's own
  // Active/Draft/Disabled lifecycle — it is in `statusOptions` and drives the
  // status badge — and this node happened to have picked the same word for the
  // guest's RSVP. Two different meanings under one key in one object is a bug
  // waiting for whoever reads it next, so ours moved. `readRsvpStatus` in the
  // handler still accepts the old key, because diagrams saved before this carry
  // it.
  required: ['label', 'description', 'rsvpStatus'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    rsvpStatus: { type: 'string', options: Object.values(rsvpStatusOptions) },
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
      scope: updateGuestStatusScope('properties.rsvpStatus'),
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
    statusControl(updateGuestStatusScope('properties.status')),
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
    ...statusProperty,
    ...actionBranchesProperty,
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
    statusControl(sendWhatsappScope('properties.status')),
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
    ...statusProperty,
    ...actionBranchesProperty,
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
    statusControl(notifyTeamScope('properties.status')),
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
    ...statusProperty,
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
    statusControl(setValueScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// action.start_rsvp_ai_callback
// ---------------------------------------------------------------------------

const startRsvpAiCallbackSchema = {
  type: 'object',
  required: ['label', 'description'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;
const startRsvpAiCallbackScope = getScope<typeof startRsvpAiCallbackSchema>;
const startRsvpAiCallbackUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: startRsvpAiCallbackScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Label',
      text: 'מפעיל את סוכן RSVP הקולי הקיים דרך Voximplant ו-ElevenLabs. המודל, מאגר הידע והכלים מוגדרים בסוכן ואינם נשמרים בתהליך.',
    },
    {
      type: 'Label',
      text: 'השיחה אסינכרונית. הצעד מחזיר את תוצאת ההפעלה; ניתוח השיחה נשמר לאחר מכן דרך ה-webhook הקיים של ElevenLabs.',
    },
    {
      type: 'Select',
      scope: startRsvpAiCallbackScope('properties.errorPolicy'),
      label: 'אם הפעלת השיחה נכשלת',
    },
    statusControl(startRsvpAiCallbackScope('properties.status')),
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
      status: nodeStatusOptions.active.value,
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
    //   * `outputSchema` USED to be withheld here, on the reasoning that "the
    //     picker would suggest references nothing can resolve". That held only
    //     while `resolve-template.ts` was unvendored; it is vendored and wired
    //     into `activity-runner.ts`, and the node has declared its output ever
    //     since. This bullet remained as a description of a state that no longer
    //     existed — see the declaration below.
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
      status: nodeStatusOptions.active.value,
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
    // Rendered as a decision node so the failure branch has a handle to leave
    // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
    // which is a guaranteed dead end — the reason the option was withheld.
    templateType: NodeType.DecisionNode,
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
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'עדכון סטטוס אורח',
      description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
      rsvpStatus: rsvpStatusOptions.attending.value,
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.send_whatsapp' satisfies KalfaNodeType,
    // Rendered as a decision node so the failure branch has a handle to leave
    // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
    // which is a guaranteed dead end — the reason the option was withheld.
    templateType: NodeType.DecisionNode,
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
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'שליחת הודעת וואטסאפ',
      description: 'משיב לאורח ששלח את ההודעה',
      body: '',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.start_rsvp_ai_callback' satisfies KalfaNodeType,
    templateType: NodeType.DecisionNode,
    label: 'הפעלת סוכן RSVP קולי',
    description: 'מפעיל שיחה חוזרת באמצעות סוכן ה-RSVP הקולי הקיים',
    icon: 'PhoneCall',
    schema: startRsvpAiCallbackSchema,
    uischema: startRsvpAiCallbackUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        started: { type: 'boolean', label: 'הופעלה' },
        status: { type: 'string', label: 'סטטוס הפעלה' },
        reason: { type: 'string', label: 'סיבה' },
        attemptId: { type: 'string', label: 'מזהה ניסיון שיחה' },
        callSessionHistoryId: { type: 'number', label: 'מזהה שיחת Voximplant' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'הפעלת סוכן RSVP קולי',
      description: 'מפעיל שיחה חוזרת באמצעות סוכן ה-RSVP הקולי הקיים',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.notify_team' satisfies KalfaNodeType,
    // Rendered as a decision node so the failure branch has a handle to leave
    // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
    // which is a guaranteed dead end — the reason the option was withheld.
    templateType: NodeType.DecisionNode,
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
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
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
      status: nodeStatusOptions.active.value,
      label: 'קביעת ערך',
      description: 'מחשב ערך אחד לשימוש בצעדים הבאים',
      value: '',
    },
  },
];
