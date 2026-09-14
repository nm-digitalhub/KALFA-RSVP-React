import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from './schemas';

// The conditional-visibility rule on `action.start_voice_call`, evaluated the way
// JsonForms evaluates it rather than merely declared.
//
// ⚠️ WHY IT IS WORTH A TEST. A rule is data, not code: a typo in `scope`, a
// `const` where `minLength` belongs, or a dropped `failWhenUndefined` all
// type-check and all fail silently in the one direction that matters — the field
// stays visible. The condition is reproduced here against the same ajv call the
// runtime makes, so a broken rule fails here instead of in an owner's editor.
//
// The evaluator, from @jsonforms/core (jsonforms-core.esm.js, `evaluateCondition`):
//
//   else if (isSchemaCondition(condition)) {
//     const value = resolveData(data, getConditionScope(condition, path));
//     if (condition.failWhenUndefined && value === undefined) return false;
//     return ajv.validate(condition.schema, value);
//   }
//
// Note what it validates: the RESOLVED VALUE, not the object around it. That is
// why the schema is `{ minLength: 1 }` and not `{ properties: { purposeKey: … } }`.

type Rule = {
  effect: string;
  condition: { scope: string; schema: object; failWhenUndefined?: boolean };
};

const voiceItem = PALETTE_ITEMS.find((i) => i.type === 'action.start_voice_call')!;
const elements = (voiceItem.uischema as { elements: { scope?: string; rule?: Rule }[] }).elements;
const waitControl = elements.find((e) => e.scope?.endsWith('waitForOutcome'))!;

/** `evaluateCondition`'s schema branch, with the same ajv semantics. */
function fulfilled(rule: Rule, value: unknown): boolean {
  if (rule.condition.failWhenUndefined && value === undefined) return false;
  return new Ajv().validate(rule.condition.schema, value) === true;
}

describe('"wait for the outcome" is hidden until a purpose is chosen', () => {
  it('the control carries a SHOW rule scoped to purposeKey', () => {
    expect(waitControl.rule).toBeDefined();
    expect(waitControl.rule!.effect).toBe('SHOW');
    // Scoped to the OTHER field. A rule scoped to itself always resolves to the
    // switch's own value and would hide the control as soon as it is turned off.
    expect(waitControl.rule!.condition.scope).toBe('#/properties/purposeKey');
  });

  it('⚠️ hides the switch when no purpose is chosen', () => {
    // `''` is what `defaultPropertiesData` ships, so this is the state an owner
    // sees the moment they drop the node on the canvas.
    expect(fulfilled(waitControl.rule!, '')).toBe(false);
  });

  it('shows it once a purpose is chosen', () => {
    expect(fulfilled(waitControl.rule!, 'feedback')).toBe(true);
  });

  it('⚠️ hides it when the key is ABSENT, not just empty', () => {
    // The trap @jsonforms/core documents in its own types: "Most JSON Schemas
    // will successfully validate against `undefined` data". Without
    // `failWhenUndefined`, a diagram saved before this field existed — where the
    // key is missing entirely — would PASS and show the switch.
    expect(waitControl.rule!.condition.failWhenUndefined).toBe(true);
    expect(fulfilled(waitControl.rule!, undefined)).toBe(false);

    // …and that it is the flag doing the work, not the schema.
    const withoutFlag = {
      ...waitControl.rule!,
      condition: { ...waitControl.rule!.condition, failWhenUndefined: false },
    };
    expect(fulfilled(withoutFlag, undefined)).toBe(true);
  });
});

// The rest of the node's form, pinned because it is data and a typo is silent.
describe('the voice node’s property panel', () => {
  const byType = (t: string) => elements.filter((e) => (e as { type: string }).type === t);

  it('⚠️ guidance sits BESIDE the purpose field, not only at arming time', () => {
    // An empty dropdown is a legitimate state here: the three `voice_purposes`
    // rows that ship are all built-in and the dialler refuses those by design.
    // So an owner can open this node, find nothing to pick, and have nothing on
    // screen saying a purpose must be created first. The arm gate says it, but
    // only when they try to arm.
    const message = byType('MessageOnError')[0] as { scope: string; text: string };
    expect(message).toBeDefined();
    expect(message.scope).toBe('#/properties/purposeKey');
    // Names the next action and where to take it — the same bar the arm-gate
    // blocker is held to.
    expect(message.text).toContain('/admin/integrations/voximplant');
  });

  it('the per-field error icon is suppressed where the message replaces it', () => {
    const select = elements.find(
      (e) => (e as { scope?: string }).scope === '#/properties/purposeKey',
    ) as { errorIndicatorEnabled?: boolean };
    // Two markers for one problem is noise; the message carries the explanation.
    expect(select.errorIndicatorEnabled).toBe(false);
  });

  it('the advanced field is collapsed, and only the advanced one', () => {
    const accordion = byType('Accordion')[0] as {
      label: string;
      elements: { scope: string }[];
    };
    expect(accordion).toBeDefined();
    expect(accordion.elements).toHaveLength(1);
    expect(accordion.elements[0]!.scope).toBe('#/properties/errorPolicy');

    // ⚠️ The fields an owner actually sets stay at the top level. A panel that
    // collapsed the purpose or the wait switch would hide the two decisions this
    // node exists to make.
    const topLevelScopes = elements.map((e) => (e as { scope?: string }).scope);
    expect(topLevelScopes).toContain('#/properties/purposeKey');
    expect(topLevelScopes).toContain('#/properties/waitForOutcome');
  });
});
