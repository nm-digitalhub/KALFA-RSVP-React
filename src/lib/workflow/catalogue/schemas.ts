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

import {
  CHECKBOX_LIST_FORMAT,
  HEADER_ROWS_FORMAT,
  INTEGRATION_CONNECTION_FORMAT,
  NODE_RUN_FORMAT,
  TRIGGER_SWITCH_FORMAT,
  WEBHOOK_TOKEN_FORMAT,
} from './ui-formats';

import {
  ACTION_BRANCH_HANDLES,
  CALLBACK_TOPICS,
  CONDITION_BRANCH_HANDLES,
  ERROR_POLICIES,
  HTTP_METHODS,
  HTTP_METHODS_WITH_BODY,
  NODE_CONDITIONAL_REQUIRED_FIELDS,
  NODE_NUMBER_RANGES,
  ARM_NOTICE_PATH,
  NODE_REQUIRED_FIELDS,
  type SumitDocumentTypeOption,
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
  type MicrosoftMailContentType,
  type MicrosoftMailImportance,
  AI_AGENT_MAX_TURNS,
  aiAgentModelOptions,
  webhookMethodOptions,
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

/**
 * A string field the arm gate refuses when blank — so the panel refuses it too.
 *
 * ⚠️ `required` ALONE WAS INERT IN THE EDITOR, AND THIS IS MEASURED.
 *
 * JSON Schema's `required` tests KEY PRESENCE and nothing else. Every node is
 * dropped from the palette with `defaultPropertiesData` seeding its fields as
 * `''`, so the key is always there. Verified against @cfworker/json-schema
 * 4.1.1 — the validator the SDK actually bundles, listed in its own
 * `package.json` dependencies, not Ajv: a schema of `{required:['url']}`
 * validates `{url:''}` as VALID, and the same object with `url` absent as
 * invalid. So an HTTP node dragged out with an empty URL showed no error marker
 * at all, and `NODE_REQUIRED_FIELDS` was decorative here.
 *
 * `arm-check.ts` has refused exactly this case from the start — its line tests
 * `value.trim() === ''`, and its own comment calls it "the one JSON Schema's own
 * `required` does NOT catch". The owner therefore learned about the blank at
 * ARMING time, about a field the panel had called fine.
 *
 * `minLength: 1` says the same thing where the value is typed. It invents no
 * rule: every field it guards is one the arm gate already blocks.
 * `required-fields-editable.test.ts` pins the two lists against each other.
 *
 * ⚠️ AND `pattern` ALONGSIDE `minLength`, BECAUSE THE TWO GATES COUNTED
 * DIFFERENTLY. `minLength: 1` counts CHARACTERS, so '   ' is three of them and
 * validates clean; `arm-check.ts` tests `value.trim() === ''` and refuses the
 * same value. A field holding only spaces was therefore accepted by the panel
 * and rejected at arming — the exact divergence `minLength` was added to close,
 * reappearing one step further in.
 *
 * `'\\S'` is unanchored, so it reads as "contains at least one non-whitespace
 * character", which is `trim() !== ''` stated in JSON Schema. `time` spreads
 * this and overrides `pattern` with its own stricter HH:MM rule, which excludes
 * whitespace by construction.
 */
const requiredText = { type: 'string', minLength: 1, pattern: '\\S' } as const;

/**
 * The `allOf` block for one node type, built from its conditional contracts.
 *
 * ⚠️ ONE `if` PER VALUE, BECAUSE `SchemaCondition` HAS ONLY `const`. The SDK
 * types it as `{ properties: Record<string, { const?: string|number|boolean }> }`
 * — there is no `enum` — so "POST, PUT or PATCH" is three entries sharing one
 * `then`, mapped from the declaration rather than written out.
 *
 * ⚠️ `then` CARRIES BOTH `required` AND THE FIELD CONSTRAINT, because
 * `properties` alone never makes a key mandatory — it constrains the value only
 * when the key is there. With both, the schema refuses an absent body and a
 * blank one alike.
 *
 * The SDK types `ConditionalSchema` as `{ properties: … }` with no root
 * `required`. It compiles anyway and needs no cast: excess-property checking
 * applies to fresh literals at the assignment site, and this is a function
 * return, so it is compared structurally — extra members are allowed.
 * `conditional-required.test.ts` proves the runtime honours it.
 */
function conditionalRules(nodeType: KalfaNodeType) {
  return (NODE_CONDITIONAL_REQUIRED_FIELDS[nodeType] ?? []).flatMap((rule) =>
    rule.whenIn.map((value) => ({
      if: { properties: { [rule.decidedBy]: { const: value } } },
      then: { required: [rule.require], properties: { [rule.require]: requiredText } },
    })),
  );
}

/** `label` + `description`, both required on every node type. */
const identityProperties = {
  ...sharedProperties,
  label: requiredText,
  description: requiredText,
  /**
   * The anchor a NODE-LEVEL refusal hangs on, and nothing ever writes to it.
   *
   * ⚠️ IT EXISTS BECAUSE THE VENDOR'S DISPLAY MECHANISM IS ADDRESSED BY SCOPE.
   * The SDK hands our `data.properties.customErrors` to JsonForms as
   * `additionalErrors`, and a message reaches the panel only through a control
   * whose `scope` matches that error's `instancePath` — its own source says so:
   * *"an exclamation mark will be shown on the node, and an error message will
   * be displayed in the sidebar"*, with `instancePath:
   * '/missingPreviousVariable'` in the example.
   *
   * Two of our arm refusals are genuinely not about any one field — a
   * guest-scoped step under a guestless trigger (the fact lives in ANOTHER
   * node), and a keyword no message kind can satisfy (a contradiction BETWEEN
   * two fields). They carried `instancePath: ''`, so the owner got an
   * exclamation mark on the node with no sentence anywhere, until they pressed
   * "arm". This is the property those two now address.
   *
   * ⚠️ NOT IN `NODE_REQUIRED_FIELDS`, NOT IN ANY `defaultPropertiesData`, AND
   * NEVER EDITED. It is a scope to aim at, not a value — `armNoticeControl`
   * below renders only when an error names it, so on a clean node the panel is
   * byte-identical to what it was.
   */
  armNotice: { type: 'string' },
} as const;



// The one control, spelled once. Every node's uischema ends with it, so the
// switch sits in the same place on every panel.
function statusControl(scope: string): UISchema {
  return { type: 'Select', scope, label: 'מצב הצעד' };
}

/**
 * The two fields every node carries and the owner may edit: what the step is
 * called, and the line under it.
 *
 * ⚠️ `description` WAS REQUIRED ON ALL EIGHTEEN NODE TYPES AND EDITABLE ON NONE,
 * and every part of that sentence was measured before this control was added.
 *
 *   • REQUIRED: it appears in all 18 entries of `NODE_REQUIRED_FIELDS`, so
 *     `arm-check.ts` refuses to arm a workflow whose node has it blank.
 *   • USER-VISIBLE: the SDK's node body renders it. `fs({ label, description })`
 *     in the 2.3.0 bundle emits `<span class="title">{label}</span>` followed by
 *     `<span class="subtitle">{description}</span>`, and all four node templates
 *     — default, decision, start and collapsible — call it. It is the second
 *     line on every card on the canvas.
 *   • NOT DEFAULT TEXT: the live database holds ELEVEN distinct descriptions
 *     across 22 stored nodes — "מחפש את המילה כן בגוף ההודעה" on a condition,
 *     five different ones across five `notify_team` nodes. They are real,
 *     per-node sentences.
 *   • AND WRITTEN ONLY BY US: every one of those strings is authored in
 *     `templates.ts` or in a palette `defaultPropertiesData`. The owner could
 *     read the subtitle on the card and had no way to change it, because no
 *     uischema declared a control for it — measured: 0 of 18.
 *
 * So the model said "the owner supplies this", the canvas showed it to them,
 * the arm gate refused a blank one, and the panel offered no way to type it.
 * This closes that, in our own layout rather than through the SDK's
 * `generalInformation` fragment — that one ships an English label inside the
 * schema and folds title/status/description into an Accordion, which is a
 * different panel shape on all 18 nodes and a change nobody asked for.
 *
 * `Text` and not `TextArea`, matching the SDK's own reference node: the value
 * renders as a single-line subtitle on a card, so a multi-line box would invite
 * text the canvas then truncates.
 */
function identityControls(labelScope: string, descriptionScope: string): UISchema[] {
  return [
    {
      // ⚠️ THE VENDOR'S OWN CONTROL, WITH NO `text` — that is the whole trick.
      // Its renderer is `t(text) || errors || text`, so a hardcoded `text` WINS
      // over the error's own message and an absent one falls through to it:
      // `t(undefined)` returns `''`, which is falsy. Our sentence is the one
      // that depends on the agent (which trigger, which kinds), so it has to
      // come from `customErrors[].message` rather than from here.
      //
      // ⚠️ IT RENDERS NOTHING UNLESS AN ERROR NAMES ITS SCOPE. The control
      // returns null while `errors.length === 0`, and only `syncArmBlockerMarkers`
      // ever writes one — so this line costs a clean node nothing at all.
      //
      // ⚠️ FIRST, ABOVE THE NAME FIELD. A refusal about the whole node is not a
      // note about its label; putting it under the fields would make the owner
      // scroll past the thing they are being told is wrong.
      //
      // The scope is derived rather than passed so that adding this cost no call
      // site a change — every uischema already spreads `identityControls`, and
      // the alternative was editing twenty-two of them by hand.
      type: 'MessageOnError',
      scope: labelScope.replace(/label$/, ARM_NOTICE_PATH.slice(1)),
    },
    { type: 'Text', scope: labelScope, label: 'שם הצעד' },
    {
      type: 'Text',
      scope: descriptionScope,
      label: 'תיאור הצעד',
      placeholder: 'השורה שמופיעה מתחת לשם על גבי הכרטיס',
    },
  ];
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
    ...identityProperties,
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

// "מה מפעיל את התהליך" — the switcher that lets an owner change a trigger node
// into a different KIND of trigger without rebuilding the diagram.
//
// ⚠️ DECLARED ONCE AND SPREAD INTO ALL THREE TRIGGER UISCHEMAS, so a fourth
// trigger cannot ship without it by omission. The uischema carries NO list of
// the available triggers: the control derives them from the palette itself, so
// this stays a single element with no catalogue data duplicated three times.
//
// ⚠️ A `Label`, WITH `text` THAT IS NEVER DRAWN. The value it edits is
// `data.type`, which is node data rather than a `data.properties.*` field, so
// there is no scope for a control to bind to. The SDK's closed element union
// has no "render something here" member other than `Label`, and the custom
// renderer replaces it wholesale — the same shape `NODE_RUN_FORMAT` uses, for
// the same reason. `text` exists because the type requires one.
const triggerSwitchElement = {
  type: 'Label',
  text: '',
  options: { format: TRIGGER_SWITCH_FORMAT },
} as const;

const triggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(triggerScope('properties.label'), triggerScope('properties.description')),
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
      // ⚠️ AN ACCORDION IS COLLAPSIB-LE, NOT COLLAPSED — measured in the 2.3.0
      // bundle, and this comment used to claim the opposite. The renderer
      // (`GH`) passes the layout NOTHING but `label` and `children`; the
      // container (`Ag`) declares `defaultOpen = true` and is the only thing
      // that decides. `AccordionLayoutElement` has no `defaultOpen` field, so
      // the uischema cannot ask for closed — writing one here would be a silent
      // no-op, which `accordion-classification.test.ts` refuses.
      //
      // The container is still right: nine checkboxes are an ADVANCED filter
      // that the default already answers for almost every workflow, and the
      // owner can fold them away after reading them once. What it does not do
      // is spare them the first read.
      type: 'Accordion',
      label: 'סוגי הודעות שמפעילים את התהליך',
      elements: [
        {
          // A CUSTOM RENDERER — the SDK ships no multi-select. Declared as the
          // nearest allowed element type and outranked by ours, matched on
          // `options.format`. See checkbox-list-control.tsx.
          type: 'Text',
          scope: triggerScope('properties.messageKinds'),
          label: 'סוגי הודעות',
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
    ...identityProperties,
    ...statusProperty,
    // WHERE the caller proves itself. See `WEBHOOK_AUTH_MODES`: `header` is the
    // default and what every diagram saved before this field means, `address`
    // exists for a caller that can be handed a URL and nothing else.
    auth: {
      type: 'string',
      options: [
        { value: 'header', label: 'סוד בכותרת (מומלץ)' },
        { value: 'address', label: 'הכתובת עצמה היא הסוד' },
      ],
    },
    // ⚠️ THE PUBLIC HALF OF THE ADDRESS, AND SAFE TO EXPORT — IN `header` MODE.
    // `/api/workflows/hook/<endpointId>` identifies WHICH webhook and proves
    // nothing, so the panel shows it always and a diagram may carry it anywhere.
    //
    // ⚠️ NOT `requiredText`, AND NOT BECAUSE IT IS OPTIONAL. It is required in
    // `header` mode and forbidden in `address` mode, which is a CONDITIONAL
    // contract — declared once in `NODE_CONDITIONAL_REQUIRED_FIELDS` and applied
    // to this schema by the same `allOf` machinery `action.webhook` uses. A
    // `required` here would fire in both modes and make `address` unarmable.
    endpointId: { type: 'string' },
    // WHICH HTTP METHODS open this address. Objects, not bare strings, for the
    // reason `messageKinds` records at length: the SDK's `ArrayFieldSchema`
    // cannot describe an array of strings at all.
    methods: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' } } } },
    // ⚠️ THE HASH, NOT THE SECRET. The diagram used to hold the credential
    // itself — and the editor's own Export menu puts a diagram in a copyable
    // box. See `webhook-token.ts`: the value is shown once at generation and
    // only its sha256 is ever stored.
    //
    // Named `tokenHash` rather than `secretHash` deliberately: it is accurate
    // either way, and renaming it would migrate a stored field without adding a
    // bit of clarity. What CHANGED is where the secret travels — a header, not
    // the path.
    tokenHash: requiredText,
  },
} satisfies NodeSchema;

const webhookTriggerScope = getScope<typeof webhookTriggerSchema>;

const webhookTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(webhookTriggerScope('properties.label'), webhookTriggerScope('properties.description')),
    {
      // ⚠️ ABOVE THE ADDRESS CONTROL, because it decides what that control is
      // for. Changing it CLEARS whatever was generated — see the control — so an
      // owner who flips it after generating has to press the button again, and
      // arming refuses until they do.
      type: 'Select',
      scope: webhookTriggerScope('properties.auth'),
      label: 'איך הקורא מזדהה',
    },
    {
      // ONE renderer for every shape this takes — the public address and the
      // secret in `header` mode, the single once-shown address in `address`
      // mode. They are created together and must never drift apart, so one
      // control creates, displays and rotates them. It binds to `tokenHash`
      // because that is the field JsonForms writes through and the one field
      // BOTH modes have; it reaches `auth` and `endpointId` on the same node.
      type: 'Text',
      scope: webhookTriggerScope('properties.tokenHash'),
      label: 'כתובת וסוד',
      options: { format: WEBHOOK_TOKEN_FORMAT },
    },
    {
      type: 'Label',
      text: 'אימות בכותרת: הכתובת גלויה וניתנת להעתקה בכל עת, והסוד נשלח ב-x-kalfa-webhook-secret ומוצג פעם אחת בלבד. יצירת סוד חדש אינה משנה את הכתובת.',
    },
    {
      // ⚠️ THE COST OF THE OTHER MODE, SPELLED OUT WHERE IT IS CHOSEN. An owner
      // who picks it is giving up exactly the thing the 2026-09-22 split was
      // built to give them back — a recoverable address — and finding that out
      // later, from a lost integration, is the failure this sentence prevents.
      type: 'Label',
      text: 'אימות לפי כתובת: הכתובת עצמה היא הסוד, מוצגת פעם אחת בלבד ואינה ניתנת לשחזור — נשמר רק גיבוב שלה. בחרו באפשרות הזו רק כשהמערכת הקוראת אינה יודעת לשלוח כותרת (למשל SUMIT). קריאת GET לא תעבוד במצב הזה.',
    },
    {
      type: 'Accordion',
      label: 'באילו שיטות אפשר לקרוא',
      elements: [
        {
          type: 'Text',
          scope: webhookTriggerScope('properties.methods'),
          label: 'שיטות HTTP',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: webhookMethodOptions.map((o) => ({ ...o })),
            defaultNote: 'ברירת מחדל: POST בלבד.',
          },
        },
        {
          type: 'Label',
          text: 'GET ו-DELETE אינם נושאים גוף. בקריאה כזו {{trigger.body}} יהיה ריק, והערכים יגיעו ב-{{trigger.query.<שם>}} מתוך הכתובת.',
        },
      ],
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
// trigger.sumit_card
// ---------------------------------------------------------------------------

// ⚠️ ONE CREDENTIAL FIELD AND NOTHING ELSE TO CONFIGURE. Folder, view and change
// type are chosen in SUMIT's own "יצירת טריגר" screen, which is where the
// filtering happens — see `SumitCardTriggerConfig`. The panel explains what to
// pick THERE rather than offering copies here that would filter nothing.
const sumitCardTriggerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.sumit_card'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    tokenHash: requiredText,
  },
} satisfies NodeSchema;

const sumitCardTriggerScope = getScope<typeof sumitCardTriggerSchema>;

/** One entry of the SUMIT trigger's output — the SDK's `OutputProperty` shape. */
export type SumitCardOutputField = {
  type: 'string' | 'number' | 'boolean' | 'datetime' | 'date' | 'object' | 'array';
  label: string;
  description?: string;
};
export type SumitCardOutput = Record<string, SumitCardOutputField>;

/** What `sumitCardTrigger` returns for any folder. */
export const SUMIT_CARD_BASE_OUTPUT = {
  folder: { type: 'number', label: 'מזהה התיקייה', description: 'התיקייה ב-SUMIT שבה הכרטיס השתנה' },
  entityId: { type: 'number', label: 'מזהה הכרטיס' },
  changeType: {
    type: 'string',
    label: 'סוג השינוי',
    description: 'כפי ש-SUMIT שולחת, למשל CreateOrUpdate',
  },
  properties: {
    type: 'object',
    label: 'שדות הכרטיס',
    description:
      'עמודות התצוגה. כל שדה הוא רשימה — {{nodes.<מזהה>.properties.שם_השדה.0}} לערך הראשון, ו-.0.Name לשם של ערך מקושר',
  },
  body: { type: 'object', label: 'כל מה שנשלח' },
} as const;

// ⚠️ `?` IS ADVISED ONLY WHERE THE FIELD CAN BE ABSENT, and that is a trade-off
// measured in the SDK, not a style. The editor finds a reference's TYPE by
// looking its path up VERBATIM in `outputSchema.properties` (`eL` in the bundle):
// `properties.Billing_Amount.0?` matches no key, so the condition editor treats
// it as text and withdraws "greater than". So `?` goes only where a missing value
// is real — `Billing_OrderDocument` came on one release and not another, and
// `Billing_PaymentDocument` has not appeared at all. The other seven arrived on
// all three live releases of 2026-09-23 (a small sample, said as such).
const PRESENT_NOTE = 'הגיע בכל הקריאות עד כה — בלי ? כדי שבתנאי יוצעו השוואות לפי הסוג';
const OPTIONAL_NOTE = 'לא תמיד נשלח (ריק בכרטיס) — הוסיפו ? בסוף הביטוי כדי שהצעד לא ייכשל';
// The enums' option labels are NOT in the schema SUMIT returns, so the codes are
// published as codes. ⚠️ `Billing_Currency` is a CRM enum: do not read it with the
// charge API's currency codes (where 1 is USD) — the measured hold was in shekels.
const ENUM_NOTE = 'קוד מספרי כפי ש-SUMIT שולחת; SUMIT לא מחזירה את שמות האפשרויות';
const HOLDS = '(תפיסות מסגרת)';

/** The "תפיסות מסגרת" folder's nine properties, as measured — see `outputSchema`. */
export const SUMIT_HOLD_FIELDS_OUTPUT = {
  'properties.Billing_Date.0': { type: 'datetime', label: `תאריך ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_Amount.0': { type: 'number', label: `סכום ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_Currency.0': { type: 'number', label: `מטבע — קוד ${HOLDS}`, description: `${ENUM_NOTE}. ${PRESENT_NOTE}` },
  'properties.Billing_Status.0': { type: 'number', label: `סטטוס — קוד ${HOLDS}`, description: `${ENUM_NOTE}. ${PRESENT_NOTE}` },
  // A string, not a path into `properties`: the handler adds it (see
  // `sumitHoldStatusLabel`). Compare the CODE above in a condition; show this.
  holdStatus: {
    type: 'string',
    label: `סטטוס — בעברית ${HOLDS}`,
    description: 'למשל "שוחררה (3)". הקוד תמיד מופיע בסוגריים; ריק כשהכרטיס לא מתיקיית תפיסות מסגרת',
  },
  holdCurrency: {
    type: 'string',
    label: `מטבע — בעברית ${HOLDS}`,
    description: 'למשל "שקל (1)". הקוד תמיד מופיע בסוגריים; ריק כשהכרטיס לא מתיקיית תפיסות מסגרת',
  },
  'properties.Billing_Customer.0.Name': { type: 'string', label: `לקוח/ה — שם ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_Customer.0.ID': { type: 'number', label: `לקוח/ה — מזהה ב-SUMIT ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_PaymentMethod.0.Name': { type: 'string', label: `אמצעי תשלום — שם ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_PaymentMethod.0.ID': { type: 'number', label: `אמצעי תשלום — מזהה ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_CreditGuyTransaction.0.Name': { type: 'string', label: `פעולה במסוף — שם ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_CreditGuyTransaction.0.ID': { type: 'number', label: `פעולה במסוף — מזהה ${HOLDS}`, description: PRESENT_NOTE },
  'properties.Billing_OrderDocument.0.Name': { type: 'string', label: `מסמך הזמנה — שם ${HOLDS}`, description: OPTIONAL_NOTE },
  'properties.Billing_OrderDocument.0.ID': { type: 'number', label: `מסמך הזמנה — מזהה ${HOLDS}`, description: OPTIONAL_NOTE },
  'properties.Billing_PaymentDocument.0.Name': { type: 'string', label: `מסמך חיוב — שם ${HOLDS}`, description: OPTIONAL_NOTE },
  'properties.Billing_PaymentDocument.0.ID': { type: 'number', label: `מסמך חיוב — מזהה ${HOLDS}`, description: OPTIONAL_NOTE },
} as const;

const sumitCardTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(
      sumitCardTriggerScope('properties.label'),
      sumitCardTriggerScope('properties.description'),
    ),
    {
      // The same control as the webhook trigger's. It asks `authModeFor`, which
      // answers `address` for this type whatever the row says — so it mints one
      // address, shows it once, and stores only the hash.
      type: 'Text',
      scope: sumitCardTriggerScope('properties.tokenHash'),
      label: 'הכתובת להדבקה ב-SUMIT',
      options: { format: WEBHOOK_TOKEN_FORMAT },
    },

    {
      // SUMIT's own help article, step for step (10442304), because every
      // choice that decides what fires is made there and not here.
      type: 'RichText',
      text:
        '**איך מחברים:** ב-SUMIT, מודול טריגרים ← **יצירת טריגר**.\n\n' +
        '1. **תיקייה ותצוגה** — התיקייה שעליה התהליך יעבוד, ותצוגה שבה הפילטרים בוחרים רק את הכרטיסים הרלוונטיים.\n' +
        '2. **השינוי שיוזם את הטריגר** — יצירה, עדכון, העברה לארכיון או מחיקה.\n' +
        '3. **שלבים לביצוע** — יצירת קריאת HTTP. הדביקו את הכתובת מלמעלה ובחרו סוג קריאה **JSON**.',
    },
    {
      type: 'Label',
      text: 'דורש ב-SUMIT מסלול "צמיחה" ומעלה, ומודולי טריגרים, API וניהול תצוגות מותקנים.',
    },
    {
      // Data minimisation, said where the choice is made: the VIEW's columns are
      // what SUMIT sends, and the whole body is stored with the run.
      type: 'Label',
      text: 'העמודות בתצוגה קובעות אילו שדות נשלחים, והכול נשמר עם ההרצה — השאירו בתצוגה רק את מה שהתהליך צריך. שדות מקושרים מתיקייה אחרת (למשל מייל מכרטיס הלקוח) לא נשלחים.',
    },
    {
      type: 'Label',
      text: 'הקריאה מ-SUMIT אינה חתומה: מי שמחזיק בכתובת יכול לשלוח כל תוכן. השתמשו בה להתראה ולבדיקה — לעולם לא כבסיס לפעולה כספית.',
    },
    {
      // The two ways this node goes quiet that nothing on the canvas shows.
      type: 'Label',
      text: 'אחרי ההדבקה, ודאו במסך "פעולות אוטומציה" ב-SUMIT שהקריאה הראשונה התקבלה. כשהתהליך כבוי הכתובת מחזירה שגיאה, ואחרי חמש שגיאות SUMIT משהה את הטריגר אצלה.',
    },
    {
      type: 'Label',
      text: 'הרצה שמתחילה כאן אינה קשורה לאורח, ולכן צעדים שפועלים על אורח (עדכון סטטוס, שליחת וואטסאפ, בקשת חזרה) ייכשלו בתוכה.',
    },
    statusControl(sumitCardTriggerScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// logic.condition
// ---------------------------------------------------------------------------

const conditionSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['logic.condition'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    left: { type: 'string' },
    field: { ...requiredText, options: Object.values(conditionFieldOptions) },
    operator: { ...requiredText, options: Object.values(conditionOperatorOptions) },
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
    ...identityControls(conditionScope('properties.label'), conditionScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    field: { ...requiredText, options: Object.values(guestFieldOptions) },
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
    ...identityControls(setGuestFieldScope('properties.label'), setGuestFieldScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    topic: { ...requiredText, options: callbackTopicOptions },
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
    ...identityControls(callbackRequestScope('properties.label'), callbackRequestScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    method: { type: 'string', options: Object.values(httpMethodOptions) },
    url: { ...requiredText },
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
    // ⚠️ UNCONSTRAINED HERE ON PURPOSE. A GET or DELETE with an empty body is
    // correct — the runtime does not send one — so the floor cannot live at the
    // top level. `allOf` below raises it to `minLength: 1` for exactly the three
    // verbs that DO send a body.
    body: { type: 'string' },
    captureResponse: { type: 'boolean' },
    ...actionBranchesProperty,
  },
  allOf: conditionalRules('action.webhook'),
} satisfies NodeSchema;

const webhookScope = getScope<typeof webhookSchema>;

const webhookUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(webhookScope('properties.label'), webhookScope('properties.description')),
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
      // ⚠️ THE RUNTIME ALREADY DROPS IT, SILENTLY. `sendOutboundWebhook` attaches
      // the body only when the verb is in `HTTP_METHODS_WITH_BODY`; on GET or
      // DELETE it is built, resolved, secret-checked — and then not sent. So the
      // panel offered a three-row editor for a field that went nowhere, with no
      // error and no run-log entry to learn from.
      //
      // ⚠️ SHOW ON THE WITH-BODY LIST, NOT HIDE ON ITS COMPLEMENT, and the two
      // are not equivalent here. `enum` is derived from the SAME constant
      // `outbound-webhook.ts` branches on, so a verb added to one side is
      // automatically handled on the other; a hand-written `['GET','DELETE']`
      // would go stale the first time a verb is added to `HTTP_METHODS`.
      //
      // ⚠️ AND NO `failWhenUndefined`, deliberately. A diagram saved before
      // `method` existed carries no value, `readMethod` falls back to
      // `DEFAULT_HTTP_METHOD` — 'POST', which IS in the with-body list — so that
      // diagram really does send its body and the box must stay visible.
      // Failing on undefined would hide a field that is in use.
      rule: {
        effect: 'SHOW',
        condition: {
          scope: webhookScope('properties.method'),
          schema: { enum: [...HTTP_METHODS_WITH_BODY] },
        },
      },
    },
    // ⚠️ THIS COMMENT USED TO BE WRONG TWICE, and both halves are worth keeping
    // as a record. It said "collapsed by default" — the renderer opens it, see
    // the trigger's message-kinds accordion for the measurement — and it said
    // the alternative was "an always-open list of empty rows to scroll past",
    // when `defaultPropertiesData` sets `headers: []` with its own comment
    // saying no empty row is seeded. The stated harm could not occur.
    //
    // The container survives its own justification: headers and secrets are a
    // genuinely advanced concern that most calls never touch, which is the case
    // an Accordion is for. It groups and it folds; it does not hide.
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
          label: 'כותרות HTTP',
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
    ...identityProperties,
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
    ...identityControls(switchScope('properties.label'), switchScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    rsvpStatus: { ...requiredText, options: Object.values(rsvpStatusOptions) },
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
    ...identityControls(updateGuestStatusScope('properties.label'), updateGuestStatusScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    body: { ...requiredText },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

const sendWhatsappScope = getScope<typeof sendWhatsappSchema>;

const sendWhatsappUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(sendWhatsappScope('properties.label'), sendWhatsappScope('properties.description')),
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
// action.microsoft_send_email
// ---------------------------------------------------------------------------

export type MicrosoftConnectionOption = {
  /** Human-readable connection name; display-only and never persisted. */
  label: string;
  /** integration_connections.id — the value persisted in connectionId. */
  value: string;
};

const microsoftContentTypeOptions = {
  Text: { label: 'טקסט רגיל', value: 'Text' },
  HTML: { label: 'HTML', value: 'HTML' },
} as const satisfies Record<MicrosoftMailContentType, { label: string; value: string }>;

const microsoftImportanceOptions = {
  normal: { label: 'רגילה', value: 'normal' },
  high: { label: 'גבוהה', value: 'high' },
  low: { label: 'נמוכה', value: 'low' },
} as const satisfies Record<MicrosoftMailImportance, { label: string; value: string }>;

const microsoftSendEmailSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.microsoft_send_email'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    connectionId: { ...requiredText },
    to: { ...requiredText },
    cc: { type: 'string' },
    bcc: { type: 'string' },
    replyTo: { type: 'string' },
    subject: { ...requiredText },
    body: { ...requiredText },
    contentType: { type: 'string', options: Object.values(microsoftContentTypeOptions) },
    importance: { type: 'string', options: Object.values(microsoftImportanceOptions) },
    saveToSentItems: { type: 'boolean' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

/**
 * The same schema with the installation's OWN connections offered on
 * `connectionId`.
 *
 * ⚠️ THE MODULE-LEVEL SCHEMA MUST NOT CARRY AN `options` KEY AT ALL, and that is
 * why this takes an OPTIONAL argument rather than defaulting to `[]`. The two
 * are not the same thing: an absent key means "this list is supplied at build
 * time", while `options: []` is a rendered dropdown that is genuinely empty —
 * an owner opening the panel would see a picker offering nothing, with no way to
 * tell a missing lookup from an account they have not connected yet.
 * `microsoft-connection.test.ts` asserts the module-level schema leaves it
 * `undefined`, so a default of `[]` here fails a test rather than shipping that
 * dropdown.
 */
export function microsoftSendEmailSchemaFor(
  connections?: readonly MicrosoftConnectionOption[],
): NodeSchema {
  return {
    ...microsoftSendEmailSchema,
    properties: {
      ...microsoftSendEmailSchema.properties,
      connectionId: {
        ...requiredText,
        ...(connections ? { options: connections.map(({ label, value }) => ({ label, value })) } : {}),
      },
    },
  } as NodeSchema;
}

const microsoftSendEmailScope = getScope<typeof microsoftSendEmailSchema>;

// ⚠️ THE FOUR REQUIRED FIELDS STAY FLAT, AND THAT IS THE HOUSE RULE, NOT A
// PREFERENCE. `accordion-classification.test.ts` measured the 2.3.0 renderer and
// settled it: `Group` belongs to the identity block alone, and an `Accordion` is
// what a grouping BECOMES — genuinely collapsible, with no way for a uischema to
// ask for closed. So wrapping `connectionId`, `to`, `subject` or `body` in either
// container would be wrong twice over: a second `Group` breaks the rule outright,
// and an `Accordion` offers to fold away fields that arming refuses without.
//
// What the two Accordions below hold is exactly what the rule permits — optional
// recipients and options almost nobody changes.
//
// ⚠️ `connectionId` KEEPS ITS `format`. That is not a layout choice: it is the
// dispatch key that replaces the SDK's Select with our own control, and that
// control is what draws the "connect an account" button inside the panel.
// Dropping it would leave an owner with no connection and no way to make one
// without leaving the editor. `microsoft-connection.test.ts` pins all three
// values.
const microsoftSendEmailUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(microsoftSendEmailScope('properties.label'), microsoftSendEmailScope('properties.description')),
    {
      type: 'Select',
      scope: microsoftSendEmailScope('properties.connectionId'),
      label: 'חיבור Microsoft 365',
      options: {
        // The custom renderer adds the OAuth entry point around the SDK's own
        // Select. These three values are catalogue configuration, not workflow
        // data, and therefore never enter the persisted node properties.
        format: INTEGRATION_CONNECTION_FORMAT,
        provider: 'microsoft',
        capability: 'mail.send',
      },
    },
    {
      type: 'VariableText',
      scope: microsoftSendEmailScope('properties.to'),
      label: 'נמען',
      placeholder: 'name@example.com',
    },
    {
      type: 'VariableText',
      scope: microsoftSendEmailScope('properties.subject'),
      label: 'נושא',
    },
    {
      type: 'VariableTextArea',
      scope: microsoftSendEmailScope('properties.body'),
      label: 'תוכן ההודעה',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
      minRows: 5,
    },
    {
      type: 'Accordion',
      label: 'נמענים נוספים',
      elements: [
        {
          type: 'VariableText',
          scope: microsoftSendEmailScope('properties.cc'),
          label: 'עותק',
          placeholder: 'כמה כתובות — הפרידו בפסיק או בנקודה-פסיק',
        },
        {
          type: 'VariableText',
          scope: microsoftSendEmailScope('properties.bcc'),
          label: 'עותק מוסתר',
          placeholder: 'כמה כתובות — הפרידו בפסיק או בנקודה-פסיק',
        },
        {
          type: 'VariableText',
          scope: microsoftSendEmailScope('properties.replyTo'),
          label: 'כתובת לתשובה',
          placeholder: 'reply@example.com',
        },
        {
          // The one thing an owner cannot discover from the fields themselves.
          type: 'Label',
          text: 'בשדה "אל" ניתן לרשום כתובת אחת בלבד. שלושת השדות כאן מקבלים כמה כתובות.',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'אפשרויות מתקדמות',
      elements: [
        {
          type: 'Select',
          scope: microsoftSendEmailScope('properties.contentType'),
          label: 'סוג התוכן',
        },
        {
          type: 'Select',
          scope: microsoftSendEmailScope('properties.importance'),
          label: 'חשיבות',
        },
        {
          type: 'Switch',
          scope: microsoftSendEmailScope('properties.saveToSentItems'),
          label: 'שמירת עותק בתיבת "נשלחו"',
        },
      ],
    },
    { type: 'Select', scope: microsoftSendEmailScope('properties.errorPolicy'), label: 'אם השליחה נכשלת' },
    statusControl(microsoftSendEmailScope('properties.status')),
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
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    title: { ...requiredText },
    detail: { type: 'string' },
    level: { type: 'string', options: Object.values(notifyLevelOptions) },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

const notifyTeamScope = getScope<typeof notifyTeamSchema>;

const notifyTeamUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(notifyTeamScope('properties.label'), notifyTeamScope('properties.description')),
    {
      // VariableText, matching `detail` below rather than differing from it.
      //
      // The runtime resolves `{{…}}` in EVERY config field — `resolveConfigTemplates`
      // walks the whole object — so this field already accepted references; what it
      // did not do was offer the picker. An owner typing `{{` here got no
      // suggestions on a field that would have resolved them, which reads as
      // "references do not work here" and is the opposite of the truth.
      //
      // ⚠️ NOT extended to `action.webhook`'s url. That one is plain Text
      // deliberately — see the note there: a destination assembled at run time is
      // a destination nobody reviewed, and the https/private-space check would be
      // judging a string that did not exist when the diagram was saved.
      type: 'VariableText',
      scope: notifyTeamScope('properties.title'),
      label: 'כותרת ההתראה',
      placeholder: 'למשל: אורח {{trigger.guest_name}} כתב משהו שלא זוהה',
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
    ...identityProperties,
    ...statusProperty,
    value: { ...requiredText },
  },
} satisfies NodeSchema;

const setValueScope = getScope<typeof setValueSchema>;

const setValueUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(setValueScope('properties.label'), setValueScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;
const startRsvpAiCallbackScope = getScope<typeof startRsvpAiCallbackSchema>;
const startRsvpAiCallbackUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(startRsvpAiCallbackScope('properties.label'), startRsvpAiCallbackScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

const importGuestListScope = getScope<typeof importGuestListSchema>;

const importGuestListUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(importGuestListScope('properties.label'), importGuestListScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    // `minimum: 1` is the form's half of the guard; the handler refuses a
    // non-positive value again, because the schema constrains what can be TYPED
    // and not what is in the jsonb row.
    amount: { type: 'number', ...NODE_NUMBER_RANGES['logic.wait']!.amount },
    unit: { ...requiredText, options: Object.values(waitUnitOptions) },
  },
} satisfies NodeSchema;

const waitScope = getScope<typeof waitSchema>;

const waitUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(waitScope('properties.label'), waitScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    // `pattern` is the form's half; `matchesSchedule` refuses a bad value again,
    // because the schema constrains what can be TYPED and not what is in the row.
    time: { ...requiredText, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', placeholder: '09:00' },
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
    triggerSwitchElement,
    ...identityControls(scheduleScope('properties.label'), scheduleScope('properties.description')),
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
          label: 'ימים',
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

/**
 * The same seven, as bare keys.
 *
 * DERIVED, never re-typed: the portability layer asks "does this key exist
 * wherever the workflow lands", and a second hand-written copy could answer yes
 * for a key the form no longer offers.
 */
export const TEMPLATE_KEYS: readonly string[] = templateKeyOptions.map((o) => o.value);

const sendTemplateSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.send_template'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    messageKey: { ...requiredText, options: templateKeyOptions.map((o) => ({ ...o })) },
  },
} satisfies NodeSchema;

const sendTemplateScope = getScope<typeof sendTemplateSchema>;

const sendTemplateUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(sendTemplateScope('properties.label'), sendTemplateScope('properties.description')),
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
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    targetWorkflowId: requiredText,
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
    ...identityControls(forEachGuestScope('properties.label'), forEachGuestScope('properties.description')),
    {
      // ⚠️ THE WARNING BELONGS WHERE THE DAMAGE IS CONFIGURED. This node starts
      // one run per matching guest — a single press reaches hundreds of real
      // people — and until now the only thing saying so was the node's
      // `description`, which is a subtitle on a card and is read once.
      //
      // `RichText` renders Markdown, so the number an owner is about to choose
      // can be emphasised in the sentence that explains it. It binds to no
      // property and changes no data.
      type: 'RichText',
      text:
        '**כל אורח שתואם יקבל הרצה משלו.** לחיצה אחת יכולה להגיע למאות אנשים אמיתיים. ' +
        'המספר שתגדירו כאן הוא התקרה שלכם — ומעליה יש תקרה נוספת בקוד שאי אפשר לעקוף מהמסך הזה.',
    },
    {
      type: 'Text',
      scope: forEachGuestScope('properties.targetWorkflowId'),
      label: 'מזהה התהליך שירוץ לכל אורח',
      placeholder: 'הדביקו את המזהה מכתובת העורך',
    },
    {
      // Label beside the field rather than above it, with the `*` on the LABEL —
      // the shape the SDK's own Delay node uses for its required numeric field,
      // paired with `errorIndicatorEnabled: false` so one problem draws one
      // marker. The wait node's amount/unit row already reads this way; this
      // field did not, and it is the one with the largest blast radius.
      type: 'HorizontalLayout',
      layoutColumns: '1fr 1fr',
      elements: [
        { type: 'Label', text: 'עד כמה אורחים', required: true },
        {
          type: 'Text',
          scope: forEachGuestScope('properties.maxGuests'),
          inputType: 'number',
          errorIndicatorEnabled: false,
        },
      ],
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
          label: 'סטטוסים',
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

/**
 * One dial parameter that is read from the platform rather than typed.
 *
 * Both lists behind this shape are LIVE: `provider_numbers` rows for the caller
 * id, and Voximplant's own `GetRules` for the rule. Neither is a constant here,
 * for the same reason the purpose dropdown is not — a number bought today or a
 * rule rebound this morning has to appear without a deploy.
 */
export type VoiceDialOption = { value: string; label: string };

/**
 * ⚠️ EVERY DIAL PARAMETER BELOW IS AN OVERRIDE, AND BLANK IS THE DEFAULT.
 *
 * The precedence is fixed here and enforced in `voice-purpose-dispatch.ts`:
 * a non-empty node value wins; blank falls back to what dialled before this
 * node carried the field at all — `voice_purposes.rule_id` for the rule, the
 * account's configured caller id for the number, the guest's own phone for the
 * destination.
 *
 * That direction is chosen, not incidental. The other one (node authoritative,
 * no fallback) would change how every diagram already saved behaves the moment
 * this ships, because none of them carries these fields. An override that
 * defaults to blank changes nothing until someone sets it.
 *
 * ⚠️ AND THESE THREE REACH THE CALL TODAY — verified, not assumed:
 *   • `ruleId`  → `StartScenarios`' own `rule_id` parameter (the live API
 *     reference lists exactly eight parameters: user_id, user_name,
 *     application_id, application_name, rule_id, script_custom_data,
 *     reference_ip, server_location).
 *   • `callerId` → `script_custom_data.from`, which all three deployed agent
 *     scenarios read as `state.from = customData.from` and hand straight to
 *     `VoxEngine.callPSTN(state.to, state.from)`.
 *   • `toOverride` → `script_custom_data.to`, the first argument of that same
 *     call.
 * No scenario deploy is needed for any of them.
 *
 * The agent id is NOT here, and its absence is the same kind of fact: every
 * scenario hardcodes `var AGENT_ID = 'agent_…'`, and the generic ctx route
 * returns no agent. A picker for it would be a control that changes nothing
 * until that ships, so it waits for the scenario change rather than shipping
 * as furniture.
 */
const voiceCallSchemaFor = (
  purposes: readonly VoicePurposeOption[],
  callerIds: readonly VoiceDialOption[] = [],
  rules: readonly VoiceDialOption[] = [],
  agents: readonly VoiceDialOption[] = [],
) =>
  ({
    type: 'object',
    required: NODE_REQUIRED_FIELDS['action.start_voice_call'],
    properties: {
      ...identityProperties,
      ...statusProperty,
      ...actionBranchesProperty,
      errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
      purposeKey: {
        ...requiredText,
        options: purposes.map((p) => ({ label: p.displayName, value: p.key })),
      },
      // ⚠️ THE EMPTY OPTION IS FIRST AND IT IS NOT A PLACEHOLDER — it is the
      // value that means "leave it to the purpose / the account". A dropdown
      // with no way back to the default would make the first pick permanent.
      callerId: {
        type: 'string',
        options: [{ label: 'ברירת המחדל של החשבון', value: '' }, ...callerIds],
      },
      ruleId: {
        type: 'string',
        options: [{ label: 'הכלל המוגדר לייעוד', value: '' }, ...rules],
      },
      // A `VariableText` control, not a `Text` one: the number to dial is the
      // one dial parameter that legitimately comes from an earlier step
      // (`{{nodes.<id>.phone}}`), and only that control offers the picker.
      toOverride: { type: 'string' },
      // ⚠️ THE ONE FIELD WHOSE OTHER HALF IS NOT LIVE YET. The value is carried
      // end-to-end on the server — node → attempt row → ctx response — but every
      // deployed scenario still opens `ElevenLabs.createAgentsClient({ agentId:
      // AGENT_ID })` against a hardcoded constant. Until a scenario that reads
      // `ctx.agent_id` is deployed, setting this changes which agent the SERVER
      // says to use and not which one answers.
      //
      // It ships anyway, and the reason is the whole point of this node: the
      // alternative is a generic call primitive that cannot name its own agent,
      // which just moves the hardcoding from the scenario into the product. The
      // arm gate refuses a node whose agent is unreachable rather than letting
      // the mismatch dial.
      agentId: {
        type: 'string',
        options: [{ label: 'הסוכן המוגדר בתרחיש', value: '' }, ...agents],
      },
      // Off by default, and the default is the point: this node has dialled and
      // carried straight on since it shipped. Making the wait automatic would
      // change how live automations behave without anyone editing them.
      waitForOutcome: { type: 'boolean' },
    },
  }) satisfies NodeSchema;

const voiceCallSchema = voiceCallSchemaFor([], [], [], []);
const voiceCallScope = getScope<typeof voiceCallSchema>;

const voiceCallUiSchema = {
  type: 'VerticalLayout',
  // ⚠️ THE DECISION FIRST, THE CHROME COLLAPSED — the shape the SDK's own Delay
  // node uses, and the opposite of what this panel did. It opened with "שם הצעד",
  // which is a label on a card, and buried the one choice the node exists to make.
  // Upstream puts the type selector at the top and folds title/status/description
  // into a "General Information" accordion below it.
  elements: [
    // ⚠️ `...globalControls` DOES NOT BELONG HERE, AND THE REASON IS MEASURED.
    //
    // It was spread in for one commit, on the strength of the vendor's own
    // reference node (apps/demo/.../conditional/uischema.ts opens with it) and
    // of the display mechanism being in the base bundle rather than in the
    // Enterprise Validation plugin — both of which are true. What is ALSO true,
    // and decides it:
    //
    //   • Its single element is `{ type:'MessageOnError', scope:
    //     '#/properties/missingPreviousVariable', text:
    //     'plugins.validation.missingDependency' }`.
    //   • That i18n key is NOT TRANSLATED ANYWHERE. It occurs exactly once in
    //     the whole 2.3.0 bundle — inside `globalControls` itself. The SDK's own
    //     `validation` namespace ships only `error.notJSONObject`,
    //     `nodesWithoutDefinition` and `nodesWithErrors`, in en and pl alike.
    //     i18next returns the key when it cannot resolve it — MEASURED, not
    //     assumed: run against the SDK's own init options (fallbackLng 'en',
    //     returnNull false, and no parseMissingKeyHandler or returnEmptyString),
    //     `t('plugins.validation.missingDependency')` returns that string
    //     verbatim. An owner would read it on screen, in English.
    //   • And the renderer is `t(text) || errors || text` — the hardcoded `text`
    //     WINS OVER THE ERROR'S OWN MESSAGE. So this control can never show
    //     something we wrote; it can only ever show that untranslated key.
    //
    // Which makes it the wrong surface for A-13. The right one is the pattern
    // already proven directly below on `purposeKey`: our own `MessageOnError`,
    // scoped to the field in question, carrying Hebrew `text`.
    //
    // ⚠️ AND THERE IS A SECOND SHAPE, from the same measurement: `t(undefined)`
    // returns '' — falsy — so a `MessageOnError` with NO `text` falls through to
    // the errors themselves and displays the message we put in
    // `customErrors[].message`. Use that when the sentence depends on the agent
    // (which override, which flag); use Hebrew `text` when it is fixed.
    //
    // `customErrors`
    // remains the way to RAISE a node-level error the schema cannot express —
    // that half of the earlier reading holds — it just has to be displayed by a
    // control whose text we own.
    {
      type: 'Select',
      scope: voiceCallScope('properties.purposeKey'),
      label: 'ייעוד השיחה',
      // The message below carries the whole explanation, so the per-field icon
      // beside it is a second marker for one problem.
      errorIndicatorEnabled: false,
    },
    {
      // ⚠️ RENDERS ONLY WHEN THE FIELD IS ACTUALLY IN ERROR — the SDK's control
      // returns null unless `errors.length > 0` on its scope (verified in the
      // shipped bundle). `purposeKey` is in NODE_REQUIRED_FIELDS, so an empty
      // value produces exactly that error and this appears beside the dropdown.
      //
      // ⚠️ AND IT IS HERE BECAUSE AN EMPTY DROPDOWN IS A LEGITIMATE STATE. The
      // list reads `voice_purposes`, whose three shipped rows are all built-in
      // and refused by the dialler by design. An owner can therefore open this
      // node, find nothing to pick, and have nothing on screen telling them a
      // purpose has to be created first. The arm gate says the same thing, but
      // only at arming time — this says it where the choice is made.
      //
      // `text` goes through i18next first (`t(text) || errors || text`), so a
      // Hebrew sentence with no matching key falls through unchanged.
      type: 'MessageOnError',
      scope: voiceCallScope('properties.purposeKey'),
      text: 'לא נבחר ייעוד לשיחה. אם הרשימה ריקה — צרו ייעוד חדש ב-/admin/integrations/voximplant וקשרו לו rule.',
    },
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
      // ⚠️ `failWhenUndefined` guards the trap @jsonforms/core states in its own
      // type docs: "Most JSON Schemas will successfully validate against
      // `undefined` data" — so a node whose `purposeKey` is absent entirely, a
      // diagram saved before this field existed, would otherwise PASS the
      // condition and show the switch.
      //
      // It is no longer the ONLY thing standing there: the `type: 'string'`
      // added below rejects `undefined` on its own. Both are kept, and
      // voice-rule.test.ts pins each one separately, so removing either still
      // leaves the switch hidden.
      //
      // ⚠️ FOUR EFFECTS ARE USABLE ON A BUILT-IN CONTROL, NOT SIX — and the
      // reason is NOT the one an earlier version of this comment gave.
      //
      // `RuleEffect` is re-exported straight from @jsonforms/core, which ships
      // SHOW, HIDE, ENABLE, DISABLE, READONLY and WRITABLE. Workflow Builder's
      // own API page documents only the first four.
      //
      // The wrong reason, corrected here so it is not re-derived: it is NOT that
      // `separateReadonlyFromDisabled` folds READONLY into DISABLE. The rule
      // paths are genuinely separate in core 3.8.0 — `hasEnableRule` matches only
      // ENABLE/DISABLE, `hasReadonlyRule` only READONLY/WRITABLE, and
      // `isInherentlyReadonly` consults the rule with NO reference to that flag.
      // A READONLY rule really does arrive at the renderer as `readonly: true`.
      // The flag governs something else: whether a GLOBAL readonly (the editor's
      // view-mode toggle, `uischema.options.readonly`, `schema.readOnly`) also
      // suppresses `enabled`.
      //
      // The actual reason: all ten of the SDK's built-in JsonForms controls
      // destructure `{ data, handleChange, path, enabled, uischema }` and compute
      // `!enabled || uischema.disabled === true`. Not one of them reads
      // `readonly` (counted in the 2.3.0 bundle). So a READONLY rule on a
      // built-in control produces a field that is described as locked and edits
      // freely — a silent no-op, which is worse than an unsupported one.
      //
      // It IS reachable, through the SDK's documented `jsonForm.renderers`: a
      // consumer renderer receives `readonly` and wins over a built-in at equal
      // rank. `header-rows-control.tsx` honours it for exactly that reason.
      // Nothing on THIS node needs a field that is visible but locked, so the
      // rule below uses SHOW.
      rule: {
        effect: 'SHOW',
        condition: {
          scope: voiceCallScope('properties.purposeKey'),
          // ⚠️ `type` ALONGSIDE `minLength`, and not decoration. Ajv runs in
          // strict mode here and warned `missing type "string" for keyword
          // "minLength" at "#" (strictTypes)` on every compile of this rule.
          //
          // It is also a behaviour fix, not just a silenced warning: `minLength`
          // is defined only for strings and is IGNORED for every other type. A
          // legacy diagram carrying `purposeKey: null` therefore satisfied the
          // condition — null is not undefined, so `failWhenUndefined` does not
          // catch it either — and the switch appeared on a node with no purpose,
          // which is the single case this rule exists to prevent.
          schema: { type: 'string', minLength: 1 },
          failWhenUndefined: true,
        },
      },
    },
    {
      // ⚠️ THE DIAL PARAMETERS, GROUPED AND GATED BEHIND A PURPOSE.
      //
      // Grouped, because they are four fields that share one job and none of
      // them is the decision this node exists to make — that is the purpose
      // above.
      //
      // ⚠️ AND GROUPED IS ALL IT IS: an Accordion in this editor opens EXPANDED
      // (the renderer passes no `defaultOpen` and the component defaults it to
      // true — read in the 2.3.0 bundle, against upstream's prose, which says
      // "hidden by default"). These four are the parameters that decide what the
      // call IS; burying them behind a closed chevron would be the wrong choice,
      // and this container does not do that.
      //
      // Gated on the same condition as the wait switch, for the same reason:
      // choosing which number a call goes out from is not a meaningful choice
      // before there is a call to make, and offering it first teaches the wrong
      // order. `rule` is available on a LAYOUT element, not only on a control —
      // `BaseLayoutElement` carries `rule?: UISchemaRule` in the 2.3.0 typings —
      // so one rule here covers all three fields instead of three copies.
      //
      // `type` alongside `minLength`, and `failWhenUndefined`, for the reasons
      // spelled out on the switch below: Ajv strict mode warns without the
      // first, and a legacy diagram carrying `purposeKey: null` passes without
      // either.
      type: 'Accordion',
      label: 'פרמטרי החיוג',
      rule: {
        effect: 'SHOW',
        condition: {
          scope: voiceCallScope('properties.purposeKey'),
          schema: { type: 'string', minLength: 1 },
          failWhenUndefined: true,
        },
      },
      elements: [
        {
          type: 'Select',
          scope: voiceCallScope('properties.callerId'),
          label: 'מתקשרים מהמספר',
        },
        {
          type: 'Select',
          scope: voiceCallScope('properties.ruleId'),
          label: 'כלל הניתוב (התרחיש שירוץ)',
        },
        {
          type: 'Select',
          scope: voiceCallScope('properties.agentId'),
          label: 'הסוכן שיענה',
        },
        {
          // The only one of the four that accepts a reference: a destination
          // produced by an earlier step is a real flow, a caller id produced by
          // one is not — that value has to be a number the account owns.
          type: 'VariableText',
          scope: voiceCallScope('properties.toOverride'),
          label: 'מספר היעד (ריק = הטלפון של האורח)',
          placeholder: '{{nodes.<id>.phone}}',
        },
      ],
    },
    {
      // ⚠️ GROUPED, NOT COLLAPSED — and the distinction is a correction.
      //
      // Upstream's prose calls Accordion a "collapsible labeled section … body
      // hidden by default", and an earlier version of this comment repeated it.
      // THE SHIPPED CODE DISAGREES: the Accordion renderer (`GH` in the 2.3.0
      // bundle) renders `<Accordion label={…}>` passing NO `defaultOpen`, and
      // the component's own default is `defaultOpen = true`. Every Accordion in
      // this editor therefore opens EXPANDED; the chevron lets an owner close
      // one, it does not start closed.
      //
      // So what this buys is a heading and a boundary, not concealment. That is
      // still the right container for `errorPolicy` — most owners never move it
      // off the default, and this node now carries several fields where it
      // carried two — but nothing here is hidden from anyone.
      //
      // NOT swept across the other nine nodes that expose the same field. That
      // is a different change — it trades discoverability for tidiness on every
      // node at once, and an owner asking "why did my whole workflow stop?" is
      // looking for precisely this control. One node's crowding is a reason to
      // group that node; it is not a reason to restyle the editor.
      type: 'Accordion',
      label: 'מתקדם',
      elements: [
        { type: 'Select', scope: voiceCallScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
      ],
    },
    {
      // ⚠️ A GROUP, NOT AN ACCORDION, AND THE DIFFERENCE IS A CLAIM ABOUT THE
      // CONTENTS. An Accordion says "advanced — fold this away when you are
      // done"; these three are the node's IDENTITY. `description` is required on
      // all eighteen types and `status` decides whether the step runs at all, so
      // neither is something an owner should be encouraged to close over.
      //
      // The other seventeen nodes render these inline with no container. This
      // one keeps a heading because it is the most crowded panel in the palette
      // — `Group` is exactly that heading plus a boundary, with no chevron and
      // no implication of optionality. Its renderer (`XH`) is a plain div; the
      // Accordion's (`GH`) wraps a collapsible whose open state we cannot set.
      type: 'Group',
      label: 'פרטי הצעד',
      elements: [
        ...identityControls(voiceCallScope('properties.label'), voiceCallScope('properties.description')),
        // ⚠️ THE CONTROL THIS NODE WAS MISSING, and its absence was not cosmetic.
        // Seventeen of the eighteen node types render `statusControl`; this one
        // did not, while still carrying `status` in its schema and in its
        // defaults. `arm-check.ts` reads that value — a node left on 'draft'
        // blocks arming — so an owner could neither park this node as a draft
        // nor see why a diagram armed when they expected it not to.
        statusControl(voiceCallScope('properties.status')),
      ],
    },
  ],
} satisfies UISchema;

/**
 * The read-only run report, drawn by `node-run-control.tsx`.
 *
 * ⚠️ A `Label` AND NOT A CONTROL, because it edits nothing. The SDK's UISchema
 * union is CLOSED — `UISchemaControlElement | UISchemaLayoutElement |
 * LabelElement | RichTextElement` — so "render my component here" has to be an
 * existing element carrying `options.format`, which is the same contract the
 * other four custom renderers in this file use. `text` is required by the type
 * and never drawn: the renderer replaces the element outright.
 */
const NODE_RUN_ELEMENT: UISchema = {
  type: 'Label',
  text: 'הרצה',
  options: { format: NODE_RUN_FORMAT },
};

/**
 * Put the run report at the top of a node's properties panel.
 *
 * ⚠️ HERE AND NOT IN THE NINETEEN UISCHEMAS, because it is not a property of any
 * node — it is the editor reporting on a run. One place also means a node type
 * added later gets it without anyone remembering to.
 *
 * ⚠️ AND HERE RATHER THAN ON `PALETTE_ITEMS` ITSELF. That array is also read by
 * `normalizeLegacyProperties` and by the tests that police container choice;
 * neither has any business seeing an element that exists only for the editor's
 * live view. `nodeTypes` is the only consumer that needs it, and this function
 * is what builds it.
 *
 * ⚠️ FIRST, matching where the vendor puts `globalControls` in their own nodes.
 * It is also what an owner opening a node DURING a run came to read; the
 * settings are still one line below, and the control renders nothing at all
 * when no run is on the canvas.
 */
function withNodeRunControl(item: PaletteItem): PaletteItem {
  const { uischema } = item;
  // `uischema` is OPTIONAL on the vendor's `NodeDefinition`, and every entry
  // here is a VerticalLayout. Both checks are cheaper than a crash if one ever
  // is not — a node whose panel simply lacks the report is a far better failure
  // than a panel that does not render.
  if (!uischema || !('elements' in uischema) || !Array.isArray(uischema.elements)) return item;
  return {
    ...item,
    uischema: { ...uischema, elements: [NODE_RUN_ELEMENT, ...uischema.elements] },
  };
}

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
// ---------------------------------------------------------------------------
// action.ai_agent
// ---------------------------------------------------------------------------

const aiAgentSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.ai_agent'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...errorPolicyProperty,
    systemPrompt: { ...requiredText },
    model: { ...requiredText, options: aiAgentModelOptions.map((o) => ({ ...o })) },
    maxTurns: { type: 'number' },
    // ⚠️ THE VENDOR'S FIXED ROW SHAPE, AND `apiKey` IS DELIBERATELY UNUSED.
    // `AiTools` is a repeater bound to `{ id, sourceHandle, tool, description,
    // apiKey }` and its own docs say the surface is "specific to the demo's
    // AI-agent node" — the shape cannot be changed. Our tools are KALFA
    // capabilities reached through the settings file the port passes, so none
    // of them has a per-tool key; and a diagram is exportable, which is why
    // nothing would justify putting one there. The handler reads `tool` only.
    tools: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceHandle: { type: 'string' },
          tool: { type: 'string' },
          description: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
    },
  },
} satisfies NodeSchema;

const aiAgentScope = getScope<typeof aiAgentSchema>;

const aiAgentUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(aiAgentScope('properties.label'), aiAgentScope('properties.description')),
    {
      type: 'Accordion',
      label: 'ההנחיה',
      elements: [
        {
          // `VariableTextArea`, the same control the vendor's own AI node uses —
          // so `{{nodes.<id>.<field>}}` from an earlier step can be named inside
          // the prompt, with the picker offering them.
          type: 'VariableTextArea',
          scope: aiAgentScope('properties.systemPrompt'),
          label: 'מה לבקש מהמודל',
          placeholder: 'כתבו כאן. השתמשו ב-{{ כדי להכניס ערך מצעד קודם.',
          minRows: 5,
        },
        {
          type: 'Label',
          text: 'התשובה זמינה לצעדים הבאים כ-{{nodes.<מזהה>.text}}. הצעד הזה אינו מחליט לבד — כדי להסתעף לפי התשובה, הוסיפו אחריו צומת "תנאי".',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'מודל ותקרה',
      elements: [
        { type: 'Select', scope: aiAgentScope('properties.model'), label: 'מודל' },
        {
          type: 'Text',
          scope: aiAgentScope('properties.maxTurns'),
          label: 'מקסימום סבבים',
          inputType: 'number',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'כלים',
      elements: [
        { type: 'AiTools', scope: aiAgentScope('properties.tools') },
        {
          type: 'Label',
          text: 'הכלים עדיין אינם פעילים — הצעד שואל את המודל ומחזיר טקסט בלבד, ומה שנכתב כאן אינו נשלח לשום מקום. אל תזינו מפתח בשדה ה-API Key: התרשים ניתן לייצוא, ומה שיוזן שם יימחק בייצוא.',
        },
      ],
    },
    statusControl(aiAgentScope('properties.status')),
    { type: 'Select', scope: aiAgentScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
  ],
};

export function buildPaletteItems(
  numbers: readonly WhatsAppNumberOption[] = [],
  /**
   * The configured voice agents, for `action.start_voice_call`'s dropdown.
   *
   * Empty means the node offers nothing to pick — which is the honest state
   * when no purpose has been set up, and the handler refuses a blank anyway.
   */
  voicePurposes: readonly VoicePurposeOption[] = [],
  /**
   * The dial parameters the call node may be pointed at, both live lists.
   *
   * Empty is a legitimate state for either: an account with no synced number,
   * or a Voximplant read that failed or was never asked for. The node then
   * offers only its blank default, which is the behaviour that shipped before
   * these fields existed — never a broken control.
   */
  voiceCallerIds: readonly VoiceDialOption[] = [],
  voiceRules: readonly VoiceDialOption[] = [],
  voiceAgents: readonly VoiceDialOption[] = [],
  microsoftConnections: readonly MicrosoftConnectionOption[] = [],
  /**
   * The SUMIT trigger's fields as THIS workflow's latest SUMIT call carried
   * them — see `sumitCardOutputFromSample`. `null` keeps the fixed list, which
   * is the state of any workflow SUMIT has not called yet.
   */
  sumitCardOutput: SumitCardOutput | null = null,
): PaletteItem[] {
  return PALETTE_ITEMS.map((item) => {
    if (item.type === 'trigger.sumit_card' && sumitCardOutput) {
      return withNodeRunControl({ ...item, outputSchema: { type: 'default', properties: sumitCardOutput } });
    }
    if (item.type === 'trigger.whatsapp_inbound') {
      return withNodeRunControl({ ...item, schema: triggerSchemaFor(numbers) });
    }
    if (item.type === 'action.start_voice_call') {
      return withNodeRunControl({
        ...item,
        schema: voiceCallSchemaFor(voicePurposes, voiceCallerIds, voiceRules, voiceAgents),
      });
    }
    if (item.type === 'action.microsoft_send_email') {
      return withNodeRunControl({
        ...item,
        schema: microsoftSendEmailSchemaFor(microsoftConnections),
      });
    }
    return withNodeRunControl(item);
  });
}

/**
 * The palette with NO numbers offered — the dropdown shows only "כל המספרים".
 *
 * Kept as the base the factory rewrites one entry of, so every other node type
 * is declared exactly once. It is also what the tests and the i18n audit read.
 */
// ---------------------------------------------------------------------------
// action.sumit_create_document / action.sumit_create_customer
// ---------------------------------------------------------------------------
//
// Both are ACCOUNTING nodes: they create a record, they do not move money.
// Every option below is a value swagger.json accepts — no label here invents a
// capability the API does not have.

const sumitDocumentTypeOptions = {
  Receipt: { label: 'קבלה', value: 'Receipt' },
  ProformaInvoice: { label: 'חשבונית עסקה (פרופורמה)', value: 'ProformaInvoice' },
  PriceQuotation: { label: 'הצעת מחיר', value: 'PriceQuotation' },
  PaymentRequest: { label: 'דרישת תשלום', value: 'PaymentRequest' },
  Order: { label: 'הזמנה', value: 'Order' },
  DeliveryNote: { label: 'תעודת משלוח', value: 'DeliveryNote' },
  CreditReceipt: { label: 'קבלת זיכוי', value: 'CreditReceipt' },
} as const satisfies Record<SumitDocumentTypeOption, { label: string; value: string }>;

const sumitCreateDocumentSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.sumit_create_document'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    documentType: {
      ...requiredText,
      options: Object.values(sumitDocumentTypeOptions),
    },
    customerName: { ...requiredText },
    customerEmail: { type: 'string' },
    customerPhone: { type: 'string' },
    customerExternalId: { type: 'string' },
    customerNoVat: { type: 'boolean' },
    itemName: { type: 'string' },
    itemQuantity: { type: 'number' },
    itemUnitPrice: { type: 'number' },
    documentDescription: { type: 'string' },
    isDraft: { type: 'boolean' },
    sendByEmail: { type: 'boolean' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

const sumitCreateCustomerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.sumit_create_customer'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    customerName: { ...requiredText },
    customerEmail: { type: 'string' },
    customerPhone: { type: 'string' },
    city: { type: 'string' },
    address: { type: 'string' },
    companyNumber: { type: 'string' },
    externalId: { type: 'string' },
    noVat: { type: 'boolean' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

const sumitCreateDocumentScope = getScope<typeof sumitCreateDocumentSchema>;
const sumitCreateCustomerScope = getScope<typeof sumitCreateCustomerSchema>;

// The four ARM-BLOCKING fields stay FLAT — the house rule this file records
// elsewhere: a field `arm-check.ts` refuses to arm on must be visible without
// opening an accordion, or the owner meets it as a blocker instead of a form.
const sumitCreateDocumentUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(
      sumitCreateDocumentScope('properties.label'),
      sumitCreateDocumentScope('properties.description'),
    ),
    {
      type: 'Select',
      scope: sumitCreateDocumentScope('properties.documentType'),
      label: 'סוג המסמך',
    },
    {
      type: 'VariableText',
      scope: sumitCreateDocumentScope('properties.customerName'),
      label: 'שם הלקוח',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
    },
    {
      type: 'Accordion',
      label: 'פרטי הלקוח',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.customerEmail'),
          label: 'אימייל',
        },
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.customerPhone'),
          label: 'טלפון',
        },
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.customerExternalId'),
          label: 'מזהה חיצוני',
          placeholder: 'המזהה שלנו ללקוח — לצורך התאמה מול SUMIT',
        },
        {
          type: 'Switch',
          scope: sumitCreateDocumentScope('properties.customerNoVat'),
          label: 'הלקוח פטור ממע״מ',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'שורת פריט (אופציונלי)',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.itemName'),
          label: 'שם הפריט',
        },
        {
          type: 'Text',
          scope: sumitCreateDocumentScope('properties.itemQuantity'),
          label: 'כמות',
        },
        {
          type: 'Text',
          scope: sumitCreateDocumentScope('properties.itemUnitPrice'),
          label: 'מחיר ליחידה (₪)',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'אפשרויות המסמך',
      elements: [
        {
          type: 'VariableTextArea',
          scope: sumitCreateDocumentScope('properties.documentDescription'),
          label: 'תיאור שמודפס על המסמך',
          minRows: 2,
        },
        {
          type: 'Switch',
          scope: sumitCreateDocumentScope('properties.isDraft'),
          label: 'שמירה כטיוטה',
        },
        {
          type: 'Switch',
          scope: sumitCreateDocumentScope('properties.sendByEmail'),
          label: 'שליחת המסמך במייל ללקוח',
        },
      ],
    },
    // status and errorPolicy stay FLAT: accordion-classification.test.ts
    // refuses to let a node-level switch be folded away, and `status` is
    // what decides whether the step runs at all.
    statusControl(sumitCreateDocumentScope('properties.status')),
    {
      type: 'Select',
      scope: sumitCreateDocumentScope('properties.errorPolicy'),
      label: 'התנהגות בשגיאה',
    },
  ],
};

const sumitCreateCustomerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(
      sumitCreateCustomerScope('properties.label'),
      sumitCreateCustomerScope('properties.description'),
    ),
    {
      type: 'VariableText',
      scope: sumitCreateCustomerScope('properties.customerName'),
      label: 'שם הלקוח',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
    },
    {
      type: 'Accordion',
      label: 'פרטי קשר',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.customerEmail'),
          label: 'אימייל',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.customerPhone'),
          label: 'טלפון',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.city'),
          label: 'עיר',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.address'),
          label: 'כתובת',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'פרטים עסקיים',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.companyNumber'),
          label: 'ח.פ. / ע.מ.',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.externalId'),
          label: 'מזהה חיצוני',
        },
        {
          type: 'Switch',
          scope: sumitCreateCustomerScope('properties.noVat'),
          label: 'הלקוח פטור ממע״מ',
        },
      ],
    },
    // status and errorPolicy stay FLAT: accordion-classification.test.ts
    // refuses to let a node-level switch be folded away, and `status` is
    // what decides whether the step runs at all.
    statusControl(sumitCreateCustomerScope('properties.status')),
    {
      type: 'Select',
      scope: sumitCreateCustomerScope('properties.errorPolicy'),
      label: 'התנהגות בשגיאה',
    },
  ],
};

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'action.sumit_create_document' satisfies KalfaNodeType,
    label: 'הפקת מסמך ב-SUMIT',
    description: 'מפיק קבלה, הצעת מחיר או מסמך אחר. לא מבצע חיוב.',
    icon: 'FileText',
    templateType: NodeType.DecisionNode,
    schema: sumitCreateDocumentSchema,
    uischema: sumitCreateDocumentUiSchema,
    // Every field seeded, none omitted. The SDK's bundled validator
    // (@cfworker/json-schema) treats an ABSENT required key as invalid but an
    // EMPTY one as valid — so seeding is what makes the panel's error markers
    // appear on the field instead of the owner discovering the blank at arming.
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'הפקת מסמך ב-SUMIT',
      description: 'מפיק קבלה, הצעת מחיר או מסמך אחר. לא מבצע חיוב.',
      // קבלה — the document this business (עוסק פטור) actually issues.
      documentType: sumitDocumentTypeOptions.Receipt.value,
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      customerExternalId: '',
      customerNoVat: false,
      itemName: '',
      itemQuantity: 1,
      itemUnitPrice: 0,
      documentDescription: '',
      // DRAFT by default. A final document is a bookkeeping record that cannot
      // simply be deleted, so the first run of a new automation produces
      // something reviewable rather than something filed.
      isDraft: true,
      sendByEmail: false,
      errorPolicy: errorPolicyOptions.continue.value,
    },
    outputSchema: {
      type: 'default',
      properties: {
        // The four fields SUMIT's own response carries
        // (`Accounting_Documents_Create_Response`). A later node can reference
        // any of them as {{nodes.<id>.<field>}} with no extra wiring.
        documentId: { type: 'number', label: 'מזהה המסמך' },
        documentNumber: { type: 'number', label: 'מספר המסמך' },
        customerId: { type: 'number', label: 'מזהה הלקוח' },
        documentDownloadUrl: { type: 'string', label: 'קישור להורדת המסמך' },
      },
    },
  } satisfies PaletteItem<typeof sumitCreateDocumentSchema>,
  {
    type: 'action.sumit_create_customer' satisfies KalfaNodeType,
    label: 'יצירת לקוח ב-SUMIT',
    description: 'יוצר כרטיס לקוח. לא מבצע חיוב.',
    icon: 'UserPlus',
    templateType: NodeType.DecisionNode,
    schema: sumitCreateCustomerSchema,
    uischema: sumitCreateCustomerUiSchema,
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'יצירת לקוח ב-SUMIT',
      description: 'יוצר כרטיס לקוח. לא מבצע חיוב.',
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      city: '',
      address: '',
      companyNumber: '',
      externalId: '',
      noVat: false,
      errorPolicy: errorPolicyOptions.continue.value,
    },
    outputSchema: {
      type: 'default',
      properties: {
        customerId: { type: 'number', label: 'מזהה הלקוח' },
        customerHistoryUrl: { type: 'string', label: 'קישור לכרטיס הלקוח' },
      },
    },
  } satisfies PaletteItem<typeof sumitCreateCustomerSchema>,
  {
    type: 'action.ai_agent' satisfies KalfaNodeType,
    label: 'סוכן AI',
    description: 'שואל מודל שפה ומעביר את התשובה לצעדים הבאים',
    icon: 'Sparkle',
    // The SDK's own visual template for an AI step. Not a cosmetic choice: the
    // guide warns that a `nodeTemplates` key colliding with a built-in name
    // ('node', 'start-node', 'ai-node', 'decision-node') OVERRIDES that
    // category's renderer — so declaring the template type is how we get the
    // vendor's AI body rather than accidentally replacing it.
    templateType: NodeType.AiNode,
    schema: aiAgentSchema,
    uischema: aiAgentUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        text: {
          type: 'string',
          label: 'תשובת המודל',
          description: 'זמינה כ-{{nodes.<מזהה>.text}}',
        },
        // Published so a run's cost is visible on the step that spent it — the
        // way the fleet's own index line records it per role.
        costUsd: { type: 'number', label: 'עלות הקריאה', description: 'בדולרים; ריק בהרצה יבשה' },
        sessionId: { type: 'string', label: 'מזהה הסשן', description: 'לאיתור מול עקבת ה-CLI' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'סוכן AI',
      description: 'שואל מודל שפה ומעביר את התשובה לצעדים הבאים',
      systemPrompt: '',
      model: 'haiku',
      maxTurns: AI_AGENT_MAX_TURNS.default,
      tools: [],
      errorPolicy: errorPolicyOptions.fail.value,
    },
  } satisfies PaletteItem<typeof aiAgentSchema>,
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
        // ⚠️ THE FIELD TO BRANCH ON, derived from the call's own report — so a
        // diagram never has to know that `sip_486` means Busy Here. The
        // technical fields below stay for debugging, not for conditions.
        //
        // ⚠️ `description` CARRIES THE VOCABULARY BECAUSE `type` CANNOT. The
        // SDK's `OutputProperty` is `{ type, label, description? }` and nothing
        // else (index.d.ts:1121, verified in 2.3.0) — `type` is a
        // `VariableType`, one of string/number/boolean/datetime/date/object/
        // array, and there is no enum, no options, no allowed-values field. The
        // shipped bundle reads only `.properties[path].type` off this schema, so
        // a list of legal values has nowhere else to live.
        //
        // It is not decoration: the picker builder copies `description` onto
        // every item it mints (`Ih` in index-CEBfv0NZ.js: `{id, display, label,
        // description, type}`), so this is the one string that reaches an owner
        // at the moment they are typing the right-hand side of a condition.
        //
        // Three values, not four: `follow_up_required` is in the TYPE but no
        // mapping produces it (voice-outcome.ts), and listing a value the engine
        // cannot emit would send someone off to build a branch that never fires.
        outcome: {
          type: 'string',
          label: 'תוצאת השיחה',
          description: 'אחד מ: completed (התקיימה והסתיימה), no_answer (לא ענו / לא דיווחה), failed (לא יצאה לדרך)',
        },
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
      // Blank = "whatever dialled before this field existed". See the schema's
      // own note: an override that defaults to set would change live diagrams.
      callerId: '',
      ruleId: '',
      toOverride: '',
      agentId: '',
      waitForOutcome: false,
      errorPolicy: errorPolicyOptions.continue.value,
    },
  } satisfies PaletteItem<typeof voiceCallSchema>,
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
  } satisfies PaletteItem<typeof triggerSchema>,
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
        // Published SEPARATELY rather than folded into `body`. A GET carries no
        // body, and merging its query string into one would make
        // `{{trigger.body.x}}` mean two different things depending on the verb —
        // the confusion n8n avoids by exposing `{ body, headers, params, query }`
        // as distinct members.
        query: {
          type: 'object',
          label: 'פרמטרים בכתובת',
          description: 'ה-query string — ניתן לפנות אליו כ-{{trigger.query.שם_השדה}}',
        },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'קריאת Webhook נכנסת',
      description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
      // ⚠️ `header` EXPLICITLY, NOT LEFT ABSENT. `readWebhookAuthMode` reads an
      // absent value as `header` anyway, so this changes no behaviour — it is
      // here because `palette-defaults.test.ts` requires a conditional rule's
      // decider to be a member of its own `whenIn`, and a node born with the
      // field set is a node whose mode is visible in the panel from the first
      // render rather than implied.
      auth: 'header',
      // Both halves start blank and are minted together by the control. A
      // diagram with one and not the other is the state `arm-check` refuses.
      // In `address` mode this one stays blank forever — the path is never
      // stored, only its hash.
      endpointId: '',
      // Empty means POST only. See `webhookAllowsMethod` — an absent value must
      // never widen a live public endpoint.
      methods: [],
      // ⚠️ `tokenHash`, NOT `token` — this key must match `webhookTriggerSchema`
      // and the uischema's `properties.tokenHash` scope, or a node dragged from
      // the palette is born carrying a field the schema does not declare AND
      // missing its only required one. That was live until 2026-09-22 and no
      // gate saw it: the key is a plain string in three files that never get
      // compared. `palette-defaults.test.ts` now compares them.
      //
      // EMPTY, never a value minted here. This module runs in the BROWSER, and a
      // token from `Math.random`/`crypto` on a page is a token whose entropy
      // nobody audited. `webhook-token-control.tsx` generates it and stores only
      // its sha256.
      tokenHash: '',
    },
  } satisfies PaletteItem<typeof webhookTriggerSchema>,
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
  } satisfies PaletteItem<typeof scheduleSchema>,
  {
    type: 'trigger.sumit_card' satisfies KalfaNodeType,
    label: 'שינוי בכרטיס SUMIT',
    description: 'SUMIT מודיעה שכרטיס נוצר, עודכן, הועבר לארכיון או נמחק',
    icon: 'IdentificationCard',
    templateType: NodeType.StartNode,
    schema: sumitCardTriggerSchema,
    uischema: sumitCardTriggerUiSchema,
    // Exactly what the handler returns — `sumitCardTrigger` in steps/index.ts.
    //
    // The "תפיסות מסגרת" fields were MEASURED, not guessed: `/crm/schema/getfolder/`
    // on folder 1076735289 (2026-09-23) returned exactly these nine `APIName`s,
    // and the live webhooks carried the same keys with these shapes (every value
    // a list; references as `{ ID, Name, … }`). Keys are paths: the picker inserts
    // `{{nodes.<id>.<key>}}` verbatim and `resolveTemplate` walks dots through
    // arrays, so `.0` is the first value. (The vendor's docs call array indexing
    // unsupported; the vendored resolver does it anyway, unmodified, and
    // `sumit-card-trigger.test.ts` pins that it still does.)
    //
    // ⚠️ FLAT, ALTHOUGH THE FIELDS BELONG TO ONE FOLDER — chosen over the SDK's
    // `variant` form after measuring both. `variant` (fields chosen by a node
    // setting) is typed in `index.d.ts` but absent from the docs, and the editor
    // resolves a reference's TYPE only from `outputSchema.properties` (`eL`) —
    // so under `variant` every field reads as text and the condition editor
    // never offers "greater than" on the amount. None of the four decorable SDK
    // functions touches type lookup, so no plugin can fix it. The price of flat
    // is that another folder's SUMIT node is offered these too; each label says
    // "(תפיסות מסגרת)".
    outputSchema: {
      type: 'default',
      properties: { ...SUMIT_CARD_BASE_OUTPUT, ...SUMIT_HOLD_FIELDS_OUTPUT },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'שינוי בכרטיס SUMIT',
      description: 'SUMIT מודיעה שכרטיס נוצר, עודכן, הועבר לארכיון או נמחק',
      // EMPTY: minted in the editor, shown once, stored only as a hash.
      tokenHash: '',
    },
  } satisfies PaletteItem<typeof sumitCardTriggerSchema>,
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
    //   * We omit `conditions` from the item shape and the branch-condition
    //     control from the uischema, and the branches are fixed.
    //
    //     ⚠️ THE REASON THIS BULLET USED TO GIVE IS NO LONGER TRUE, and leaving
    //     it stated would keep talking a future reader out of a real feature.
    //     It said the vendor's branch conditions are `{x, y, comparisonOperator}`
    //     resolved through `resolveTemplate` "which we did not vendor", so
    //     `{{trigger.x}}` would render as literal text. `resolve-template.ts` IS
    //     vendored and wired into `activity-runner.ts` — the very next bullet
    //     says so about `outputSchema` — and `logic.switch` already ships the
    //     vendor's `DecisionBranches` control (see `switchUiSchema`). So the
    //     mechanism works and is in use.
    //
    //     ⚠️ AND IT NAMED THE WRONG CONTROL. `DecisionBranches` belongs to the
    //     vendor's DECISION node (docs/workflowbuilder/nodes/decision.md); their
    //     CONDITIONAL node uses `DynamicConditions` over a `conditionsArray`
    //     (nodes/conditional.md). This entry is the conditional shape.
    //
    //     WHAT ACTUALLY STOPS IT, measured: `ConditionConfig` stores one
    //     comparison as `field`/`operator`/`value`, so "A AND B" cannot be
    //     expressed and every saved diagram carries the flat triple. The blocker
    //     is a migration of stored data, not a missing control — and the
    //     array evaluator with AND/OR already exists, serving `logic.switch`.
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
  } satisfies PaletteItem<typeof conditionSchema>,
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
  } satisfies PaletteItem<typeof switchSchema>,
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
  } satisfies PaletteItem<typeof updateGuestStatusSchema>,
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
  } satisfies PaletteItem<typeof sendWhatsappSchema>,
  {
    type: 'action.microsoft_send_email' satisfies KalfaNodeType,
    templateType: NodeType.DecisionNode,
    label: 'שליחת דוא״ל ב-Microsoft 365',
    description: 'שולח הודעת דוא״ל באמצעות חיבור Microsoft 365 מנוהל',
    icon: 'EnvelopeSimple',
    schema: microsoftSendEmailSchema,
    uischema: microsoftSendEmailUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        accepted: {
          type: 'boolean',
          label: 'התקבל אצל Microsoft Graph',
          description: 'האם Microsoft Graph קיבל את בקשת השליחה; אין בכך אישור מסירה',
        },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'שליחת דוא״ל ב-Microsoft 365',
      description: 'שולח הודעת דוא״ל באמצעות חיבור Microsoft 365 מנוהל',
      connectionId: '',
      to: '',
      cc: '',
      bcc: '',
      replyTo: '',
      subject: '',
      body: '',
      // Graph's own defaults, spelled out so a NEW node and an OLD one that
      // carries none of these fields send byte-identical mail.
      contentType: microsoftContentTypeOptions.Text.value,
      importance: microsoftImportanceOptions.normal.value,
      saveToSentItems: true,
      errorPolicy: errorPolicyOptions.fail.value,
    },
  } satisfies PaletteItem<typeof microsoftSendEmailSchema>,
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
  } satisfies PaletteItem<typeof startRsvpAiCallbackSchema>,
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
  } satisfies PaletteItem<typeof notifyTeamSchema>,
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
  } satisfies PaletteItem<typeof setGuestFieldSchema>,
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
      // ⚠️ AN OFFERED VALUE, NOT AN INTERNAL LABEL. This used to seed
      // 'פנייה מתהליך אוטומטי', which is not in `CALLBACK_TOPICS` — so the Select
      // rendered a value absent from its own options, and a node dropped and
      // never opened created a callback whose topic the team reads in the queue
      // and the agent is handed as `{{topic_he}}`. The handler's blank-fallback
      // was fixed to `CALLBACK_TOPICS[0]` (`steps/index.ts`) and this was not:
      // the default is non-blank, so the fallback never sees it.
      topic: CALLBACK_TOPICS[0],
      note: '',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  } satisfies PaletteItem<typeof callbackRequestSchema>,
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
  } satisfies PaletteItem<typeof webhookSchema>,
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
        // ⚠️ THE FAILURE BRANCH, PRODUCED SINCE DAY ONE AND NEVER DECLARED. The
        // handler returns TWO shapes: `{ staged: true, rows, … }` on success and
        // `{ staged: false, reason, message }` down the error port. Only the
        // first was published, so the picker never offered the other — and the
        // guest-import starter had to hard-code `{{…reason?}}` and
        // `{{…message?}}` from knowledge of the source file.
        //
        // Declared on the SAME schema rather than through the SDK's `variant`
        // output form. That form exists — `OutputVariant`, keyed on a
        // `dataPropertyName`/`dataPropertyValue` pair that `staged` would fit
        // exactly — and the bundle does consume it. But NO node in this
        // catalogue uses it, and whether the picker RENDERS it is a claim about
        // a UI that only a browser can settle. A field absent on the other
        // branch resolves to empty with `?`, which is what the templates
        // already do.
        staged: { type: 'boolean', label: 'נקלט בהצלחה', description: 'שקר במסלול "נכשל"' },
        reason: { type: 'string', label: 'סיבת הכישלון', description: 'קיים רק במסלול "נכשל"' },
        message: { type: 'string', label: 'פירוט הכישלון', description: 'קיים רק במסלול "נכשל"' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'קליטת רשימת אורחים',
      description: 'מעלה לסקירה קובץ או אנשי קשר שהגיעו בוואטסאפ',
      errorPolicy: errorPolicyOptions.fail.value,
    },
  } satisfies PaletteItem<typeof importGuestListSchema>,
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
  } satisfies PaletteItem<typeof waitSchema>,
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
  } satisfies PaletteItem<typeof sendTemplateSchema>,
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
        // The same gap as `action.import_guest_list`: the error branch returns
        // `{ started: 0, reason }`, `reason` was never published, and the
        // weekly-sweep starter referenced it as `{{…reason?}}` from the source
        // rather than from the picker.
        reason: { type: 'string', label: 'סיבת הכישלון', description: 'קיים רק במסלול "נכשל"' },
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
  } satisfies PaletteItem<typeof forEachGuestSchema>,
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
  } satisfies PaletteItem<typeof setValueSchema>,
];
