'use client';

// `action.start_voice_call` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { VoiceCallSchema } from './schema';

const voiceCallScope = getScope<VoiceCallSchema>;

export const voiceCallUiSchema = {
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
