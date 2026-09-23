// A field the arm gate refuses when blank must be a field the owner can type.
//
// ⚠️ THE DEFECT THIS PINS WAS SILENT AND LIVED IN PRODUCTION. `description` was
// listed in `NODE_REQUIRED_FIELDS` for all eighteen node types — so
// `findArmBlockers` refused to arm a workflow whose node had it blank — and no
// uischema declared a control for it, on any node. Measured 2026-09-15: 18
// required entries, 0 controls.
//
// It was not dead data either. The SDK's node body renders it: `fs({ label,
// description })` in the 2.3.0 bundle emits a title span followed by a subtitle
// span, and all four node templates call it. The owner read the sentence on the
// card and had no way to change it; the only writers were `templates.ts` and the
// palette's own `defaultPropertiesData`.
//
// So the rule this file states is not about `description`. It is the general
// one: every property that can BLOCK ARMING must be reachable from the panel
// that is supposed to fix it. The next field added to `NODE_REQUIRED_FIELDS`
// fails here until it has a control.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPaletteItems, PALETTE_ITEMS } from './schemas';
import { NODE_REQUIRED_FIELDS, type KalfaNodeType } from './types';

/** Every `scope` string anywhere in a uischema tree, controls and layouts alike. */
function collectScopes(element: unknown, found: string[] = []): string[] {
  if (!element || typeof element !== 'object') return found;
  const node = element as { scope?: unknown; elements?: unknown };
  if (typeof node.scope === 'string') found.push(node.scope);
  if (Array.isArray(node.elements)) {
    for (const child of node.elements) collectScopes(child, found);
  }
  return found;
}

/**
 * Fields a control cannot reasonably offer, with the reason each one is exempt.
 *
 * ⚠️ AN EXEMPTION IS A CLAIM THAT THE FIELD CANNOT BE BLANK, not a way to quiet
 * the test. Each entry below names something the palette seeds with a real value
 * and the owner never clears, so the arm gate can never fire on it.
 */
const EXEMPT: Partial<Record<KalfaNodeType, readonly string[]>> = {
  // ⚠️ THE ONE EXEMPTION, AND IT IS A DIFFERENT CLAIM FROM THE ONE ABOVE.
  //
  // `endpointId` CAN be blank — the palette seeds it `''` — so the usual
  // exemption reason ("seeded with a real value, never cleared") would be false
  // here and this entry must not rest on it.
  //
  // What is true instead: the field is reachable, just not by its own scope. The
  // address and the secret are minted TOGETHER by one control, because a node
  // carrying one without the other cannot be armed and there is no sequence in
  // which an owner would want to type either by hand. That control is scoped to
  // `tokenHash` and writes `endpointId` as its sibling, so the panel does offer
  // the only action that fills it — the generate button — and `collectScopes`
  // simply cannot see that.
  //
  // The claim is CHECKED rather than asserted: the test below scans the control
  // and fails if it stops writing the field. An exemption nobody verifies is the
  // thing this file exists to prevent.
  'trigger.webhook': ['endpointId'],
};

describe('every arm-blocking field is editable in the panel', () => {
  for (const item of PALETTE_ITEMS) {
    const type = item.type as KalfaNodeType;

    it(`${type} offers a control for each of its required fields`, () => {
      const scopes = collectScopes(item.uischema);
      const exempt = EXEMPT[type] ?? [];

      const unreachable = (NODE_REQUIRED_FIELDS[type] ?? [])
        .filter((field) => !exempt.includes(field))
        .filter((field) => !scopes.some((scope) => scope.endsWith(`/properties/${field}`)));

      expect(unreachable, `${type} has no control for: ${unreachable.join(', ')}`).toEqual([]);
    });
  }

  it('⚠️ the endpointId exemption is TRUE — the token control still writes it', () => {
    // Source-scanned rather than mocked, for the same reason
    // sdk-integration-invariants.test.ts scans: the guarantee is about what one
    // file DOES, and only that file can answer. If the write is ever removed,
    // `endpointId` becomes a required field with no way at all to fill it — the
    // exact defect (`description`, 18 types, 0 controls) this file was written
    // for, reintroduced through its own exemption list.
    const control = readFileSync(
      join(process.cwd(), 'src/app/(admin)/admin/workflows/[id]/webhook-token-control.tsx'),
      'utf8',
    );
    // Anti-no-op: a moved or renamed file would read empty and pass.
    expect(control.length).toBeGreaterThan(1000);
    expect(control).toContain('generateWebhookEndpointId');
    expect(control).toMatch(/handleChange\(endpointPath/);
  });

  it('description specifically — the field this file was written for', () => {
    const without = PALETTE_ITEMS.filter(
      (item) => !collectScopes(item.uischema).some((s) => s.endsWith('/properties/description')),
    ).map((item) => item.type);

    expect(without).toEqual([]);
    // Anti-no-op: the assertion above passes vacuously on an empty palette, so
    // the count is pinned. 21 since the two SUMIT accounting nodes
    // (create document / create customer) joined on 2026-09-22.
    expect(PALETTE_ITEMS.length).toBe(22);
  });
});

// A control the owner can reach is only half of it. `required` in JSON Schema
// means THE KEY IS PRESENT — `{ required: ['url'] }` accepts `{ url: '' }`, and
// the SDK's bundled `@cfworker/json-schema@4.1.1` agrees. So a node whose text
// field was cleared validated clean in the editor and was refused later by
// `findArmBlockers`, which tests the VALUE. `minLength: 1` is what moves the
// refusal back into the panel, where the field is.
describe('every required string field rejects the empty string', () => {
  for (const item of PALETTE_ITEMS) {
    const type = item.type as KalfaNodeType;

    it(`${type} declares minLength on its required text fields`, () => {
      const properties = (item.schema as { properties?: Record<string, unknown> }).properties ?? {};

      const unguarded = (NODE_REQUIRED_FIELDS[type] ?? []).filter((field) => {
        const property = properties[field] as { type?: unknown; minLength?: unknown } | undefined;
        if (!property || property.type !== 'string') return false;
        return typeof property.minLength !== 'number' || property.minLength < 1;
      });

      expect(
        unguarded,
        `${type} accepts an empty string for: ${unguarded.join(', ')}`,
      ).toEqual([]);
    });
  }

  // The factory rewrites two schemas at run time from live data (numbers,
  // voice purposes). Those rebuilt objects are what the editor actually loads,
  // so the guard has to survive the rewrite, not just the literal above it.
  it('survives the run-time rebuild of the two data-driven schemas', () => {
    for (const item of buildPaletteItems([], [], [], [], [])) {
      const properties = (item.schema as { properties?: Record<string, unknown> }).properties ?? {};

      for (const field of NODE_REQUIRED_FIELDS[item.type as KalfaNodeType] ?? []) {
        const property = properties[field] as { type?: unknown; minLength?: unknown } | undefined;
        if (property?.type !== 'string') continue;
        expect(property.minLength, `${item.type}.${field}`).toBe(1);
      }
    }
  });
});
