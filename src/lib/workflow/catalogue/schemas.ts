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
import {
  NodeType,
  errorPolicyProperty,
  getScope,
  sharedProperties,
  statusOptions,
} from '@workflowbuilder/sdk';
import type { NodeSchema, PaletteItem, UISchema } from '@workflowbuilder/sdk';

import { RSVP_STATUSES } from '@/lib/constants';

import { CHECKBOX_LIST_FORMAT, HEADER_ROWS_FORMAT } from './ui-formats';

import {
  ACTION_BRANCH_HANDLES,
  CALLBACK_TOPICS,
  CONDITION_BRANCH_HANDLES,
  ERROR_POLICIES,
  HTTP_METHODS,
  NODE_NUMBER_RANGES,
  NODE_REQUIRED_FIELDS,
  NODE_STATUSES,
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
  UNARY_CONDITION_OPERATORS,
  WAIT_UNIT_VALUES,
  WHATSAPP_MESSAGE_KINDS,
  type ConditionField,
  type ConditionOperator,
  type GuestField,
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

/**
 * ⚠️ OUR HAND-WRITTEN LIST, PINNED TO THE SDK'S.
 *
 * `ERROR_POLICIES` lives in `catalogue/types.ts` because the SERVER reads it and
 * the server must not reach this file — `schemas.ts` imports SDK runtime values
 * and resolves to a client reference when imported from a server module, which
 * is what `server-code-must-not-reach-the-editor-schemas` exists to stop. So the
 * list is written twice: once here in a shape the SDK owns, once there in a
 * shape the server can hold.
 *
 * Nothing guarded the two against each other. The values are not decorative —
 * the vendored runner compares `node.errorPolicy` against exactly these strings
 * (graph-runner.ts `resolveErrorPolicy`), so an SDK release that renames or adds
 * one would leave every node carrying a policy the runner no longer understands,
 * with a green build and a green test suite.
 *
 * `errorPolicyProperty` is the SDK's own declaration of that union. Assigning
 * across it in both directions is a compile-time check that costs nothing at run
 * time and fails the moment the two disagree.
 */
type SdkErrorPolicy = (typeof errorPolicyProperty)['errorPolicy']['options'][number]['value'];
type OurErrorPolicy = (typeof ERROR_POLICIES)[number];
const _errorPoliciesMatchTheSdk: [SdkErrorPolicy, OurErrorPolicy] = [
  null as unknown as OurErrorPolicy,
  null as unknown as SdkErrorPolicy,
];
void _errorPoliciesMatchTheSdk;

// GET/DELETE carry no body — the port drops it rather than sending an empty one.
const httpMethodOptions = {
  POST: { label: 'POST — שליחת נתונים', value: HTTP_METHODS[0] },
  GET: { label: 'GET — קריאת נתונים', value: HTTP_METHODS[1] },
  PUT: { label: 'PUT — החלפה', value: HTTP_METHODS[2] },
  PATCH: { label: 'PATCH — עדכון חלקי', value: HTTP_METHODS[3] },
  DELETE: { label: 'DELETE — מחיקה', value: HTTP_METHODS[4] },
} as const;

const callbackTopicOptions = CALLBACK_TOPICS.map((value) => ({ label: value, value }));

const rsvpStatusOptions = {
  attending: { label: 'מגיע/ה', value: RSVP_STATUSES[0] },
  declined: { label: 'לא מגיע/ה', value: RSVP_STATUSES[1] },
  maybe: { label: 'אולי', value: RSVP_STATUSES[2] },
} as const;

// ---------------------------------------------------------------------------
// trigger.whatsapp_inbound
// ---------------------------------------------------------------------------

/**
 * One of OUR WhatsApp numbers, as the trigger's dropdown offers it.
 *
 * The VALUE is Meta's `phone_number_id`, because that is what arrives on the
 * webhook and what `matchesNumber` compares. The label is for the human.
 */
export type WhatsAppNumberOption = {
  /** Meta's phone_number_id — the stored value. */
  providerRef: string;
  /** e.g. "+972 3-721-9347 — מספר אישורי הגעה". */
  label: string;
};

// The only entry whose options are not knowable at module scope: the account's
// WhatsApp numbers are rows, and they change without a deploy. `buildPaletteItems`
// below takes them; `PALETTE_ITEMS` is the empty-list case.
const triggerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.whatsapp_inbound'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    keyword: { type: 'string', placeholder: 'השאירו ריק כדי להפעיל על כל הודעה' },
    phoneNumberId: { type: 'string' },
    // WHICH KINDS of message start this workflow. An OPEN array of Meta's own
    // `type` strings — not an enum — so a kind Meta adds later needs a catalogue
    // entry rather than a migration. Absent means the four a guest actually
    // speaks with, which is what every diagram saved before this field did.
    // ⚠️ OBJECTS, NOT BARE STRINGS, and the shape is forced on us.
    //
    // The SDK's `ArrayFieldSchema` is `{ type:'array', items:{ type:'object',
    // properties } }` — it cannot describe an array of strings at all. The first
    // version declared this shape and had the control write plain strings, so
    // every saved trigger carried a validation error on the node
    // ("Instance type \"string\" is invalid. Expected \"object\"") and showed a
    // "!" the owner could not act on.
    //
    // So the control stores `[{ value: 'document' }, …]`. `matchesKind` accepts
    // BOTH shapes, which is what keeps a workflow saved under the string version
    // matching without a migration.
    messageKinds: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} satisfies NodeSchema;

const triggerScope = getScope<typeof triggerSchema>;

function triggerSchemaFor(numbers: readonly WhatsAppNumberOption[]): NodeSchema {
  return {
    ...triggerSchema,
    properties: {
      ...triggerSchema.properties,
      phoneNumberId: {
        type: 'string',
        // '' first, and it is the default: empty means ANY number, which keeps
        // every diagram saved before this field firing exactly as it did.
        options: [
          { value: '', label: 'כל המספרים' },
          ...numbers.map((n) => ({ value: n.providerRef, label: n.label })),
        ],
      },
    },
  } as NodeSchema;
}

const triggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: triggerScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Select',
      scope: triggerScope('properties.phoneNumberId'),
      label: 'המספר שאליו נשלחה ההודעה',
    },
    {
      // The warning the owner asked for. "כל המספרים" is the compatible default,
      // not the safe one: with two live lines an RSVP automation also fires on
      // messages sent to the import line.
      type: 'Label',
      text: 'כל המספרים: התהליך ירוץ גם על הודעות שנשלחו לקו הייבוא. בחרו מספר כדי לצמצם.',
    },
    {
      type: 'Text',
      scope: triggerScope('properties.keyword'),
      label: 'הפעל רק אם ההודעה מכילה',
    },
    {
      // Collapsed: the default is right for almost every workflow, and an
      // always-open list of nine checkboxes is the first thing an owner scrolls
      // past on a node they only wanted to name.
      type: 'Accordion',
      label: 'סוגי הודעות שמפעילים את התהליך',
      elements: [
        {
          // A CUSTOM RENDERER — the SDK ships no multi-select. Declared as the
          // nearest allowed element type and outranked by ours, matched on
          // `options.format`. See checkbox-list-control.tsx.
          type: 'Text',
          scope: triggerScope('properties.messageKinds'),
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: WHATSAPP_MESSAGE_KINDS.map((k) => ({ ...k })),
            defaultNote:
              'ברירת מחדל: רק הודעות שאורח שולח — טקסט, כפתור, תפריט ותגובה. סמנו קובץ או אנשי קשר כדי לבנות תהליך שקולט רשימת אורחים.',
          },
        },
      ],
    },
    statusControl(triggerScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// trigger.webhook
// ---------------------------------------------------------------------------

const webhookTriggerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.webhook'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    token: { type: 'string' },
  },
} satisfies NodeSchema;

const webhookTriggerScope = getScope<typeof webhookTriggerSchema>;

const webhookTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: webhookTriggerScope('properties.label'), label: 'שם הצעד' },
    {
      // Plain Text and NOT VariableText: a token assembled at run time is a token
      // nobody reviewed, and the endpoint compares it in constant time against a
      // fixed value.
      type: 'Text',
      scope: webhookTriggerScope('properties.token'),
      label: 'טוקן הכתובת',
      placeholder: 'הדביקו כאן את הטוקן שנוצר',
    },
    {
      type: 'Label',
      text: 'הכתובת היא /api/workflows/hook/<הטוקן>. מי שמחזיק בטוקן יכול להריץ את התהליך — התייחסו אליו כאל סיסמה, והחליפו אותו אם דלף.',
    },
    {
      // The limitation an owner would otherwise discover from a failed run.
      type: 'Label',
      text: 'הרצה שמתחילה כאן אינה קשורה לאורח, ולכן צעדים שפועלים על אורח (עדכון סטטוס, שליחת וואטסאפ, בקשת חזרה) ייכשלו בתוכה.',
    },
    statusControl(webhookTriggerScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// logic.condition
// ---------------------------------------------------------------------------

const conditionSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['logic.condition'],
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
// action.set_guest_field
// ---------------------------------------------------------------------------

const guestFieldOptions = {
  meal_pref: { value: 'meal_pref' satisfies GuestField, label: 'העדפת מנה' },
  // The two note fields are NOT interchangeable and the labels have to say so:
  // `rsvp_note` is the guest's own note and the public RSVP page renders it;
  // `note` is the owner's private annotation and the guest never sees it.
  rsvp_note: { value: 'rsvp_note' satisfies GuestField, label: 'הערת האורח (האורח רואה)' },
  note: { value: 'note' satisfies GuestField, label: 'הערה פנימית (האורח לא רואה)' },
} as const;

const setGuestFieldSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.set_guest_field'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    field: { type: 'string', options: Object.values(guestFieldOptions) },
    value: { type: 'string' },
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, sourceHandle: { type: 'string' }, label: { type: 'string' } },
      },
    },
  },
} satisfies NodeSchema;

const setGuestFieldScope = getScope<typeof setGuestFieldSchema>;

const setGuestFieldUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: setGuestFieldScope('properties.label'), label: 'שם הצעד' },
    { type: 'Select', scope: setGuestFieldScope('properties.field'), label: 'השדה לעדכון' },
    {
      type: 'VariableText',
      scope: setGuestFieldScope('properties.value'),
      label: 'הערך',
      placeholder: 'למשל {{trigger.message_text}}',
    },
    {
      type: 'Label',
      text: 'ריק מוחק את הערך הקיים. לא ניתן לשנות מכאן סטטוס או מספר מוזמנים — לאלה יש צעד משלהם.',
    },
    { type: 'Select', scope: setGuestFieldScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
    statusControl(setGuestFieldScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// action.create_callback_request
// ---------------------------------------------------------------------------

const callbackRequestSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.create_callback_request'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    topic: { type: 'string', options: callbackTopicOptions },
    note: { type: 'string' },
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, sourceHandle: { type: 'string' }, label: { type: 'string' } },
      },
    },
  },
} satisfies NodeSchema;

const callbackRequestScope = getScope<typeof callbackRequestSchema>;

const callbackRequestUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: callbackRequestScope('properties.label'), label: 'שם הצעד' },
    { type: 'Select', scope: callbackRequestScope('properties.topic'), label: 'נושא הפנייה' },
    {
      type: 'VariableText',
      scope: callbackRequestScope('properties.note'),
      label: 'הערה למי שיחזור לאורח',
      placeholder: '{{trigger.guest_name}} כתב: {{trigger.message_text}}',
    },
    {
      // The dedupe is behaviour an owner should not discover from a support call.
      type: 'Label',
      text: 'אם כבר פתוחה בקשת חזרה לאותו מספר בשעתיים האחרונות — לא תיווצר בקשה נוספת.',
    },
    { type: 'Select', scope: callbackRequestScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
    statusControl(callbackRequestScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// action.webhook
// ---------------------------------------------------------------------------

const webhookSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.webhook'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    method: { type: 'string', options: Object.values(httpMethodOptions) },
    url: { type: 'string' },
    // The field the old design refused to have. See WebhookConfig for why it can
    // exist now: a value may be `{{secrets.<NAME>}}`, and the NAME is what is
    // stored — the secret itself is fetched at the socket and never comes back.
    headers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', label: 'שם', placeholder: 'Authorization' },
          value: { type: 'string', label: 'ערך', placeholder: 'Bearer {{secrets.ACME_API_KEY}}' },
        },
      },
    },
    body: { type: 'string' },
    captureResponse: { type: 'boolean' },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

const webhookScope = getScope<typeof webhookSchema>;

const webhookUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: webhookScope('properties.label'), label: 'שם הצעד' },
    { type: 'Select', scope: webhookScope('properties.method'), label: 'סוג הבקשה' },
    {
      // Plain Text, not VariableText: the DESTINATION must not be assembled from
      // guest data. A URL built at run time is a URL nobody reviewed, and the
      // https/private-space check would then be passing judgement on a string
      // that did not exist when the owner saved the diagram.
      type: 'Text',
      scope: webhookScope('properties.url'),
      label: 'כתובת היעד (https בלבד)',
      placeholder: 'https://example.com/hooks/kalfa',
    },
    {
      type: 'VariableTextArea',
      scope: webhookScope('properties.body'),
      label: 'גוף הבקשה',
      placeholder: '{"name":"{{trigger.guest_name}}","text":"{{trigger.message_text}}"}',
      minRows: 3,
    },
    // Collapsed by default: most calls need no header, and an always-open list
    // of empty rows is the first thing an owner has to scroll past.
    {
      type: 'Accordion',
      label: 'כותרות ואימות',
      elements: [
        {
          // A CUSTOM RENDERER, and the SDK has no built-in that could do this.
          //
          // `UISchemaControlElement` is a closed union — Text, Switch, Select,
          // DatePicker, TextArea, DynamicConditions, AiTools, DecisionBranches,
          // VariableText, VariableTextArea, MessageOnError — and not one of them
          // edits an arbitrary array of objects. So the element is declared as
          // the nearest allowed type and OUTRANKED by our own renderer, which is
          // the mechanism upstream documents on `rankWith` itself: "rank above
          // the built-ins to override a control".
          //
          // The match is on `options.format`, not on the scope: a scope-based
          // tester would silently capture any future field that happened to end
          // in the same word, while this says out loud which control is wanted.
          // See header-rows-control.tsx.
          type: 'Text',
          scope: webhookScope('properties.headers'),
          options: { format: HEADER_ROWS_FORMAT },
        },
        {
          // The instruction that makes the whole secrets design usable. Without
          // it an owner types the key itself, which is exactly what this node
          // spent a release refusing to allow.
          type: 'Label',
          text: 'לעולם אל תקלידו מפתח API כאן. כתבו {{secrets.SHEM_HASOD}} — הערך עצמו נשמר בשרת ואינו נשמר בתרשים, אינו מוצג בדפדפן ואינו נרשם ביומן ההרצה.',
        },
      ],
    },
    {
      type: 'Switch',
      scope: webhookScope('properties.captureResponse'),
      label: 'שמירת התשובה לשימוש בצעדים הבאים',
    },
    {
      type: 'Select',
      scope: webhookScope('properties.errorPolicy'),
      label: 'אם הצעד נכשל',
    },
    {
      // Same warning the other action nodes carry: 'continue' does not retry and
      // does not recover. The external system simply never heard from us, and
      // only the run's own verdict changes.
      type: 'Label',
      text: 'המשך ללא עצירה: הפנייה לא תישלח שוב, והמערכת החיצונית פשוט לא תקבל אותה.',
    },
    statusControl(webhookScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// logic.switch
// ---------------------------------------------------------------------------

// N OWNER-DEFINED BRANCHES, on the SDK's own `DecisionBranches` control.
//
// REBUILT 2026-09-13, replacing a fixed `case1/case2/case3`. The old note here
// said the branches were "NOT exposed in the uischema" because the worker named
// the ports from `SWITCH_CASE_HANDLES` without reading the diagram. That was a
// self-imposed ceiling: the handler now reads the branch the conditions selected,
// so the port list may be anything the owner builds.
//
// `conditions` is a NESTED array inside each branch — `FieldSchema` admits an
// `ArrayFieldSchema`, so this type-checks — and it must be declared, or the
// control has nowhere to persist its rows and validation strips them on save.
// Its four fields are the SDK's `DynamicCondition` exactly.
const switchSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['logic.switch'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    left: { type: 'string' },
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceHandle: { type: 'string' },
          label: { type: 'string' },
          conditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'string' },
                comparisonOperator: { type: 'string' },
                y: { type: 'string' },
                logicalOperator: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} satisfies NodeSchema;

const switchScope = getScope<typeof switchSchema>;

const switchUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: switchScope('properties.label'), label: 'שם הצעד' },
    // Kept as a convenience, NOT as the thing branches compare against: each row
    // carries its own `x`. An owner who wants one value routed several ways can
    // paste it here and reference it, and one who does not can ignore it. The
    // handler never reads it, which is why it left `required`.
    {
      type: 'VariableText',
      scope: switchScope('properties.left'),
      label: 'הערך לניתוב (לא חובה)',
      placeholder: 'למשל {{trigger.button_payload}}',
    },
    // THE control. Renders one card per branch — rename, reorder, delete — each
    // opening the SDK's condition editor with its ten operators and the variable
    // picker fed by every upstream node's `outputSchema`.
    { type: 'DecisionBranches', scope: switchScope('properties.decisionBranches') },
    statusControl(switchScope('properties.status')),
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
  required: NODE_REQUIRED_FIELDS['action.update_guest_status'],
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
  required: NODE_REQUIRED_FIELDS['action.send_whatsapp'],
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
  required: NODE_REQUIRED_FIELDS['action.notify_team'],
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
  required: NODE_REQUIRED_FIELDS['logic.set_value'],
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
  required: NODE_REQUIRED_FIELDS['action.start_rsvp_ai_callback'],
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


// ---------------------------------------------------------------------------
// action.import_guest_list
// ---------------------------------------------------------------------------

// NO BUSINESS FIELDS, and that is the design — see ImportGuestListConfig. The
// only properties are the ones every node carries: a name, a description, the
// on/off switch, the failure policy and the two branch handles.
const importGuestListSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.import_guest_list'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

const importGuestListScope = getScope<typeof importGuestListSchema>;

const importGuestListUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: importGuestListScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Label',
      text: 'קולט את הקובץ או את אנשי הקשר שהגיעו בוואטסאפ ומעלה אותם לסקירה. האורחים נוצרים רק אחרי אישור במסך הייבוא — הצעד הזה לא מוסיף אורחים בעצמו.',
    },
    {
      type: 'Label',
      text: 'דורש טריגר וואטסאפ שמסומן בו "קובץ" או "כרטיסי אנשי קשר".',
    },
    {
      type: 'Select',
      scope: importGuestListScope('properties.errorPolicy'),
      label: 'אם הקליטה נכשלת',
    },
    statusControl(importGuestListScope('properties.status')),
  ],
};


// ---------------------------------------------------------------------------
// logic.wait
// ---------------------------------------------------------------------------

const waitUnitOptions = {
  minutes: { label: 'דקות', value: WAIT_UNIT_VALUES[0] },
  hours: { label: 'שעות', value: WAIT_UNIT_VALUES[1] },
  days: { label: 'ימים', value: WAIT_UNIT_VALUES[2] },
} as const;

const waitSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['logic.wait'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    // `minimum: 1` is the form's half of the guard; the handler refuses a
    // non-positive value again, because the schema constrains what can be TYPED
    // and not what is in the jsonb row.
    amount: { type: 'number', ...NODE_NUMBER_RANGES['logic.wait']!.amount },
    unit: { type: 'string', options: Object.values(waitUnitOptions) },
  },
} satisfies NodeSchema;

const waitScope = getScope<typeof waitSchema>;

const waitUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: waitScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'HorizontalLayout',
      elements: [
        { type: 'Text', scope: waitScope('properties.amount'), label: 'כמה', inputType: 'number' },
        { type: 'Select', scope: waitScope('properties.unit'), label: 'יחידה' },
      ],
    },
    {
      // The two things an owner cannot see from the canvas and will otherwise
      // learn from a surprise.
      type: 'Label',
      text: 'ההרצה נעצרת כאן וחוזרת מעצמה. עד אז היא מופיעה כ"ממתינה" ולא כהושלמה.',
    },
    {
      type: 'Label',
      text: 'שימו לב: אם תערכו את התהליך בזמן ההמתנה, ההרצה תמשיך לפי הגרסה החדשה.',
    },
    statusControl(waitScope('properties.status')),
  ],
};


// ---------------------------------------------------------------------------
// trigger.schedule
// ---------------------------------------------------------------------------

// Sunday = 0, matching `Date.getDay()` and Israel's own week.
const scheduleDayOptions = [
  { value: '0', label: 'ראשון' },
  { value: '1', label: 'שני' },
  { value: '2', label: 'שלישי' },
  { value: '3', label: 'רביעי' },
  { value: '4', label: 'חמישי' },
  { value: '5', label: 'שישי' },
  { value: '6', label: 'שבת' },
] as const;

const scheduleSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.schedule'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    // `pattern` is the form's half; `matchesSchedule` refuses a bad value again,
    // because the schema constrains what can be TYPED and not what is in the row.
    time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', placeholder: '09:00' },
    days: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} satisfies NodeSchema;

const scheduleScope = getScope<typeof scheduleSchema>;

const scheduleUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: scheduleScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Text',
      scope: scheduleScope('properties.time'),
      label: 'שעה (24 שעות)',
      placeholder: '09:00',
    },
    {
      type: 'Accordion',
      label: 'באילו ימים',
      elements: [
        {
          type: 'Text',
          scope: scheduleScope('properties.days'),
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: scheduleDayOptions.map((d) => ({ ...d })),
            defaultNote: 'ברירת מחדל: כל יום.',
          },
        },
      ],
    },
    {
      // The two facts an owner cannot see from the canvas.
      type: 'Label',
      text: 'השעה היא לפי שעון ישראל, וממשיכה להיות נכונה גם אחרי מעבר שעון.',
    },
    {
      type: 'Label',
      text: 'הרצה מתוזמנת אינה מתחילה מאורח — צעדים שפועלים על אורח יסרבו בתוכה.',
    },
    statusControl(scheduleScope('properties.status')),
  ],
};


// ---------------------------------------------------------------------------
// action.send_template  ·  action.start_for_each_guest
// ---------------------------------------------------------------------------

// The message keys, NOT the Meta template names. A key resolves per event type
// and per language through `message_templates`, so one key sends the approved
// brit layout at a brit and the approved wedding one at a wedding.
//
// ⚠️ THE LABELS SAY WHICH ARE MARKETING. That is not decoration: a MARKETING
// template is subject to the consent gate (currently off, by the owner's
// decision) and routes through MM Lite, and an owner choosing one should know
// they are in a different regime from a reminder.
const templateKeyOptions = [
  { value: 'invite', label: 'הזמנה' },
  { value: 'reminder_1', label: 'תזכורת ראשונה' },
  { value: 'reminder_2', label: 'תזכורת שנייה' },
  { value: 'final', label: 'הודעה אחרונה לפני האירוע' },
  { value: 'event_day_pay', label: 'תשלום ביום האירוע' },
  { value: 'thankyou', label: 'תודה אחרי האירוע (שיווקי)' },
  { value: 'gift', label: 'מתנה (שיווקי)' },
] as const;

const sendTemplateSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.send_template'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    messageKey: { type: 'string', options: templateKeyOptions.map((o) => ({ ...o })) },
  },
} satisfies NodeSchema;

const sendTemplateScope = getScope<typeof sendTemplateSchema>;

const sendTemplateUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: sendTemplateScope('properties.label'), label: 'שם הצעד' },
    { type: 'Select', scope: sendTemplateScope('properties.messageKey'), label: 'איזו תבנית' },
    {
      // The distinction that decides which of the two send nodes to use, said
      // plainly — it is not visible from the canvas and gets discovered the hard
      // way otherwise.
      type: 'Label',
      text: 'תבנית אפשר לשלוח בכל זמן. "שליחת וואטסאפ" (טקסט חופשי) מותרת רק עד 24 שעות אחרי שהאורח כתב — לכן תהליך שמתחיל לפי שעון חייב תבנית.',
    },
    {
      type: 'Label',
      text: 'הטקסט עצמו מגיע מהתבנית המאושרת ולא נערך כאן. אורח שביקש הסרה לא יקבל.',
    },
    statusControl(sendTemplateScope('properties.status')),
  ],
};

const forEachGuestSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.start_for_each_guest'],
  properties: {
    ...sharedProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    targetWorkflowId: { type: 'string' },
    statuses: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
    requirePhone: { type: 'boolean' },
    // `minimum: 1` is the form's half. The handler refuses a missing or
    // non-positive cap again, and the implementation clamps to FAN_OUT_HARD_CAP
    // on top — three ceilings, because this is the node that can reach hundreds
    // of people from one press.
    maxGuests: {
      type: 'number',
      ...NODE_NUMBER_RANGES['action.start_for_each_guest']!.maxGuests,
    },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

const forEachGuestScope = getScope<typeof forEachGuestSchema>;

const forEachGuestUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: forEachGuestScope('properties.label'), label: 'שם הצעד' },
    {
      type: 'Text',
      scope: forEachGuestScope('properties.targetWorkflowId'),
      label: 'מזהה התהליך שירוץ לכל אורח',
      placeholder: 'הדביקו את המזהה מכתובת העורך',
    },
    {
      type: 'Text',
      scope: forEachGuestScope('properties.maxGuests'),
      label: 'עד כמה אורחים (חובה)',
      inputType: 'number',
    },
    {
      // The warning this node exists to carry. One press, hundreds of people.
      type: 'Label',
      text: 'שימו לב: הצעד הזה מתחיל הרצה נפרדת לכל אורח שמתאים. הריצו הרצת ניסיון לפני הפעלה — היא תראה לכמה אורחים זה יגיע.',
    },
    {
      type: 'Accordion',
      label: 'אילו אורחים',
      elements: [
        {
          type: 'Text',
          scope: forEachGuestScope('properties.statuses'),
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: Object.values(rsvpStatusOptions).map((o) => ({ value: o.value, label: o.label })),
            defaultNote: 'ברירת מחדל: כל הסטטוסים.',
          },
        },
        {
          type: 'Switch',
          scope: forEachGuestScope('properties.requirePhone'),
          label: 'רק אורחים עם טלפון',
        },
      ],
    },
    {
      type: 'Select',
      scope: forEachGuestScope('properties.errorPolicy'),
      label: 'אם הפיצול נכשל',
    },
    statusControl(forEachGuestScope('properties.status')),
  ],
};

/**
 * Built at MODULE SCOPE.
 *
 * `<WorkflowBuilder.Root nodeTypes={…} />` wants a stable reference: an array
 * rebuilt each render re-renders the palette on every diagram change, which on a
 * large graph is the difference between a canvas that drags and one that
 * stutters. This is static data, so there is nothing to recompute anyway.
 *
 * EVERY entry carries an `outputSchema`, which is what puts a node into the
 * variable picker's suggestion list. An earlier note here said the opposite —
 * "omitted deliberately, until a template resolver exists". That resolver is
 * `resolve-template.ts`: vendored, wired into `activity-runner.ts`, and proven
 * on the `nodes.` namespace by `references.test.ts`. The note described a state
 * that had already ended.
 */

// ---------------------------------------------------------------------------
// action.start_voice_call
// ---------------------------------------------------------------------------

/**
 * The purpose dropdown is a LIVE LIST, the same way the WhatsApp number picker
 * is: `voice_purposes` rows change without a deploy. `buildPaletteItems` rewrites
 * this one entry, which is why the schema is a factory and the module-scope
 * constant below offers nothing.
 */
export type VoicePurposeOption = { key: string; displayName: string };

const voiceCallSchemaFor = (purposes: readonly VoicePurposeOption[]) =>
  ({
    type: 'object',
    required: NODE_REQUIRED_FIELDS['action.start_voice_call'],
    properties: {
      ...sharedProperties,
      ...statusProperty,
      ...actionBranchesProperty,
      errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
      purposeKey: {
        type: 'string',
        options: purposes.map((p) => ({ label: p.displayName, value: p.key })),
      },
      // Off by default, and the default is the point: this node has dialled and
      // carried straight on since it shipped. Making the wait automatic would
      // change how live automations behave without anyone editing them.
      waitForOutcome: { type: 'boolean' },
    },
  }) satisfies NodeSchema;

const voiceCallSchema = voiceCallSchemaFor([]);
const voiceCallScope = getScope<typeof voiceCallSchema>;

const voiceCallUiSchema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Text', scope: voiceCallScope('properties.label'), label: 'שם הצעד' },
    { type: 'Select', scope: voiceCallScope('properties.purposeKey'), label: 'ייעוד השיחה' },
    {
      type: 'Switch',
      scope: voiceCallScope('properties.waitForOutcome'),
      label: 'להמתין לתוצאת השיחה לפני המשך',
      // ⚠️ HIDDEN UNTIL A PURPOSE IS CHOSEN, through JsonForms' own rule engine
      // rather than a custom renderer. Waiting for the outcome of a call that
      // has no agent behind it is not a choice an owner can meaningfully make,
      // and a switch they can flip before the thing it depends on exists is a
      // switch that teaches them the wrong order.
      //
      // `minLength: 1` and not `const`: the field ships as '' (see
      // defaultPropertiesData), so "chosen" means a non-empty string, and the
      // list it is chosen from is a live table whose values we cannot enumerate
      // here.
      //
      // ⚠️ `failWhenUndefined` IS LOAD-BEARING. @jsonforms/core states the trap
      // in its own type docs: "Most JSON Schemas will successfully validate
      // against `undefined` data", so without it a node whose `purposeKey` key
      // is absent entirely — a diagram saved before this field existed — would
      // PASS the condition and show the switch.
      rule: {
        effect: 'SHOW',
        condition: {
          scope: voiceCallScope('properties.purposeKey'),
          schema: { minLength: 1 },
          failWhenUndefined: true,
        },
      },
    },
    { type: 'Select', scope: voiceCallScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
  ],
} satisfies UISchema;

/**
 * The palette, built for a given set of WhatsApp numbers.
 *
 * A FACTORY and not a const, because one entry's dropdown is a live list: the
 * account's numbers are rows in `provider_numbers` and change without a deploy.
 *
 * ⚠️ THE SDK REQUIRES A STABLE REFERENCE for `nodeTypes` ("declare at module
 * scope or memoize" — README). A fresh array each render would re-register the
 * palette on every keystroke. The editor therefore calls this inside `useMemo`;
 * calling it in a render body would be the bug this note exists to prevent.
 */
export function buildPaletteItems(
  numbers: readonly WhatsAppNumberOption[] = [],
  /**
   * The configured voice agents, for `action.start_voice_call`'s dropdown.
   *
   * Empty means the node offers nothing to pick — which is the honest state
   * when no purpose has been set up, and the handler refuses a blank anyway.
   */
  voicePurposes: readonly VoicePurposeOption[] = [],
): PaletteItem[] {
  return PALETTE_ITEMS.map((item) => {
    if (item.type === 'trigger.whatsapp_inbound') {
      return { ...item, schema: triggerSchemaFor(numbers) };
    }
    if (item.type === 'action.start_voice_call') {
      return { ...item, schema: voiceCallSchemaFor(voicePurposes) };
    }
    return item;
  });
}

/**
 * The palette with NO numbers offered — the dropdown shows only "כל המספרים".
 *
 * Kept as the base the factory rewrites one entry of, so every other node type
 * is declared exactly once. It is also what the tests and the i18n audit read.
 */
export const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'action.start_voice_call' satisfies KalfaNodeType,
    label: 'שיחה עם סוכן קולי',
    description: 'מתקשר לאורח עם אחד הסוכנים הקוליים שהוגדרו',
    icon: 'PhoneOutgoing',
    templateType: NodeType.DecisionNode,
    schema: voiceCallSchema,
    uischema: voiceCallUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        dialed: { type: 'boolean', label: 'חויג' },
        status: { type: 'string', label: 'תוצאה' },
        reason: { type: 'string', label: 'סיבה' },
        attemptId: { type: 'string', label: 'מזהה ניסיון' },
        // ⚠️ THE FIELD TO BRANCH ON. One of completed / no_answer / failed /
        // follow_up_required, derived from the call's own report — so a diagram
        // never has to know that `sip_486` means Busy Here. The technical fields
        // below stay for debugging, not for conditions.
        outcome: { type: 'string', label: 'תוצאת השיחה' },
        // Only populated when the step waited. Narrower than `outcome`: it says
        // the call ENDED AND REPORTED, nothing about whether it went well.
        concluded: { type: 'boolean', label: 'השיחה הסתיימה ודיווחה' },
        finishReason: { type: 'string', label: 'סיבת סיום' },
        durationSec: { type: 'number', label: 'משך השיחה (שניות)' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'שיחה עם סוכן קולי',
      description: 'מתקשר לאורח עם אחד הסוכנים הקוליים שהוגדרו',
      purposeKey: '',
      waitForOutcome: false,
      errorPolicy: errorPolicyOptions.continue.value,
    },
  },
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
      // Empty = any number. The owner's ruling 2026-09-13: a diagram saved
      // before this field must not silently narrow to one line.
      phoneNumberId: '',
    },
  },
  {
    type: 'trigger.webhook' satisfies KalfaNodeType,
    label: 'קריאת Webhook נכנסת',
    description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
    icon: 'Plugs',
    templateType: NodeType.StartNode,
    schema: webhookTriggerSchema,
    uischema: webhookTriggerUiSchema,
    // The whole JSON the caller sent, under one key. Declared as an object with
    // no properties BECAUSE the shape is the caller's: a fixed field list here
    // would be the hard-coding this node exists to avoid. The picker offers
    // `{{trigger.body}}` and an owner types the path they know they send.
    outputSchema: {
      type: 'default',
      properties: {
        body: {
          type: 'object',
          label: 'גוף הבקשה',
          description: 'כל מה שנשלח — ניתן לפנות אליו כ-{{trigger.body.שם_השדה}}',
        },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'קריאת Webhook נכנסת',
      description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
      // EMPTY, never a value minted here. This module runs in the BROWSER, and a
      // token from `Math.random`/`crypto` on a page is a token whose entropy
      // nobody audited. It is generated by a Server Action instead.
      token: '',
    },
  },
  {
    type: 'trigger.schedule' satisfies KalfaNodeType,
    label: 'לפי שעון',
    description: 'מתחיל את התהליך בשעה קבועה',
    icon: 'Clock',
    // The SDK's start-node body draws one handle, no target dot — the same
    // reason the other triggers use it.
    templateType: NodeType.StartNode,
    schema: scheduleSchema,
    uischema: scheduleUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        firedAt: { type: 'string', label: 'מתי רץ', description: 'התאריך והשעה בשעון ישראל' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'לפי שעון',
      description: 'מתחיל את התהליך בשעה קבועה',
      time: '09:00',
      days: [],
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
    type: 'logic.switch' satisfies KalfaNodeType,
    label: 'ניתוב לפי תנאים',
    description: 'מפצל את התהליך לכמה מסלולים — מסלול לכל תנאי, ועוד ברירת מחדל',
    icon: 'ArrowsSplit',
    // Same renderer as the condition, and REQUIRED rather than cosmetic: without
    // it the N branches render as no handles at all, because the default node
    // body draws exactly one bare 'source'.
    templateType: NodeType.DecisionNode,
    schema: switchSchema,
    uischema: switchUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        matched: { type: 'boolean', label: 'נמצאה התאמה', description: 'האם תנאי כלשהו התקיים' },
        // A NAME now, not a number. With N owner-named branches "מסלול 3" is not
        // a fact the node knows; the label the owner typed is.
        branch: { type: 'string', label: 'שם המסלול שנבחר', description: 'ריק כאשר נבחרה ברירת המחדל' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'ניתוב לפי תנאים',
      description: 'מפצל את התהליך לכמה מסלולים — מסלול לכל תנאי, ועוד ברירת מחדל',
      left: '',
      // SEEDED, and both entries matter.
      //
      // The DEFAULT must exist from the first drop: the handler falls through to
      // it by elimination, and a node dropped with `[]` would have no port to
      // fall through to and would dead-end the run on its very first unmatched
      // value. It is last so it reads as the fall-through it is.
      //
      // One empty branch above it is the affordance: an owner who drops the node
      // sees a card to fill in rather than an empty panel and a lone "אחרת". Its
      // `conditions: []` never matches until the owner writes a row, which is the
      // same rule the SDK's own "add branch" produces.
      //
      // `source:inner:<id>` is `getHandleId({ handleType: 'source', innerId })` —
      // spelled as a constant here because this module's worker-side twin
      // (`types.ts`) must not import the SDK. Branches the OWNER adds get theirs
      // minted by the control, in this same shape.
      decisionBranches: [
        { id: 'branch-1', sourceHandle: 'source:inner:branch-1', label: 'מסלול ראשון', conditions: [] },
        {
          id: SWITCH_DEFAULT_BRANCH_ID,
          sourceHandle: SWITCH_DEFAULT_HANDLE,
          label: 'אחרת',
          conditions: [],
        },
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
    type: 'action.set_guest_field' satisfies KalfaNodeType,
    templateType: NodeType.DecisionNode,
    label: 'עדכון שדה אורח',
    description: 'כותב ערך לשדה אחד של האורח ששלח את ההודעה',
    icon: 'NotePencil',
    schema: setGuestFieldSchema,
    uischema: setGuestFieldUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        updated: { type: 'boolean', label: 'עודכן', description: 'ריק כאשר למספר יותר מאורח אחד' },
        field: { type: 'string', label: 'השדה שעודכן' },
        guestId: { type: 'string', label: 'מזהה האורח' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'עדכון שדה אורח',
      description: 'כותב ערך לשדה אחד של האורח ששלח את ההודעה',
      field: guestFieldOptions.meal_pref.value,
      value: '',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.create_callback_request' satisfies KalfaNodeType,
    templateType: NodeType.DecisionNode,
    label: 'בקשת חזרה לאורח',
    description: 'מוסיף את האורח לתור שיחות החזרה של הצוות',
    icon: 'PhoneCall',
    schema: callbackRequestSchema,
    uischema: callbackRequestUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        created: { type: 'boolean', label: 'נוצרה בקשה', description: 'ריק כאשר כבר קיימת בקשה פתוחה' },
        reason: { type: 'string', label: 'סיבה' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'בקשת חזרה לאורח',
      description: 'מוסיף את האורח לתור שיחות החזרה של הצוות',
      topic: 'פנייה מתהליך אוטומטי',
      note: '',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.webhook' satisfies KalfaNodeType,
    // Decision node so the failure branch has a handle to leave from — the same
    // reason every other action node uses this renderer.
    templateType: NodeType.DecisionNode,
    label: 'קריאת HTTP',
    description: 'קורא למערכת חיצונית — עם אימות, אם צריך',
    icon: 'ShareNetwork',
    schema: webhookSchema,
    uischema: webhookUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        ok: { type: 'boolean', label: 'הצליח', description: 'האם התקבלה תשובת 2xx' },
        status: { type: 'number', label: 'קוד התגובה' },
        reason: { type: 'string', label: 'סיבת הכישלון' },
        // Declared unconditionally even though it is written only when the owner
        // turned the switch on: outputSchema is static palette data and cannot
        // vary per node instance. Offering it always is the lesser fault — the
        // reference resolves to '' on a node that did not capture, which the `?`
        // and `| default:` modifiers both handle, whereas withholding it would
        // hide a real field from the picker on every node that DID capture.
        body: { type: 'string', label: 'גוף התשובה', description: 'רק אם הופעלה שמירת התשובה' },
        truncated: { type: 'boolean', label: 'התשובה נחתכה', description: 'התשובה ארוכה מ-8KB' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'קריאת HTTP',
      description: 'קורא למערכת חיצונית — עם אימות, אם צריך',
      // POST explicitly, rather than left absent: the reader defaults an absent
      // method to POST for diagrams saved before the field existed, but a NEW
      // node should say what it does rather than rely on that.
      method: httpMethodOptions.POST.value,
      url: '',
      body: '',
      // No seeded empty row. The control adds one on demand, and a node that
      // needs no header should not persist `headers: [{name:'',value:''}]`.
      headers: [],
      captureResponse: false,
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'action.import_guest_list' satisfies KalfaNodeType,
    // Decision node so the failure branch has a handle to leave from — a file
    // that will not parse is the case an owner most wants to route somewhere.
    templateType: NodeType.DecisionNode,
    label: 'קליטת רשימת אורחים',
    description: 'מעלה לסקירה קובץ או אנשי קשר שהגיעו בוואטסאפ',
    icon: 'UsersThree',
    schema: importGuestListSchema,
    uischema: importGuestListUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        // Declared so the variable picker OFFERS it: a later step can post the
        // list onward, or a condition can branch on it. `array` is a real
        // VariableType in the SDK, not a widening.
        rows: { type: 'array', label: 'הרשימה עצמה', description: 'שם, טלפון, כמות וקבוצה לכל שורה' },
        rowCount: { type: 'number', label: 'כמה שורות נקלטו' },
        errorCount: { type: 'number', label: 'כמה שורות עם שגיאה' },
        fileName: { type: 'string', label: 'שם הקובץ', description: 'ריק כשנשלחו אנשי קשר' },
        reviewUrl: { type: 'string', label: 'קישור לסקירה ואישור' },
        created: { type: 'boolean', label: 'נקלט עכשיו', description: 'שקר אם הרשימה כבר נקלטה קודם' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'קליטת רשימת אורחים',
      description: 'מעלה לסקירה קובץ או אנשי קשר שהגיעו בוואטסאפ',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  },
  {
    type: 'logic.wait' satisfies KalfaNodeType,
    label: 'המתנה',
    description: 'עוצר את התהליך וממשיך אותו מאוחר יותר',
    icon: 'Hourglass',
    schema: waitSchema,
    uischema: waitUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        waited: { type: 'boolean', label: 'ההמתנה הסתיימה' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'המתנה',
      description: 'עוצר את התהליך וממשיך אותו מאוחר יותר',
      amount: 1,
      unit: waitUnitOptions.days.value,
    },
  },
  {
    type: 'action.send_template' satisfies KalfaNodeType,
    label: 'שליחת תבנית',
    description: 'שולח לאורח תבנית מאושרת — אפשרי בכל זמן',
    icon: 'ChatCircleText',
    schema: sendTemplateSchema,
    uischema: sendTemplateUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        sent: { type: 'boolean', label: 'נשלח' },
        reason: { type: 'string', label: 'למה לא נשלח' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'שליחת תבנית',
      description: 'שולח לאורח תבנית מאושרת — אפשרי בכל זמן',
      messageKey: 'reminder_1',
    },
  },
  {
    type: 'action.start_for_each_guest' satisfies KalfaNodeType,
    // Decision node so a failure has a handle to leave from — a fan-out that
    // could not read the guest list is exactly the case worth routing.
    templateType: NodeType.DecisionNode,
    label: 'הרצה לכל אורח',
    description: 'מתחיל תהליך נפרד לכל אורח שמתאים',
    icon: 'UsersThree',
    schema: forEachGuestSchema,
    uischema: forEachGuestUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        started: { type: 'number', label: 'כמה הרצות התחילו' },
        matched: { type: 'number', label: 'כמה אורחים התאימו' },
        capped: { type: 'boolean', label: 'נעצר בתקרה', description: 'היו יותר אורחים מהתקרה' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'הרצה לכל אורח',
      description: 'מתחיל תהליך נפרד לכל אורח שמתאים',
      targetWorkflowId: '',
      statuses: [],
      requirePhone: true,
      // A deliberately SMALL default. A number an owner has to raise on purpose
      // is a number they have thought about.
      maxGuests: 25,
      errorPolicy: errorPolicyOptions.fail.value,
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
