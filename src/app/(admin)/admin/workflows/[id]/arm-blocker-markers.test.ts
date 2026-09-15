// The two pure halves of the editor's arm-blocker markers.
//
// `syncArmBlockerMarkers` itself talks to the SDK store and is exercised through
// the editor; what is testable — and what carries the risk — is the save-time
// strip and the legacy-shape repair. Both are pure, both fix a MEASURED defect
// in stored data, and both would be silent if they regressed.
import { Validator } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';

import { stripComputedErrors } from './arm-blocker-markers';
import { normalizeLegacyProperties } from './normalize-legacy-properties';

const node = (type: string, properties: Record<string, unknown>) => ({
  id: 'n1',
  position: { x: 0, y: 0 },
  data: { type, properties },
});

describe('stripComputedErrors', () => {
  it('⚠️ removes the validation state the save path has been persisting', () => {
    // Measured 2026-09-15: 8 of 22 stored nodes carry `properties.errors`,
    // because `makeSaveHandler` passes the payload through verbatim.
    const data = {
      name: 'w',
      nodes: [
        node('action.webhook', {
          url: 'https://example.com',
          errors: [{ keyword: 'required', message: 'stale' }],
          customErrors: [{ message: 'also stale' }],
        }),
      ],
    };

    const stripped = stripComputedErrors(data);
    const properties = stripped.nodes[0]!.data.properties;

    expect(properties).not.toHaveProperty('errors');
    expect(properties).not.toHaveProperty('customErrors');
    expect(properties.url).toBe('https://example.com');
  });

  it('keeps every other field, including ones this code has never heard of', () => {
    // The trap the save handler's own comment records: rebuilding the payload
    // from a chosen set of fields erased `globalVariables` on every save. This
    // removes two keys by NAME and copies the rest.
    const data = {
      name: 'w',
      globalVariables: { a: 1 },
      layoutDirection: 'RIGHT',
      nodes: [node('action.webhook', { url: 'u', somethingNew: 42, errors: [] })],
      edges: [{ id: 'e' }],
    };

    const stripped = stripComputedErrors(data);
    expect(stripped.globalVariables).toEqual({ a: 1 });
    expect(stripped.layoutDirection).toBe('RIGHT');
    expect(stripped.edges).toEqual([{ id: 'e' }]);
    expect(stripped.nodes[0]!.data.properties.somethingNew).toBe(42);
  });

  it('returns the same node objects when there is nothing to strip', () => {
    const clean = node('action.webhook', { url: 'u' });
    const data = { name: 'w', nodes: [clean] };
    expect(stripComputedErrors(data).nodes[0]).toBe(clean);
  });

  it('tolerates a payload with no nodes at all', () => {
    // A diagram mid-load, and the shape `IntegrationDataFormat` allows.
    const empty: { name: string; nodes?: unknown } = { name: 'w' };
    expect(stripComputedErrors(empty)).toEqual({ name: 'w' });

    const undefinedNodes: { name: string; nodes?: unknown } = { name: 'w', nodes: undefined };
    expect(stripComputedErrors(undefinedNodes)).toEqual({ name: 'w', nodes: undefined });
  });
});

describe('normalizeLegacyProperties', () => {
  it('⚠️ repairs the exact shape stored on the live ARMED workflow', () => {
    // "קליטת רשימת אורחים מוואטסאפ", is_active = true, stored with bare strings.
    // Its stored `errors` reads: Instance type "string" is invalid. Expected
    // "object" — an armed workflow marked invalid while running correctly,
    // because `matchesKind` accepts both shapes and the schema does not.
    const [repaired] = normalizeLegacyProperties(
      [node('trigger.whatsapp_inbound', { label: 't', messageKinds: ['text', 'button'] })],
      PALETTE_ITEMS,
    );

    expect(repaired!.data.properties.messageKinds).toEqual([
      { value: 'text' },
      { value: 'button' },
    ]);
  });

  it('⚠️ the repaired value passes the schema the editor validates against', () => {
    // The whole point, asserted against the real schema rather than by eye.
    const schema = PALETTE_ITEMS.find((i) => i.type === 'trigger.whatsapp_inbound')!.schema;

    const before = { label: 'ט', description: 'ת', messageKinds: ['text'] };
    expect(new Validator(schema as object).validate(before).valid).toBe(false);

    const [repaired] = normalizeLegacyProperties(
      [node('trigger.whatsapp_inbound', before)],
      PALETTE_ITEMS,
    );
    expect(
      new Validator(schema as object).validate(repaired!.data.properties).valid,
    ).toBe(true);
  });

  it('leaves the current object shape untouched, by reference', () => {
    const current = node('trigger.whatsapp_inbound', {
      messageKinds: [{ value: 'text' }],
    });
    expect(normalizeLegacyProperties([current], PALETTE_ITEMS)[0]).toBe(current);
  });

  it('repairs a mixed array without disturbing the objects in it', () => {
    const [repaired] = normalizeLegacyProperties(
      [node('trigger.whatsapp_inbound', { messageKinds: [{ value: 'text' }, 'button'] })],
      PALETTE_ITEMS,
    );
    expect(repaired!.data.properties.messageKinds).toEqual([
      { value: 'text' },
      { value: 'button' },
    ]);
  });

  it('covers every array-of-objects field, not a hardcoded list', () => {
    // `days` on the schedule trigger is the second one, and it was never named
    // in this module — the fields come from each node type's own schema.
    const [repaired] = normalizeLegacyProperties(
      [node('trigger.schedule', { time: '09:00', days: ['sunday', 'monday'] })],
      PALETTE_ITEMS,
    );
    expect(repaired!.data.properties.days).toEqual([
      { value: 'sunday' },
      { value: 'monday' },
    ]);
  });

  it('leaves a node type the palette does not know', () => {
    const unknown = node('action.from_the_future', { messageKinds: ['text'] });
    expect(normalizeLegacyProperties([unknown], PALETTE_ITEMS)[0]).toBe(unknown);
  });

  it('leaves a non-array value alone rather than guessing at it', () => {
    const odd = node('trigger.whatsapp_inbound', { messageKinds: 'text' });
    expect(normalizeLegacyProperties([odd], PALETTE_ITEMS)[0]).toBe(odd);
  });
});
