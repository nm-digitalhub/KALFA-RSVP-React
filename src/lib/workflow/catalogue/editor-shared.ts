'use client';

// The editor helpers every node's schema and uischema are built from: the
// identity fields (name, description, arm notice), the per-step status switch,
// and the "required and not blank" string field.
//
// ⚠️ ITS OWN MODULE SO A NODE FOLDER CAN IMPORT IT. `schemas.ts` is the palette
// aggregator — it imports every moved node's palette file — so a node that
// imported these helpers from `schemas.ts` would close a cycle. Both import
// from here instead.
//
// CLIENT ONLY, for the reason `schemas.ts` gives: `sharedProperties` and
// `statusOptions` are runtime values from @workflowbuilder/sdk. Server code
// reads `types.ts` / `nodes.ts` and the node `definition.ts` files instead.
import { sharedProperties, statusOptions } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { ARM_NOTICE_PATH, NODE_STATUSES } from './types';

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
