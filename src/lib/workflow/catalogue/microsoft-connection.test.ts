import { describe, expect, it } from 'vitest';

import { buildPaletteItems, PALETTE_ITEMS } from './schemas';
import { INTEGRATION_CONNECTION_FORMAT } from './ui-formats';

function microsoftItem(items: ReturnType<typeof buildPaletteItems>) {
  return items.find((item) => item.type === 'action.microsoft_send_email')!;
}

type UiElement = {
  type?: string;
  scope?: string;
  options?: Record<string, unknown>;
  elements?: UiElement[];
};

/**
 * Find a control by the property it is bound to, ANYWHERE in the layout tree.
 *
 * Deliberately recursive. The first version of this test read `uischema.elements`
 * as a flat list, which was true right up until the panel grew a `Group` around
 * the account picker (2026-09-17) — and then it failed while the control it was
 * guarding was present and correct. What this test exists to protect is that
 * `connectionId` reaches OUR renderer, not where in the layout it sits, so the
 * lookup should not care which of the two changed.
 */
function controlFor(uischema: unknown, property: string): UiElement | undefined {
  const element = uischema as UiElement;
  if (element?.scope?.endsWith(property)) return element;

  for (const child of element?.elements ?? []) {
    const found = controlFor(child, property);
    if (found) return found;
  }
  return undefined;
}

describe('action.microsoft_send_email — live connection schema', () => {
  it('⚠️ routes connectionId to OUR renderer, which draws the OAuth connect button', () => {
    // Without this `format` the SDK renders its own plain Select: an owner with
    // no connection would see an empty dropdown and no way to make one without
    // leaving the editor. The two values beside it tell that renderer which
    // provider to start and which capability to ask for.
    const control = controlFor(microsoftItem(buildPaletteItems()).uischema, 'connectionId');

    expect(control?.type).toBe('Select');
    expect(control?.options).toEqual({
      format: INTEGRATION_CONNECTION_FORMAT,
      provider: 'microsoft',
      capability: 'mail.send',
    });
  });

  it('offers every new mail option a control', () => {
    // Each of these is in the schema; a field with no control is a field an
    // owner cannot reach, which the schema alone would never reveal.
    const uischema = microsoftItem(buildPaletteItems()).uischema;

    for (const [property, type] of [
      ['cc', 'VariableText'],
      ['bcc', 'VariableText'],
      ['replyTo', 'VariableText'],
      ['contentType', 'Select'],
      ['importance', 'Select'],
      ['saveToSentItems', 'Switch'],
    ] as const) {
      expect(controlFor(uischema, property)?.type, `${property} has no control`).toBe(type);
    }
  });

  it('offers the supplied labels while persisting connection UUIDs as values', () => {
    const connections = [
      { label: 'תיבת מכירות', value: '11111111-1111-4111-8111-111111111111' },
      { label: 'תיבת תמיכה', value: '22222222-2222-4222-8222-222222222222' },
    ];
    const item = microsoftItem(buildPaletteItems([], [], [], [], [], connections));
    const schema = item.schema as {
      properties: Record<string, { options?: typeof connections }>;
    };

    expect(schema.properties.connectionId?.options).toEqual(connections);
    expect(item.defaultPropertiesData?.connectionId).toBe('');
  });

  it('clones only the Microsoft schema and leaves the module palette untouched', () => {
    const built = buildPaletteItems([], [], [], [], [], [
      { label: 'תיבה', value: '11111111-1111-4111-8111-111111111111' },
    ]);
    const baseMicrosoft = PALETTE_ITEMS.find(
      (item) => item.type === 'action.microsoft_send_email',
    )!;

    expect(microsoftItem(built)).not.toBe(baseMicrosoft);
    expect(microsoftItem(built).schema).not.toBe(baseMicrosoft.schema);
    expect(
      (baseMicrosoft.schema as {
        properties: Record<string, { options?: unknown }>;
      }).properties.connectionId?.options,
    ).toBeUndefined();

    const rebuiltTypes = new Set([
      'trigger.whatsapp_inbound',
      'action.start_voice_call',
      'action.microsoft_send_email',
    ]);
    for (const item of built.filter((candidate) => !rebuiltTypes.has(candidate.type))) {
      const base = PALETTE_ITEMS.find((candidate) => candidate.type === item.type)!;

      // ⚠️ THE SCHEMA, NOT THE ITEM. Every entry is a fresh object now, because
      // `buildPaletteItems` also puts the run report on each one's uischema
      // (see `withNodeRunControl`). What this test exists to state is narrower
      // and still true: no entry but Microsoft's gets its SCHEMA rebuilt, and
      // the module-level array is never mutated in place.
      expect(item.schema, item.type).toBe(base.schema);
      expect(item.defaultPropertiesData, item.type).toBe(base.defaultPropertiesData);
      expect(base.uischema, `${item.type}: PALETTE_ITEMS was mutated`).not.toBe(item.uischema);
    }
  });
});
