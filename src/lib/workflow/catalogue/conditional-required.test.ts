// "This field is required, but only when that field says so."
//
// ⚠️ THE CONTRACT, STATED ONCE: a webhook body is meaningless on GET or DELETE
// and mandatory on the three verbs that send one. `sendOutboundWebhook` already
// branches exactly there — it builds, resolves and secret-checks the body and
// then, for GET and DELETE, does not send it — so the panel was offering a
// three-row editor for a field that went nowhere, and accepting an empty one for
// a POST that needs it.
//
// ⚠️ THE SCHEMA CARRIES THE WHOLE CONTRACT, and an earlier version of this file
// asserted it could not. The claim was that `ConditionalSchema` is typed
// `{ properties: … }` with no root `required`, so `then` could only constrain a
// body that was already there. The TYPE is that narrow; it does not bind. A
// function return is compared structurally, not as a fresh literal, so `then`
// may carry `required` alongside `properties` with no cast — and the bundled
// validator honours it. Both assertions below are the proof.
//
// `findArmBlockers` applies the SAME declaration a second time. Not as a
// fallback for a gap, but because the schema runs in the EDITOR: a definition
// that arrives by import, API call or a direct row edit never meets it. Arming
// is the layer nothing bypasses, which is why both are pinned here.
import { Validator } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

import { findArmBlockers } from './arm-check';
import { PALETTE_ITEMS } from './schemas';
import {
  activeConditionalRequirements,
  DEFAULT_HTTP_METHOD,
  HTTP_METHODS,
  HTTP_METHODS_WITH_BODY,
  NODE_CONDITIONAL_REQUIRED_FIELDS,
  NODE_REQUIRED_FIELDS,
  type KalfaNodeType,
} from './types';

/** The exact schema the editor loads — not a hand-built copy of it. */
const webhookSchema = PALETTE_ITEMS.find((i) => i.type === 'action.webhook')!.schema;

const valid = (data: Record<string, unknown>) =>
  new Validator(webhookSchema as object).validate({
    label: 'קריאה',
    description: 'ת',
    url: 'https://example.com/hook',
    ...data,
  }).valid;

describe('the schema half — @cfworker/json-schema 4.1.1, the SDK’s own validator', () => {
  it('⚠️ a verb that SENDS a body refuses a blank one', () => {
    for (const method of HTTP_METHODS_WITH_BODY) {
      expect(valid({ method, body: '' }), `${method} accepted an empty body`).toBe(false);
    }
  });

  it('⚠️ …and WHITESPACE-ONLY counts as blank, the same way the arm gate counts it', () => {
    // The divergence this closes: `minLength: 1` counts CHARACTERS, so '   ' is
    // three of them and passed — while `arm-check.ts` tests `value.trim() === ''`
    // and refused the same value. The schema said fine, arming said no, which is
    // the exact shape of the bug `minLength` was added to fix, one step in.
    // `pattern: '\\S'` is what makes the two agree.
    //
    // Both fixtures are here deliberately: this file used to test the schema
    // with '' and the arm gate with '   ', so neither half ever saw the case
    // that disagreed.
    for (const method of HTTP_METHODS_WITH_BODY) {
      expect(valid({ method, body: '   ' }), `${method} accepted a whitespace body`).toBe(false);
      expect(valid({ method, body: '\t\n' }), `${method} accepted a tab/newline body`).toBe(false);
    }
  });

  it('a body that is whitespace AROUND real content is fine', () => {
    // `'\\S'` is unanchored — it asks for at least one non-whitespace character,
    // not for a trimmed string. Refusing ' x ' would invent a rule the engine
    // does not have.
    expect(valid({ method: 'POST', body: ' {"ok":true} ' })).toBe(true);
  });

  it('…and accepts one that is filled in', () => {
    for (const method of HTTP_METHODS_WITH_BODY) {
      expect(valid({ method, body: '{"ok":true}' }), `${method} rejected a real body`).toBe(true);
    }
  });

  it('a verb that sends NO body accepts a blank one — the floor is not global', () => {
    for (const method of HTTP_METHODS.filter((m) => !(HTTP_METHODS_WITH_BODY as readonly string[]).includes(m))) {
      expect(valid({ method, body: '' }), `${method} rejected an empty body`).toBe(true);
    }
  });

  it('⚠️ an ABSENT body is refused too — `then` carries `required`', () => {
    // The assertion this file was rewritten for. `properties` alone would let an
    // absent key through; `required` inside `then` is what closes it, and it
    // compiles with no cast despite the SDK typing `ConditionalSchema` without
    // a root `required`.
    expect(valid({ method: 'POST' })).toBe(false);
    // …and only for the verbs that send one.
    expect(valid({ method: 'GET' })).toBe(true);
    expect(valid({ method: 'DELETE' })).toBe(true);
  });

  it('an ABSENT method behaves as POST, matching `readMethod`', () => {
    // `if: { properties: { method: { const: 'POST' } } }` matches an object with
    // no `method` at all, so every branch fires and they share one `then`. That
    // agrees with the runtime, whose `readMethod` falls back to POST.
    expect(HTTP_METHODS_WITH_BODY as readonly string[]).toContain(DEFAULT_HTTP_METHOD);
    expect(valid({ body: '' })).toBe(false);
  });
});

describe('the arm-gate half', () => {
  const webhookNode = (properties: Record<string, unknown>) => ({
    name: 'w',
    nodes: [
      {
        id: 'h',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          segments: [],
          type: 'action.webhook',
          properties: {
            label: 'קריאה',
            description: 'ת',
            url: 'https://example.com/hook',
            ...properties,
          },
        },
      },
      {
        id: 't',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          segments: [],
          type: 'trigger.webhook',
          properties: {
            label: 'טריגר',
            description: 'ת',
            endpointId: 'ep',
            tokenHash: 'a'.repeat(64),
          },
        },
      },
    ],
    edges: [{ id: 'e', source: 't', target: 'h' }],
  });

  const bodyMessage =
    'סוג הבקשה שנבחר שולח גוף, והגוף ריק. כתבו את גוף הבקשה, או החליפו ל-GET / DELETE שאינם שולחים גוף.';

  it('⚠️ an ABSENT body blocks arming for a verb that sends one', () => {
    expect(findArmBlockers(webhookNode({ method: 'POST' }))).toEqual([
      `הצעד "קריאה": ${bodyMessage}`,
    ]);
  });

  it('a BLANK body gets the same sentence, not "the field is empty"', () => {
    // The generic message cannot serve here: the field is only empty-and-wrong
    // for some verbs, and the owner needs to know which half to change.
    expect(findArmBlockers(webhookNode({ method: 'POST', body: '   ' }))).toEqual([
      `הצעד "קריאה": ${bodyMessage}`,
    ]);
  });

  it('GET and DELETE arm with no body at all', () => {
    for (const method of ['GET', 'DELETE']) {
      expect(findArmBlockers(webhookNode({ method })), `${method} was blocked`).toEqual([]);
    }
  });

  it('an absent method is treated as POST here too — the two gates agree', () => {
    expect(findArmBlockers(webhookNode({}))).toEqual([`הצעד "קריאה": ${bodyMessage}`]);
  });

  it('a filled body arms on every verb', () => {
    for (const method of HTTP_METHODS) {
      expect(findArmBlockers(webhookNode({ method, body: 'x' })), method).toEqual([]);
    }
  });
});

describe('⚠️ the schema and the arm gate agree on what "blank" means', () => {
  // The general rule, not just the webhook body. Both gates decide the same
  // question — "is this field filled in?" — and they used to answer it with
  // different primitives: `minLength` counts characters, `trim()` ignores
  // whitespace. Any required text field is a place they could drift again.
  const WHITESPACE = ['', ' ', '   ', '\t', '\n', '\t \n'];

  for (const item of PALETTE_ITEMS) {
    const type = item.type as KalfaNodeType;
    const properties =
      (item.schema as { properties?: Record<string, { type?: unknown; pattern?: unknown }> })
        .properties ?? {};

    const textFields = (NODE_REQUIRED_FIELDS[type] ?? []).filter(
      (field) => properties[field]?.type === 'string',
    );
    if (textFields.length === 0) continue;

    it(`${type} refuses whitespace-only in every required text field`, () => {
      for (const field of textFields) {
        const schema = { type: 'object', properties: { [field]: properties[field] } };
        for (const blank of WHITESPACE) {
          const schemaSaysValid = new Validator(schema as object).validate({ [field]: blank }).valid;
          const armGateSaysValid = blank.trim() !== '';
          expect(
            schemaSaysValid,
            `${type}.${field} with ${JSON.stringify(blank)}: schema=${schemaSaysValid}, armGate=${armGateSaysValid}`,
          ).toBe(armGateSaysValid);
        }
      }
    });
  }
});

describe('the declaration itself', () => {
  it('⚠️ every fallback is inside its own `whenIn`, or the branches contradict', () => {
    // `if: { properties: { x: { const: … } } }` matches an object with no `x`,
    // so on a legacy diagram EVERY branch of a rule fires at once. That is
    // harmless only while they share one `then` — which is what this guarantees.
    for (const [type, rules] of Object.entries(NODE_CONDITIONAL_REQUIRED_FIELDS)) {
      for (const rule of rules ?? []) {
        expect(rule.whenIn, `${type}.${rule.require}`).toContain(rule.fallback);
      }
    }
  });

  it('a conditionally-required field is NOT also unconditionally required', () => {
    // Listing it in both would make the condition a lie: the flat list wins and
    // the field would be demanded on every verb.
    for (const [type, rules] of Object.entries(NODE_CONDITIONAL_REQUIRED_FIELDS)) {
      for (const rule of rules ?? []) {
        expect(NODE_REQUIRED_FIELDS[type as KalfaNodeType] ?? [], `${type}.${rule.require}`).not.toContain(
          rule.require,
        );
      }
    }
  });

  it('activeConditionalRequirements reads the decider the way the runtime does', () => {
    const active = (properties: Record<string, unknown>) =>
      activeConditionalRequirements('action.webhook', properties).map((r) => r.require);

    expect(active({ method: 'POST' })).toEqual(['body']);
    expect(active({ method: 'GET' })).toEqual([]);
    // A jsonb column can hold anything; anything unusable behaves as absent,
    // which behaves as the fallback. Stricter than the code that runs would be
    // the mistake `arm-check.ts` exists to avoid making twice.
    expect(active({ method: 42 })).toEqual(['body']);
    expect(active({ method: '  ' })).toEqual(['body']);
    expect(active({})).toEqual(['body']);
  });
});
