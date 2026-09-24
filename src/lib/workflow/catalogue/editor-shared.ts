'use client';

// The editor helpers every node's schema and uischema are built from: the
// identity fields (name, description, arm notice), the per-step status switch,
// the "required and not blank" string field, the `allOf` built from a node's
// conditional contracts, for action nodes the two branch handles and the
// error-policy options, the guest RSVP-status options, and for trigger nodes the
// "what starts the flow" switcher element.
//
// ⚠️ ITS OWN MODULE SO A NODE FOLDER CAN IMPORT IT. `schemas.ts` is the palette
// aggregator — it imports every moved node's palette file — so a node that
// imported these helpers from `schemas.ts` would close a cycle. Both import
// from here instead.
//
// CLIENT ONLY, for the reason `schemas.ts` gives: `sharedProperties` and
// `statusOptions` are runtime values from @workflowbuilder/sdk. Server code
// reads `types.ts` / `nodes.ts` and the node `definition.ts` files instead.
//
// The node folders' editor files are written against the SDK's own vocabulary,
// verified against `dist/index.d.ts` and against how the reference app's own
// nodes are built
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
// Every node's `schema.ts` ends in `satisfies NodeSchema` and its palette entry
// in `satisfies PaletteItem<…>`, so a mistake there is a compile error rather
// than an empty properties panel.
import { errorPolicyProperty, sharedProperties, statusOptions } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { RSVP_STATUSES } from '@/lib/constants';

import {
  ACTION_BRANCH_HANDLES,
  ARM_NOTICE_PATH,
  ERROR_POLICIES,
  NODE_CONDITIONAL_REQUIRED_FIELDS,
  NODE_STATUSES,
  type KalfaNodeType,
} from './types';
import { TRIGGER_SWITCH_FORMAT } from './ui-formats';

// ---------------------------------------------------------------------------
// Option sets — the same `{ label, value }` shape the SDK's own statusOptions use
// ---------------------------------------------------------------------------

export const rsvpStatusOptions = {
  attending: { label: 'מגיע/ה', value: RSVP_STATUSES[0] },
  declined: { label: 'לא מגיע/ה', value: RSVP_STATUSES[1] },
  maybe: { label: 'אולי', value: RSVP_STATUSES[2] },
} as const;

// The two handles an action node draws, as DATA — the same mechanism already
// proven on `logic.condition`, whose branches were verified rendering on a live
// canvas. `templateType: NodeType.DecisionNode` on the palette entry turns each
// array member into a labelled handle.
//
// The error handle is what makes `errorPolicy: 'errorRoute'` reachable at all.
// It leaves the editor as `source:inner:error` and the adapter rewrites it to
// the runner's reserved `errorRoute` — see ACTION_BRANCH_HANDLES.
export const actionBranches = [
  { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'הצליח' },
  { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
] as const;

export const actionBranchesProperty = {
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

// Hebrew labels, authored here rather than taken from the SDK's exported
// `errorPolicyProperty`. That fragment ships English strings ("Fail workflow")
// inside the JSON schema, where our i18n bundle cannot reach them — i18n
// translates SDK chrome, not schema option labels. The `value` strings are the
// SDK's own, because the runner compares against those.
export const errorPolicyOptions = {
  fail: { label: 'עצור את כל התהליך', value: ERROR_POLICIES[0] },
  continue: { label: 'המשך, וסמן את ההרצה כהושלמה', value: ERROR_POLICIES[1] },
  errorRoute: { label: 'המשך במסלול השגיאה', value: ERROR_POLICIES[2] },
} as const;

/**
 * ⚠️ OUR HAND-WRITTEN LIST, PINNED TO THE SDK'S.
 *
 * `ERROR_POLICIES` lives in `catalogue/types.ts` because the SERVER reads it and
 * the server must not reach this file — like `schemas.ts`, it imports SDK runtime
 * values and resolves to a client reference when imported from a server module,
 * which is what `server-code-must-not-reach-the-editor-sdk` exists to stop. So
 * the list is written twice: once here in a shape the SDK owns, once there in a
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
export const nodeStatusOptions = {
  active: { label: 'פעיל', value: statusOptions.active.value, icon: statusOptions.active.icon },
  draft: { label: 'טיוטה', value: statusOptions.draft.value, icon: statusOptions.draft.icon },
  disabled: {
    label: 'מושבת',
    value: statusOptions.disabled.value,
    icon: statusOptions.disabled.icon,
  },
} as const satisfies Record<(typeof NODE_STATUSES)[number], { label: string; value: string; icon: string }>;

export const statusProperty = {
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
export const requiredText = { type: 'string', minLength: 1, pattern: '\\S' } as const;

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
export function conditionalRules(nodeType: KalfaNodeType) {
  return (NODE_CONDITIONAL_REQUIRED_FIELDS[nodeType] ?? []).flatMap((rule) =>
    rule.whenIn.map((value) => ({
      if: { properties: { [rule.decidedBy]: { const: value } } },
      then: { required: [rule.require], properties: { [rule.require]: requiredText } },
    })),
  );
}

/** `label` + `description`, both required on every node type. */
export const identityProperties = {
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
export const triggerSwitchElement = {
  type: 'Label',
  text: '',
  options: { format: TRIGGER_SWITCH_FORMAT },
} as const;

// The one control, spelled once. Every node's uischema ends with it, so the
// switch sits in the same place on every panel.
export function statusControl(scope: string): UISchema {
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
 *     `catalogue/templates/` or in a palette `defaultPropertiesData`. The owner could
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
export function identityControls(labelScope: string, descriptionScope: string): UISchema[] {
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
