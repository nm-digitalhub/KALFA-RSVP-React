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
      instancePath: '',
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

  it('⚠️ a node with NO properties at all is marked, not skipped', () => {
    // Worth pinning because it surprised this test's first author: a node
    // carrying no `properties` is not unparseable, it is a node whose required
    // fields are all absent — which is exactly what the arm gate refuses. The
    // marker has to appear, and it has to survive a node object that has no
    // `properties` object to spread.
    store.nodes = [
      { id: 'x', position: { x: 0, y: 0 }, data: { type: 'action.send_whatsapp' } },
    ];
    syncArmBlockerMarkers('w', [], 'wf-1');

    expect(setStoreNodes).toHaveBeenCalledTimes(1);
    expect(errorsOn('x').length).toBeGreaterThan(0);

    // And it still terminates from that starting shape.
    syncArmBlockerMarkers('w', [], 'wf-1');
    expect(setStoreNodes).toHaveBeenCalledTimes(1);
  });
});
