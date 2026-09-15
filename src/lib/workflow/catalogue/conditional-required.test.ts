// "This field is required, but only when that field says so."
//
// ⚠️ THE CONTRACT, STATED ONCE: a webhook body is meaningless on GET or DELETE
// and mandatory on the three verbs that send one. `sendOutboundWebhook` already
// branches exactly there — it builds, resolves and secret-checks the body and
// then, for GET and DELETE, does not send it — so the panel was offering a
// three-row editor for a field that went nowhere, and accepting an empty one for
// a POST that needs it.
//
// ⚠️ AND IT TAKES TWO GATES, WHICH IS NOT A COMPROMISE BUT A PROPERTY OF JSON
// SCHEMA. `then` is `{ properties: … }` — the SDK's `ConditionalSchema` has no
// root `required` slot — and `properties` never makes a key mandatory. So:
//
//   schema `allOf`   →  body is PRESENT AND BLANK   (caught in the panel)
//   `findArmBlockers`→  body is ABSENT              (caught at arming)
//
// Both read `NODE_CONDITIONAL_REQUIRED_FIELDS`. This file pins each half against
// the real artefact: the exported schema object through the validator the SDK
// actually bundles, and `findArmBlockers` through its own public entry point.
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

  it('⚠️ an ABSENT body passes the schema — which is why the arm gate exists', () => {
    // Not a defect and not a gap left open: `then: { properties: { body } }`
    // constrains the key only if it is there, and the typed subset offers no
    // root `required` to put inside `then`. `findArmBlockers` covers it, and the
    // test below proves that rather than assuming it.
    expect(valid({ method: 'POST' })).toBe(true);
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
          properties: { label: 'טריגר', description: 'ת', token: 'tok' },
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
