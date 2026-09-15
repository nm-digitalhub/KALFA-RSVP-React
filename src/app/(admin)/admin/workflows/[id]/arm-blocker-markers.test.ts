// Regression coverage for removing SDK-computed validation state before save.
//
// `errors` and `customErrors` belong to editor validation state, not to the
// persisted workflow definition. `stripComputedErrors` removes only those
// computed keys while preserving every other integration-data field.
import { describe, expect, it } from 'vitest';

import { stripComputedErrors } from './arm-blocker-markers';

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
