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
