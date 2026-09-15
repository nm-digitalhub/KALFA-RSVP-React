import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS, buildPaletteItems } from './schemas';

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

    // ⚠️ TWO INDEPENDENT GUARDS, each pinned on its own — and it was ONE until
    // `type: 'string'` was added to the condition schema to settle an Ajv
    // strict-mode warning. That addition also made the schema reject `undefined`
    // by itself, so the older assertion here — "without the flag, undefined
    // PASSES" — stopped being true. It is replaced rather than deleted, because
    // what it was protecting still needs protecting: whichever guard a future
    // edit removes, the other must still hide the switch.

    // 1. The flag alone, against a schema loose enough to admit undefined.
    const flagOnly = {
      ...waitControl.rule!,
      condition: { ...waitControl.rule!.condition, schema: { minLength: 1 } },
    };
    expect(fulfilled(flagOnly, undefined)).toBe(false);

    // 2. The schema alone, with the flag off.
    const schemaOnly = {
      ...waitControl.rule!,
      condition: { ...waitControl.rule!.condition, failWhenUndefined: false },
    };
    expect(fulfilled(schemaOnly, undefined)).toBe(false);

    // And the schema's half also covers the case neither one caught before: a
    // legacy `null`, which is not undefined and so was never the flag's job.
    expect(fulfilled(waitControl.rule!, null as unknown as string)).toBe(false);
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
    // ⚠️ BY SCOPE, NOT BY POSITION — the second time this file learned that
    // lesson. `[0]` passed until `...globalControls` was spread in above, which
    // contributes its OWN MessageOnError (the SDK's missing-previous-variable
    // slot) and took index 0. The assertion was still true about the thing it
    // meant; it was just no longer looking at it.
    const message = byType('MessageOnError').find(
      (e) => (e as { scope?: string }).scope === '#/properties/purposeKey',
    ) as { scope: string; text: string };
    expect(message).toBeDefined();
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
    // ⚠️ BY LABEL, NEVER BY POSITION. This selected `[0]` until the dial-parameter
    // group landed above it, at which point the test read a different accordion
    // and failed while the thing it guards was still true. A panel gains groups;
    // an assertion that depends on their order is a tripwire for the next one.
    const accordion = byType('Accordion').find(
      (a) => (a as { label?: string }).label === 'מתקדם',
    ) as { label: string; elements: { scope: string }[] };
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

// The status control every OTHER node had.
//
// ⚠️ NOT A COSMETIC GAP. `arm-check.ts` reads `properties.status` and refuses to
// arm a diagram containing a node left on 'draft'. The voice node carried
// `status` in its schema and in its defaults, and rendered no control for it —
// so an owner could neither park it as a draft nor see why a diagram armed when
// they expected it not to. Seventeen of eighteen node types rendered one.
describe('every node type can set its own status', () => {
  it('⚠️ the voice node renders a status control', () => {
    const scopes: string[] = [];
    const walk = (el: { scope?: string; elements?: unknown[] }) => {
      if (el.scope) scopes.push(el.scope);
      for (const child of (el.elements ?? []) as { scope?: string; elements?: unknown[] }[]) {
        walk(child);
      }
    };
    walk(voiceItem.uischema as { elements: unknown[] });
    expect(scopes).toContain('#/properties/status');
  });

  it('⚠️ and so does every other node in the palette', () => {
    // The invariant the voice node broke, pinned for the whole palette so the
    // next node added cannot quietly repeat it.
    const missing: string[] = [];
    for (const item of PALETTE_ITEMS) {
      const scopes: string[] = [];
      const walk = (el: { scope?: string; elements?: unknown[] }) => {
        if (el.scope) scopes.push(el.scope);
        for (const c of (el.elements ?? []) as { scope?: string; elements?: unknown[] }[]) walk(c);
      };
      walk(item.uischema as { elements: unknown[] });
      // A node whose SCHEMA declares `status` must offer a control for it.
      const declares = 'status' in ((item.schema as { properties: object }).properties ?? {});
      if (declares && !scopes.includes('#/properties/status')) missing.push(item.type);
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The dial-parameter group
// ---------------------------------------------------------------------------

describe('the call node’s dial parameters', () => {
  const dialGroup = (
    voiceItem.uischema as { elements: { type?: string; label?: string; rule?: Rule; elements?: { scope?: string; type?: string }[] }[] }
  ).elements.find((e) => e.type === 'Accordion' && e.label === 'פרמטרי החיוג')!;

  it('groups all four dial fields, and nothing else', () => {
    expect(dialGroup).toBeDefined();
    expect(dialGroup.elements!.map((e) => e.scope)).toEqual([
      '#/properties/callerId',
      '#/properties/ruleId',
      '#/properties/agentId',
      '#/properties/toOverride',
    ]);
  });

  it('is hidden until a purpose is chosen — including on a diagram saved before the field existed', () => {
    // ⚠️ THE RULE IS ON THE LAYOUT, which the SDK supports: `BaseLayoutElement`
    // carries `rule?: UISchemaRule`, and the shipped Accordion renderer wraps in
    // a component that renders NOTHING when `visible` is false (verified in the
    // 2.3.0 bundle). One rule here therefore covers all four fields.
    expect(dialGroup.rule!.effect).toBe('SHOW');
    expect(fulfilled(dialGroup.rule!, 'feedback')).toBe(true);
    expect(fulfilled(dialGroup.rule!, '')).toBe(false);
    // The two traps the wait switch documents: a legacy node with no field at
    // all, and one carrying an explicit null.
    expect(fulfilled(dialGroup.rule!, undefined)).toBe(false);
    expect(fulfilled(dialGroup.rule!, null)).toBe(false);
  });

  it('the destination is a VariableText, so it can take a value from an earlier step', () => {
    const to = dialGroup.elements!.find((e) => e.scope?.endsWith('toOverride'))!;
    // A plain Text control offers no variable picker, which would make
    // "{{nodes.<id>.phone}}" something an owner has to know to type by hand.
    expect(to.type).toBe('VariableText');
  });

  it('every dial field ships blank, so no saved diagram changes behaviour', () => {
    const defaults = voiceItem.defaultPropertiesData as Record<string, unknown>;
    expect(defaults.callerId).toBe('');
    expect(defaults.ruleId).toBe('');
    expect(defaults.agentId).toBe('');
    expect(defaults.toOverride).toBe('');
  });
});

describe('buildPaletteItems — the live dial lists', () => {
  const built = (
    callerIds: { value: string; label: string }[] = [],
    rules: { value: string; label: string }[] = [],
    agents: { value: string; label: string }[] = [],
  ) => {
    const item = buildPaletteItems([], [], callerIds, rules, agents).find(
      (i) => i.type === 'action.start_voice_call',
    )!;
    return (item.schema as { properties: Record<string, { options?: { label: string; value: string }[] }> })
      .properties;
  };

  it('offers only the blank default when nothing has been loaded', () => {
    // The state every editor is in before a call node is selected, and the state
    // it stays in when a vendor is unreachable. Blank means "as configured
    // elsewhere" — never a broken control.
    const p = built();
    expect(p.callerId!.options).toEqual([{ label: 'ברירת המחדל של החשבון', value: '' }]);
    expect(p.ruleId!.options).toEqual([{ label: 'הכלל המוגדר לייעוד', value: '' }]);
    expect(p.agentId!.options).toEqual([{ label: 'הסוכן המוגדר בתרחיש', value: '' }]);
  });

  it('puts the live rows after the blank default, never in place of it', () => {
    // ⚠️ A dropdown with no way back to the default would make the first pick
    // permanent — the owner could never say "use the purpose's rule again".
    const p = built(
      [{ value: '+97233301505', label: 'ראשי' }],
      [{ value: '1520915', label: 'OutCallAgent — RSVPAgent' }],
      [{ value: 'agent_1', label: 'קלפה' }],
    );
    expect(p.callerId!.options![0]!.value).toBe('');
    expect(p.callerId!.options![1]).toEqual({ value: '+97233301505', label: 'ראשי' });
    expect(p.ruleId!.options![1]!.value).toBe('1520915');
    expect(p.agentId!.options![1]!.value).toBe('agent_1');
  });
});
