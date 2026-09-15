// What a node carries the moment it is DROPPED, before the owner opens it.
//
// ⚠️ THE DEFECT THIS PINS REACHED THE TEAM'S QUEUE. `action.create_callback_request`
// seeded `topic: 'פנייה מתהליך אוטומטי'` — a string that is not in
// `CALLBACK_TOPICS`, which is where the Select's own options come from. So the
// dropdown rendered a value it did not offer, and a node dropped and never
// opened created a callback whose topic a human reads in the callback queue and
// the voice agent is handed as `{{topic_he}}`.
//
// The handler's blank-fallback (`steps/index.ts`: `topic === '' ? CALLBACK_TOPICS[0]`)
// did not save it, and could not: the default is non-blank, so the fallback
// never ran. That is the general shape of the bug — a default that is *valid*
// but not *offered* passes every schema check there is.
//
// So the rule is not about `topic`. It is: a field that presents a closed menu
// must be seeded from that menu.
import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from './schemas';
import {
  CALLBACK_TOPICS,
  DEFAULT_HTTP_METHOD,
  HTTP_METHODS_WITH_BODY,
  type KalfaNodeType,
} from './types';

type Option = { value: unknown; label?: string };
type Property = { options?: Option[] };

/** The options a field offers, or `undefined` when it is free text. */
function optionsOf(item: (typeof PALETTE_ITEMS)[number], field: string): Option[] | undefined {
  const properties = (item.schema as { properties?: Record<string, Property> }).properties ?? {};
  return properties[field]?.options;
}

describe('every seeded default is a value its own control offers', () => {
  for (const item of PALETTE_ITEMS) {
    const type = item.type as KalfaNodeType;

    it(`${type} seeds only offered values`, () => {
      const defaults = (item.defaultPropertiesData ?? {}) as Record<string, unknown>;

      const unoffered = Object.entries(defaults)
        .filter(([field]) => optionsOf(item, field) !== undefined)
        // ⚠️ A BLANK IS EXEMPT, AND THAT IS THE WHOLE DISTINCTION THIS TEST
        // DRAWS. `action.start_voice_call` seeds `purposeKey: ''` deliberately —
        // it is the "not chosen yet" state, the dial-parameter accordion is
        // gated on it being non-empty, and it is caught twice over anyway
        // (`minLength: 1` in the panel, `findArmBlockers` at arming, with a
        // message that says a purpose has to be created first).
        //
        // A NON-BLANK unoffered value is the dangerous one: it satisfies
        // `required`, it satisfies `minLength`, it satisfies the arm gate, and it
        // reaches production as a string nobody chose. That is exactly what
        // 'פנייה מתהליך אוטומטי' did.
        .filter(([, value]) => !(typeof value === 'string' && value.trim() === ''))
        .filter(([field, value]) => !optionsOf(item, field)!.some((o) => o.value === value))
        .map(([field, value]) => `${field}=${JSON.stringify(value)}`);

      expect(
        unoffered,
        `${type} seeds a value its dropdown does not list: ${unoffered.join(', ')}`,
      ).toEqual([]);
    });
  }

  it('the callback topic specifically — the field this file was written for', () => {
    const item = PALETTE_ITEMS.find((i) => i.type === 'action.create_callback_request');
    const seeded = (item?.defaultPropertiesData as { topic?: unknown } | undefined)?.topic;

    expect(CALLBACK_TOPICS).toContain(seeded);
    // And it is the same value the handler falls back to, so an owner who clears
    // the field and one who never touches it get the same topic in the queue.
    expect(seeded).toBe(CALLBACK_TOPICS[0]);
  });
});

// ⚠️ AND A BLANK REQUIRED FIELD IS NOT A DEFECT — the opposite rule to the one
// above, deliberately not asserted. Seven required fields ship seeded blank
// (`url`, `body`, `title`, `value`, `token`, `targetWorkflowId`, `purposeKey`),
// and every one of them is something only the owner can know: there is no
// sensible starting value for "the address to call" or "the message to send".
// `findArmBlockers` is the gate for those, and it names the field. A test
// demanding non-blank defaults here would need to exempt seven of eight cases,
// which is a test that asserts nothing.

// ⚠️ THE RULE THAT HIDES THE BODY BOX, AND WHY IT HAS NO `failWhenUndefined`.
//
// `sendOutboundWebhook` attaches a body only for a verb in
// `HTTP_METHODS_WITH_BODY`; on GET or DELETE the body is built, resolved and
// secret-checked, and then silently not sent. The panel offered a three-row
// editor for it anyway.
//
// The rule is SHOW on the with-body list rather than HIDE on its complement so
// it is derived from the same constant the runtime branches on. That choice only
// holds while an UNSET method still sends a body — which is exactly what the
// second assertion checks.
describe('the webhook body control follows the runtime', () => {
  const bodyRule = () => {
    const item = PALETTE_ITEMS.find((i) => i.type === 'action.webhook');
    const elements = (item?.uischema as { elements?: Array<Record<string, unknown>> }).elements ?? [];
    const control = elements.find((e) => String(e.scope ?? '').endsWith('/properties/body'));
    return control?.rule as
      | { effect: string; condition: { scope: string; schema: { enum?: unknown[] } } }
      | undefined;
  };

  it('shows the body only for the verbs that send one', () => {
    const rule = bodyRule();
    expect(rule?.effect).toBe('SHOW');
    expect(rule?.condition.scope).toMatch(/\/properties\/method$/);
    expect(rule?.condition.schema.enum).toEqual([...HTTP_METHODS_WITH_BODY]);
  });

  it('⚠️ an UNSET method still sends a body, so the rule must not fail on undefined', () => {
    // `readMethod` falls back to DEFAULT_HTTP_METHOD for a diagram saved before
    // the field existed. If that default ever leaves the with-body list, this
    // rule starts hiding a field that is in use and needs `failWhenUndefined`.
    expect(HTTP_METHODS_WITH_BODY as readonly string[]).toContain(DEFAULT_HTTP_METHOD);
    expect(bodyRule()).not.toHaveProperty('condition.failWhenUndefined');
  });
});
