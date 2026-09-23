// The vendor's undo/redo history, against a stand-in diagram store.
//
// The SDK store is mocked because the real one needs a mounted `<Root>`. What is
// under test is the history's own bookkeeping — which announcements become a
// step, what undo and redo put back, and that a drag is one step and not one per
// frame — and a mount would not make any of that easier to see.
//
// `trackFutureChange` is wired to the decorator here, which is what
// `registerFunctionDecorator('trackFutureChange', …)` does in the editor: every
// change the SDK announces passes through it before it lands.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Node = { id: string; position: { x: number; y: number } };
type Edge = { id: string; source: string; target: string };

const diagram: { nodes: Node[]; edges: Edge[]; layoutDirection: 'RIGHT' | 'DOWN' } = {
  nodes: [],
  edges: [],
  layoutDirection: 'RIGHT',
};

// A holder rather than a `let`: the mock factory below is hoisted above every
// statement in this file and reads this lazily, once the module is imported.
const hook: { decorator?: (args: { params: unknown[] }) => void } = {};

vi.mock('@workflowbuilder/sdk', () => ({
  getStoreNodes: () => diagram.nodes,
  getStoreEdges: () => diagram.edges,
  getStoreLayoutDirection: () => diagram.layoutDirection,
  // Replace, never mutate — the real setters swap the array, and the history
  // compares snapshots by reference first.
  setStoreNodes: (nodes: Node[]) => void (diagram.nodes = nodes),
  setStoreEdges: (edges: Edge[]) => void (diagram.edges = edges),
  setStoreLayoutDirection: (d: 'RIGHT' | 'DOWN') => void (diagram.layoutDirection = d),
  trackFutureChange: (name: string) => hook.decorator?.({ params: [name] }),
}));

const { redo, resetUndoRedo, trackFutureChangeDecorator, undo, useUndoRedoStore } = await import(
  './undo-redo-store'
);
hook.decorator = trackFutureChangeDecorator;

const node = (id: string, x = 0, y = 0): Node => ({ id, position: { x, y } });

/**
 * What the editor does for every mutation: announce, THEN change. The
 * announcement snapshots the state BEFORE the change, which is what undo puts
 * back.
 */
function change(name: string, apply: () => void) {
  trackFutureChangeDecorator({ params: [name] });
  apply();
}

beforeEach(() => {
  diagram.nodes = [node('a')];
  diagram.edges = [];
  diagram.layoutDirection = 'RIGHT';
  resetUndoRedo();
});

describe('a change becomes a step, and undo puts the previous state back', () => {
  it('adding a node, then undo, removes it', () => {
    change('addNode', () => (diagram.nodes = [...diagram.nodes, node('b')]));
    expect(diagram.nodes.map((n) => n.id)).toEqual(['a', 'b']);

    undo();
    expect(diagram.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('redo re-applies what undo took back', () => {
    change('addNode', () => (diagram.nodes = [...diagram.nodes, node('b')]));
    undo();
    redo();
    expect(diagram.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('edges travel with the snapshot', () => {
    diagram.nodes = [node('a'), node('b')];
    change('addEdge', () => (diagram.edges = [{ id: 'e', source: 'a', target: 'b' }]));
    undo();
    expect(diagram.edges).toEqual([]);
  });

  it('a new change after an undo clears the redo stack', () => {
    change('addNode', () => (diagram.nodes = [...diagram.nodes, node('b')]));
    undo();
    change('addNode', () => (diagram.nodes = [...diagram.nodes, node('c')]));
    expect(useUndoRedoStore.getState().future).toEqual([]);
  });

  it('undo with no history changes nothing', () => {
    const before = diagram.nodes;
    undo();
    expect(diagram.nodes).toBe(before);
  });
});

describe('⚠️ the layout flip is a step — the reason app-bar.tsx announces it', () => {
  it('flipping direction, then undo, restores both the direction and the coordinates', () => {
    // Exactly what `toggleLayoutDirection` in app-bar.tsx does: announce under
    // its own name, then flip the direction and swap every node's x and y.
    diagram.nodes = [node('a', 10, 200)];
    change('layoutDirection', () => {
      diagram.layoutDirection = 'DOWN';
      diagram.nodes = diagram.nodes.map((n) => ({ ...n, position: { x: n.position.y, y: n.position.x } }));
    });
    expect(diagram.layoutDirection).toBe('DOWN');

    undo();
    expect(diagram.layoutDirection).toBe('RIGHT');
    expect(diagram.nodes[0]!.position).toEqual({ x: 10, y: 200 });
  });

  it('an UNannounced write leaves no step — which is why the arm-marker sync stays out of history', () => {
    // `syncArmBlockerMarkers` writes through `setStoreNodes` without announcing.
    // If the history recorded it, one Ctrl+Z would silently revert a marker the
    // sync would immediately re-add — a step the owner cannot see.
    diagram.nodes = [{ ...node('a'), position: { x: 1, y: 1 } }];
    expect(useUndoRedoStore.getState().past).toEqual([]);
  });
});

describe('the vendor’s special cases', () => {
  it('undo and redo do not record themselves', () => {
    change('addNode', () => (diagram.nodes = [...diagram.nodes, node('b')]));
    undo();
    // One step went to `future`, and undo's own announcement added nothing.
    expect(useUndoRedoStore.getState().past).toHaveLength(0);
    expect(useUndoRedoStore.getState().future).toHaveLength(1);
  });

  it('⚠️ a drag is ONE step, not one per frame', () => {
    // The SDK announces nodeDragStart once, nodeDragChange on every frame, and
    // nodeDragStop at the end. The plugin records the pre-drag state on the
    // first change only; without that a single drag would fill the history.
    trackFutureChangeDecorator({ params: ['nodeDragStart'] });
    for (let x = 1; x <= 20; x += 1) {
      trackFutureChangeDecorator({ params: ['nodeDragChange'] });
      diagram.nodes = [node('a', x, 0)];
    }
    trackFutureChangeDecorator({ params: ['nodeDragStop'] });

    expect(useUndoRedoStore.getState().past).toHaveLength(1);
    undo();
    expect(diagram.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('two identical consecutive snapshots are recorded once', () => {
    trackFutureChangeDecorator({ params: ['something'] });
    trackFutureChangeDecorator({ params: ['something-else'] });
    expect(useUndoRedoStore.getState().past).toHaveLength(1);
  });
});

describe('⚠️ resetUndoRedo — the one addition to the vendor’s store', () => {
  it('forgets every step, so another workflow cannot inherit them', () => {
    // The editor is a route and the store is a module singleton. Without this,
    // Ctrl+Z on workflow B would restore workflow A's nodes — and auto-save
    // would then persist them into B.
    change('addNode', () => (diagram.nodes = [...diagram.nodes, node('b')]));
    undo();
    expect(useUndoRedoStore.getState().future).toHaveLength(1);

    resetUndoRedo();
    expect(useUndoRedoStore.getState()).toMatchObject({ past: [], future: [], snapshotsWatchers: {} });

    const before = diagram.nodes;
    undo();
    redo();
    expect(diagram.nodes).toBe(before);
  });
});
