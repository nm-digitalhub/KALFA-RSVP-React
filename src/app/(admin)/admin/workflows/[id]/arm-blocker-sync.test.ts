// `syncArmBlockerMarkers` against a stand-in store.
//
// ⚠️ THE PROPERTY THIS EXISTS FOR IS TERMINATION. The effect that calls this is
// subscribed to `nodes`, and the function's own write — `setStoreNodes` —
// produces a node change. Without the equality check that is an infinite render
// loop in the admin editor, not a marker. Every other assertion here is detail;
// this one is why the file exists.
//
// The store is mocked because the real one needs a mounted `<Root>`. What is
// under test is this module's decision to write or not, which is exactly the
// part a mount would not make easier to see.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: { nodes: unknown[] } = { nodes: [] };
const setStoreNodes = vi.fn((nodes: unknown[]) => {
  // The real one replaces the list and re-validates, so the caller sees a new
  // array on the next read. Modelled, because a mock that kept the old nodes
  // would make a looping implementation look terminating.
  store.nodes = nodes;
});

vi.mock('@workflowbuilder/sdk', () => ({
  getStoreNodes: () => store.nodes,
  setStoreNodes: (nodes: unknown[]) => setStoreNodes(nodes),
}));

const { syncArmBlockerMarkers } = await import('./arm-blocker-markers');

/** A guest step under a clock trigger — the cross-node rule, in two nodes. */
const guestlessDiagram = () => [
  {
    id: 'trigger-1',
    position: { x: 0, y: 0 },
    data: {
      type: 'trigger.schedule',
      properties: { label: 'שעון', description: 'ת', time: '09:00' },
    },
  },
  {
    id: 'action-1',
    position: { x: 0, y: 120 },
    data: {
      type: 'action.send_whatsapp',
      properties: { label: 'שליחה', description: 'ת', body: 'שלום' },
    },
  },
];

const edges = [{ id: 'e1', source: 'trigger-1', target: 'action-1' }];

const errorsOn = (id: string) => {
  const node = store.nodes.find((n) => (n as { id: string }).id === id) as
    | { data: { properties: { customErrors?: Array<{ message: string }> } } }
    | undefined;
  return node?.data.properties.customErrors ?? [];
};

beforeEach(() => {
  setStoreNodes.mockClear();
  store.nodes = guestlessDiagram();
});

describe('syncArmBlockerMarkers', () => {
  it('⚠️ writes once and then stops — the loop-termination property', () => {
    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(setStoreNodes).toHaveBeenCalledTimes(1);

    // The effect re-runs because the nodes changed. It must not write again.
    syncArmBlockerMarkers('w', edges, 'wf-1');
    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(setStoreNodes).toHaveBeenCalledTimes(1);
  });

  it('marks the node the refusal belongs to, and only that one', () => {
    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(errorsOn('action-1').map((e) => e.message)).toEqual([
      expect.stringContaining('אינו מתחיל מאורח'),
    ]);
    expect(errorsOn('trigger-1')).toEqual([]);
  });

  it('writes the Ajv shape the SDK documents for customErrors', () => {
    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(errorsOn('action-1')[0]).toEqual({
      keyword: 'armBlocker',
      // ⚠️ `ARM_NOTICE_PATH`, NOT `''` — AND THAT IS THE WHOLE POINT OF THE
      // FIELD. A root-scoped error marks the node and lands next to nothing:
      // JsonForms attaches an external error to a control by matching this
      // against its `scope`, so `''` produced an exclamation mark the owner
      // could not explain until they pressed "arm". Every node's uischema now
      // carries a text-less `MessageOnError` on `#/properties/armNotice`, which
      // is the vendor's own display mechanism rather than a second one of ours.
      // Spelled literally rather than imported: this file mocks the SDK store,
      // and reaching `ARM_NOTICE_PATH` would pull in `types.ts` for a string.
      // `palette-defaults.test.ts` is where the constant and every uischema's
      // scope are proven to be the same value.
      instancePath: '/armNotice',
      schemaPath: '',
      params: {},
      message: expect.any(String),
    });
  });

  it('⚠️ CLEARS a marker once the diagram is fixed', () => {
    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(errorsOn('action-1')).toHaveLength(1);

    // Swap the clock for a trigger that does carry a guest.
    const fixed = store.nodes.map((n) => {
      const node = n as { id: string; data: { type: string; properties: Record<string, unknown> } };
      return node.id === 'trigger-1'
        ? { ...node, data: { ...node.data, type: 'trigger.whatsapp_inbound' } }
        : node;
    });
    store.nodes = fixed;
    setStoreNodes.mockClear();

    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(setStoreNodes).toHaveBeenCalledTimes(1);
    // Absent, not an empty array: the save handler strips this key by name and a
    // clean diagram should stay byte-identical to one saved before this existed.
    const node = store.nodes.find((n) => (n as { id: string }).id === 'action-1') as {
      data: { properties: Record<string, unknown> };
    };
    expect(node.data.properties).not.toHaveProperty('customErrors');
  });

  it('writes nothing at all for a diagram with no refusals', () => {
    store.nodes = guestlessDiagram().map((n) =>
      n.id === 'trigger-1'
        ? { ...n, data: { ...n.data, type: 'trigger.whatsapp_inbound' } }
        : n,
    );
    syncArmBlockerMarkers('w', edges, 'wf-1');
    expect(setStoreNodes).not.toHaveBeenCalled();
  });

  it('a diagram the parser cannot read produces no markers, not a crash', () => {
    // A shape `editorDiagramSchema` rejects outright — mid-drag, or from a
    // future version. `findArmBlockersByNode` returns [] rather than throwing,
    // so nothing is marked and nothing is written.
    store.nodes = [{ nonsense: true }];
    expect(() => syncArmBlockerMarkers('w', [], 'wf-1')).not.toThrow();
    expect(setStoreNodes).not.toHaveBeenCalled();
  });

  it('⚠️ a node whose only faults are SCHEMA faults gets no marker', () => {
    // The node carries no properties at all, so every required field is missing
    // — and every one of those is refused by its own JSON Schema, which already
    // marks the node and renders a message next to each field. Repeating them
    // here would be the same invariant injected twice at the data layer.
    store.nodes = [
      { id: 'x', position: { x: 0, y: 0 }, data: { type: 'action.send_whatsapp' } },
    ];
    syncArmBlockerMarkers('w', [], 'wf-1');

    expect(setStoreNodes).not.toHaveBeenCalled();
  });

  it('⚠️ an ARM-ONLY fault on the same node does get one', () => {
    // A step left in draft. No schema refuses `status: 'draft'` — it is a
    // legitimate value of the enum — so nothing but the arm gate objects, which
    // is precisely the set worth surfacing early.
    store.nodes = [
      {
        id: 'x',
        position: { x: 0, y: 0 },
        data: {
          type: 'action.send_whatsapp',
          properties: { label: 'שליחה', description: 'ת', body: 'שלום', status: 'draft' },
        },
      },
    ];
    syncArmBlockerMarkers('w', [], 'wf-1');

    expect(setStoreNodes).toHaveBeenCalledTimes(1);
    expect(errorsOn('x').map((e) => e.message)).toEqual([
      expect.stringContaining('בטיוטה'),
    ]);
  });

  it('⚠️ the error is bound to its own field, not to the node root', () => {
    // The defect this replaced: every customError was written with
    // instancePath: '', so JsonForms had nothing to attach it to and the
    // sentence never appeared beside the control it was about.
    store.nodes = [
      {
        id: 'x',
        position: { x: 0, y: 0 },
        data: {
          type: 'action.send_whatsapp',
          properties: { label: 'שליחה', description: 'ת', body: 'שלום', status: 'draft' },
        },
      },
    ];
    syncArmBlockerMarkers('w', [], 'wf-1');

    expect(errorsOn('x')[0]).toMatchObject({
      keyword: 'armBlocker',
      instancePath: '/status',
    });
  });

  it('⚠️ a changed instancePath alone still triggers a write', () => {
    // The trap in this refactor: the sync used to compare `message` strings
    // only. Moving an error from the root onto its field changes nothing but
    // `instancePath`, so a message-only comparison would report "no change" and
    // leave the error detached — a silent no-op indistinguishable from success.
    store.nodes = [
      {
        id: 'x',
        position: { x: 0, y: 0 },
        data: {
          type: 'action.send_whatsapp',
          properties: {
            label: 'שליחה',
            description: 'ת',
            body: 'שלום',
            status: 'draft',
            // The same sentence, stored at the root — what the previous version wrote.
            customErrors: [
              {
                keyword: 'armBlocker',
                instancePath: '',
                schemaPath: '',
                params: {},
                message:
                  'הצעד "שליחה": הצעד בטיוטה. סיימו אותו, או העבירו אותו ל"מושבת" כדי לדלג עליו במכוון.',
              },
            ],
          },
        },
      },
    ];
    syncArmBlockerMarkers('w', [], 'wf-1');

    expect(setStoreNodes).toHaveBeenCalledTimes(1);
    expect(errorsOn('x')[0]!).toMatchObject({ instancePath: '/status' });
  });
});
