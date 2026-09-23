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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// ---------------------------------------------------------------------------

describe('⚠️ every default key is a key the schema declares', () => {
  // THE DEFECT THIS PINS WAS LIVE, and it is a different shape from the one at
  // the top of this file. That one was a default whose VALUE was not offered;
  // this one is a default whose KEY does not exist.
  //
  // `trigger.webhook` seeded `token: ''` while its schema, its uischema scope
  // (`properties.tokenHash`) and NODE_REQUIRED_FIELDS all say `tokenHash`. So a
  // webhook trigger dragged from the palette was born carrying a field nothing
  // reads, and WITHOUT the one field that makes the trigger addressable — the
  // sha256 the incoming route matches on. The owner's report was the symptom
  // stated exactly: "there is no way to actually set the trigger that fires it".
  //
  // NOTHING CAUGHT IT AND NOTHING COULD. The key is a bare string in three
  // separate files; `satisfies NodeSchema` types the schema, not the defaults,
  // so tsc sees two unrelated object literals. Templates were unaffected — they
  // spell `tokenHash` correctly — which is why the suite stayed green while the
  // palette was broken.
  //
  // Found by auditing all palette items at once; exactly one was wrong. This
  // test is that audit, kept.
  const rows = PALETTE_ITEMS.map((item) => {
    const declared = Object.keys(
      (item.schema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    const seeded = Object.keys(item.defaultPropertiesData ?? {});
    const required = ((item.schema as { required?: string[] }).required ?? []) as string[];
    return {
      type: item.type,
      undeclared: seeded.filter((k) => !declared.includes(k)),
      requiredNotSeeded: required.filter((k) => !seeded.includes(k)),
    };
  });

  // Anti-no-op: an empty palette would make both assertions below vacuous.
  it('the palette is not empty and every item carries a schema', () => {
    expect(rows.length).toBeGreaterThan(10);
    for (const item of PALETTE_ITEMS) expect(item.schema).toBeTruthy();
  });

  it('seeds no key the schema does not declare', () => {
    expect(
      rows.filter((r) => r.undeclared.length > 0).map((r) => `${r.type}: ${r.undeclared.join()}`),
    ).toEqual([]);
  });

  it('seeds every field the schema marks required', () => {
    // A required field may be seeded BLANK — that is the documented shape of "a
    // template is a valid draft" (see the note above about blanks). What it may
    // not be is ABSENT, because then the control bound to it has nothing to
    // write into and the owner has no way to fill it.
    expect(
      rows
        .filter((r) => r.requiredNotSeeded.length > 0)
        .map((r) => `${r.type}: ${r.requiredNotSeeded.join()}`),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('⚠️ a custom-renderer field carries a Hebrew label, or JsonForms writes an English one', () => {
  // MEASURED 2026-09-22, and it had been live: `messageKinds`, `days`, `headers`
  // and `statuses` rendered as "Message Kinds", "Days", "Headers", "Statuses"
  // inside Hebrew accordions. Hebrew and RTL are the product's primary
  // interface, so that is a requirement failure, not a cosmetic one.
  //
  // THE MECHANISM, because it is not obvious from the uischema: these three
  // renderers draw the label themselves —
  //   checkbox-list-control.tsx:100     <FormControlWithLabel label={label} …>
  //   header-rows-control.tsx:137       <FormControlWithLabel label={label} …>
  //   integration-connection-control.tsx
  // `label` is whatever JsonForms computed. With no `label` in the uischema and
  // no i18n entry, JsonForms falls back to `startCase(scope)` — English, from
  // the field name. So for THESE formats a missing label is not "no label", it
  // is "an English label".
  //
  // ⚠️ SCOPED TO THE CUSTOM FORMATS ON PURPOSE. A plain control may legitimately
  // omit `label` and take its text from a sibling `{ type: 'Label' }` in the
  // same HorizontalLayout — `maxGuests` does exactly that ('עד כמה אורחים'), and
  // a blanket "every control needs a label" rule would fail it wrongly. The
  // enclosing Accordion's label is likewise NOT a substitute: it sits above the
  // field, and the English one still prints underneath it.
  //
  // `decisionBranches` is the documented exception and needs no uischema label:
  // `i18n-he.ts` carries `decisionBranches.label` ('כותרת'), which i18next
  // resolves because that namespace is flat.
  const LABEL_DRAWING_FORMATS = new Set([
    'kalfa-checkbox-list',
    'kalfa-header-rows',
    'integration-connection',
  ]);

  const offenders: string[] = [];
  const seen: string[] = [];
  const walk = (el: unknown, nodeType: string) => {
    if (!el || typeof el !== 'object') return;
    const e = el as {
      scope?: string;
      label?: unknown;
      elements?: unknown[];
      options?: { format?: string };
    };
    const format = e.options?.format;
    if (typeof e.scope === 'string' && typeof format === 'string' && LABEL_DRAWING_FORMATS.has(format)) {
      seen.push(`${nodeType}:${e.scope}`);
      if (typeof e.label !== 'string' || e.label.trim() === '') {
        offenders.push(`${nodeType} → ${e.scope.split('/').pop()} (format ${format})`);
      }
    }
    if (Array.isArray(e.elements)) for (const c of e.elements) walk(c, nodeType);
  };
  for (const item of PALETTE_ITEMS) walk(item.uischema, item.type);

  it('the scan actually reached some of these fields', () => {
    // Anti-no-op: if the formats are ever renamed, the set above silently matches
    // nothing and the assertion below passes on an empty list.
    expect(seen.length).toBeGreaterThan(3);
  });

  it('every one of them has a Hebrew label', () => {
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('⚠️ every palette entry is type-checked against its own schema', () => {
  // THE COMPILE-TIME HALF of the rule this file already enforces at run time.
  //
  // `PALETTE_ITEMS` is declared `PaletteItem[]` — the bare form, which carries
  // no schema — so `defaultPropertiesData` was checked against nothing. That is
  // how `trigger.webhook` came to seed `token` while its schema, uischema and
  // NODE_REQUIRED_FIELDS all said `tokenHash`, with tsc silent and the whole
  // suite green.
  //
  // `satisfies PaletteItem<typeof xSchema>` on each entry fixes that half: an
  // undeclared key is now a BUILD error, not a test failure. MEASURED — adding
  // `bogusFieldNotInSchema` to one entry produced
  //   TS2353: Object literal may only specify known properties …
  //
  // ⚠️ IT DOES NOT REPLACE THE RUN-TIME CHECKS ABOVE, and the boundary is exact.
  // `PaletteItem<T>.defaultPropertiesData` is `NodeDataProperties<T>`, which is
  // `MakePropertiesOptional<…>` — so a MISSING required field still type-checks
  // clean. Measured the same way: deleting a required default produced no error
  // at all. The vendor's own starter adds `Required<NodeDataProperties<S>>` on
  // the defaults constant to close that half; our defaults are inline, so the
  // test above closes it instead. Both halves, two mechanisms.
  //
  // This test only guards that the clause is PRESENT — the compiler does the
  // rest. Without it a 23rd node would silently opt out.
  const source = readFileSync(join(__dirname, 'schemas.ts'), 'utf8');

  const entries = [...source.matchAll(/^ {4}type: '([a-z_.]+)' satisfies KalfaNodeType,$/gm)];

  it('the scan found the palette — not an empty file or a changed spelling', () => {
    expect(entries.length).toBe(PALETTE_ITEMS.length);
    expect(entries.length).toBeGreaterThan(20);
  });

  it('⚠️ each one carries `satisfies PaletteItem<typeof …Schema>`', () => {
    const without = entries
      .filter((entry, i) => {
        const to = i + 1 < entries.length ? entries[i + 1]!.index : source.length;
        return !source.slice(entry.index, to).includes('satisfies PaletteItem<');
      })
      .map((entry) => entry[1]);

    expect(without).toEqual([]);
  });
});
