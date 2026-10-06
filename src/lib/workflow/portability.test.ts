import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  readImportEnvelope,
  scrubForExport,
  WORKFLOW_EXPORT_FORMAT,
  WORKFLOW_EXPORT_VERSION,
} from './portability';

const NOW = () => Date.parse('2026-09-16T21:00:00.000Z');

// The three built-in voice purposes ship with the product (seeded by
// 20260914085729 with `is_builtin = true`); `purchase_callback` was created by
// an operator here and exists nowhere else. Template keys are a compiled-in
// list, so they always travel.
const BUILT_IN = new Set(['rsvp', 'meeting_confirm', 'sales']);
const isPortable = (property: string, value: string) =>
  property === 'purposeKey' ? BUILT_IN.has(value) : true;

function node(type: string, properties: Record<string, unknown>, id = 'n1') {
  return { id, position: { x: 0, y: 0 }, data: { type, properties } };
}

function definition(nodes: unknown[]) {
  return { name: 'תהליך', layoutDirection: 'DOWN', nodes, edges: [], globalVariables: [] };
}

function propertiesOf(envelope: ReturnType<typeof scrubForExport>, index = 0) {
  return (envelope.workflow.nodes[index] as { data: { properties: Record<string, unknown> } })
    .data.properties;
}

describe('what never leaves this installation', () => {
  it('⚠️ removes the webhook trigger token, which is the trigger’s whole credential', () => {
    const result = scrubForExport(
      definition([node('trigger.webhook', { label: 'נכנס', tokenHash: 'a'.repeat(64) })]),
      isPortable,
      NOW,
    );

    expect(propertiesOf(result).tokenHash).toBe('');
    expect(JSON.stringify(result)).not.toContain('a'.repeat(64));
    expect(result.removed).toEqual([
      expect.objectContaining({ property: 'tokenHash', binding: 'identifier', nodeLabel: 'נכנס' }),
    ]);
  });

  it('removes a connection uuid, which resolves to nothing elsewhere', () => {
    const result = scrubForExport(
      definition([
        node('action.microsoft_send_email', {
          label: 'מייל',
          connectionId: '11111111-2222-4333-8444-555555555555',
          to: 'guest@example.com',
          subject: 'נושא',
          body: 'תוכן',
        }),
      ]),
      isPortable,
      NOW,
    );

    expect(propertiesOf(result).connectionId).toBe('');
    // Everything the author actually wrote survives.
    expect(propertiesOf(result)).toMatchObject({
      to: 'guest@example.com',
      subject: 'נושא',
      body: 'תוכן',
    });
  });

  it('⚠️ removes webhook headers and url — an owner may have typed a literal secret', () => {
    // Not hypothetical: dry-run.ts already refuses to PRINT header values for
    // exactly this reason, and an export file travels further than a screenshot.
    const result = scrubForExport(
      definition([
        node('action.webhook', {
          label: 'קריאה',
          method: 'POST',
          url: 'https://hooks.example.test/t/abc123',
          headers: [{ name: 'X-Api-Key', value: 'literally-a-key' }],
          body: '{}',
        }),
      ]),
      isPortable,
      NOW,
    );

    expect(JSON.stringify(result)).not.toContain('literally-a-key');
    expect(JSON.stringify(result)).not.toContain('abc123');
    expect(propertiesOf(result).method).toBe('POST');
  });

  it('removes a reference to another workflow in this installation', () => {
    const result = scrubForExport(
      definition([
        node('action.start_for_each_guest', {
          label: 'לכל אורח',
          targetWorkflowId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          maxGuests: 50,
        }),
      ]),
      isPortable,
      NOW,
    );

    expect(propertiesOf(result).targetWorkflowId).toBe('');
    expect(propertiesOf(result).maxGuests).toBe(50);
  });

  it('blanks rather than deletes, so the form can still render the node', () => {
    // A required property that is ABSENT and one that is EMPTY take different
    // paths through the editor schema; the arming gate already refuses the empty
    // one by name, and deleting would leave a node the form cannot draw.
    const result = scrubForExport(
      definition([node('trigger.webhook', { label: 'נכנס', tokenHash: 'x' })]),
      isPortable,
      NOW,
    );

    expect(Object.hasOwn(propertiesOf(result), 'tokenHash')).toBe(true);
  });

  it('says nothing about a field that was never filled', () => {
    const result = scrubForExport(
      definition([node('trigger.webhook', { label: 'נכנס', tokenHash: '' })]),
      isPortable,
      NOW,
    );

    // Reporting it would tell an operator to re-supply something they never had.
    expect(result.removed).toEqual([]);
  });
});

describe('a catalogue key travels only where it exists', () => {
  it('keeps a built-in voice purpose', () => {
    const result = scrubForExport(
      definition([node('action.start_voice_call', { label: 'שיחה', purposeKey: 'rsvp' })]),
      isPortable,
      NOW,
    );

    expect(propertiesOf(result).purposeKey).toBe('rsvp');
    expect(result.removed).toEqual([]);
  });

  it('⚠️ removes a purpose this installation invented', () => {
    // `purchase_callback` is `is_builtin = false` — it exists here and nowhere
    // else, so carrying the key would produce a workflow that names nothing.
    const result = scrubForExport(
      definition([
        node('action.start_voice_call', { label: 'שיחה', purposeKey: 'purchase_callback' }),
      ]),
      isPortable,
      NOW,
    );

    expect(propertiesOf(result).purposeKey).toBe('');
    expect(result.removed).toEqual([
      expect.objectContaining({ property: 'purposeKey', binding: 'catalogue' }),
    ]);
  });

  it('keeps a message template key, which is compiled into the app', () => {
    const result = scrubForExport(
      definition([node('action.send_template', { label: 'תבנית', messageKey: 'reminder_1' })]),
      isPortable,
      NOW,
    );

    expect(propertiesOf(result).messageKey).toBe('reminder_1');
  });
});

describe('the envelope', () => {
  it('stamps a format and a version so a foreign file can be refused', () => {
    const result = scrubForExport(definition([]), isPortable, NOW);

    expect(result).toMatchObject({
      format: WORKFLOW_EXPORT_FORMAT,
      version: WORKFLOW_EXPORT_VERSION,
      exportedAt: '2026-09-16T21:00:00.000Z',
    });
  });

  it('⚠️ reports what was removed without carrying what it was', () => {
    const result = scrubForExport(
      definition([node('trigger.webhook', { label: 'נכנס', tokenHash: 'the-hash' })]),
      isPortable,
      NOW,
    );

    expect(result.removed[0]).toEqual({
      nodeId: 'n1',
      nodeType: 'trigger.webhook',
      nodeLabel: 'נכנס',
      property: 'tokenHash',
      binding: 'identifier',
    });
    expect(Object.values(result.removed[0])).not.toContain('the-hash');
  });

  it('leaves a node with no bound properties untouched, by identity', () => {
    const untouched = node('logic.wait', { label: 'המתנה', amount: 3, unit: 'hours' });
    const result = scrubForExport(definition([untouched]), isPortable, NOW);

    expect(result.workflow.nodes[0]).toBe(untouched);
  });
});

describe('reading a file someone handed us', () => {
  const good = () =>
    scrubForExport(
      definition([node('trigger.webhook', { label: 'נכנס', tokenHash: 'x' })]),
      isPortable,
      NOW,
    );

  it('accepts its own output and reports what must be supplied', () => {
    const result = readImportEnvelope(JSON.parse(JSON.stringify(good())));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition).toMatchObject({ name: 'תהליך', edges: [] });
    expect(result.mustBeSupplied).toEqual([
      expect.objectContaining({ property: 'tokenHash', binding: 'identifier' }),
    ]);
  });

  it('refuses anything that is not one of our files', () => {
    for (const candidate of [null, 'x', 42, {}, { nodes: [] }, { format: 'n8n' }]) {
      expect(readImportEnvelope(candidate)).toEqual({
        ok: false,
        rejection: { reason: 'not_an_export' },
      });
    }
  });

  it('refuses a version whose meaning it does not know', () => {
    expect(readImportEnvelope({ ...good(), version: 99 })).toEqual({
      ok: false,
      rejection: { reason: 'unsupported_version', found: 99 },
    });
  });

  it('⚠️ refuses a node type this installation does not have', () => {
    // A file written where a node exists and read where it does not would load a
    // node the editor cannot render and the converter cannot run.
    const foreign = {
      ...good(),
      workflow: { ...good().workflow, nodes: [node('action.send_carrier_pigeon', {})] },
    };

    expect(readImportEnvelope(foreign)).toEqual({
      ok: false,
      rejection: { reason: 'unknown_node_types', types: ['action.send_carrier_pigeon'] },
    });
  });

  it('⚠️ does not re-derive what is missing — it reports what the export removed', () => {
    // Recomputing would answer a different question: "what is blank now", which
    // includes every field the author simply never filled.
    const envelope = good();
    envelope.workflow.nodes = [node('trigger.webhook', { label: 'נכנס', tokenHash: '', keyword: '' })];

    const result = readImportEnvelope(envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mustBeSupplied.map((r) => r.property)).toEqual(['tokenHash']);
  });
});
