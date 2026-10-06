// The vendor's copy & paste utilities, and the one property this port adds.
//
// The utilities are pure — they take getters and setters — so they run against
// plain arrays here. What the owner would notice if they broke: a pasted node
// that shares an id with its original, an edge that still points at the old
// nodes, or a paste that lands somewhere other than the cursor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { getSelectionWithNodesBetween, pasteElements, removeElements } from './copy-paste-utils';

const node = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({
  id,
  position: { x, y },
  data: { properties: { label: id } },
  ...extra,
});
const edge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({
  id,
  source,
  target,
  ...extra,
});

function board(nodes: Node[], edges: Edge[] = []) {
  const state = { nodes, edges };
  return {
    state,
    getNodes: () => state.nodes,
    getEdges: () => state.edges,
    setNodes: (n: Node[]) => void (state.nodes = n),
    setEdges: (e: Edge[]) => void (state.edges = e),
  };
}

let counter = 0;
const generateId = () => `new-${++counter}`;
const getHandleId = ({ oldHandleId, oldNodeId, newNodeId }: { oldHandleId: string | null; oldNodeId: string; newNodeId: string }) =>
  oldHandleId ? oldHandleId.replace(oldNodeId, newNodeId) : null;

describe('pasteElements', () => {
  it('gives every pasted node a new id and keeps the originals', () => {
    counter = 0;
    const b = board([node('a', 0, 0)]);
    pasteElements({ elements: { nodes: [node('a', 0, 0)], edges: [] }, mousePosition: { x: 0, y: 0 }, generateId, getHandleId, ...b });

    expect(b.state.nodes.map((n) => n.id)).toEqual(['a', 'new-1']);
  });

  it('centres the pasted group on the cursor, keeping its internal layout', () => {
    counter = 0;
    const b = board([]);
    // Two nodes 100 apart, centred on (50, 0). Pasting at (500, 300) moves the
    // centre there and keeps them 100 apart.
    pasteElements({
      elements: { nodes: [node('a', 0, 0), node('b', 100, 0)], edges: [] },
      mousePosition: { x: 500, y: 300 },
      generateId,
      getHandleId,
      ...b,
    });

    expect(b.state.nodes.map((n) => n.position)).toEqual([
      { x: 450, y: 300 },
      { x: 550, y: 300 },
    ]);
  });

  it('⚠️ rewires a copied edge to the NEW nodes, never the originals', () => {
    counter = 0;
    const b = board([node('a', 0, 0), node('b', 100, 0)], [edge('e', 'a', 'b')]);
    pasteElements({
      elements: { nodes: [node('a', 0, 0), node('b', 100, 0)], edges: [edge('e', 'a', 'b')] },
      mousePosition: { x: 0, y: 0 },
      generateId,
      getHandleId,
      ...b,
    });

    const pasted = b.state.edges.at(-1)!;
    expect(pasted).toMatchObject({ source: 'new-1', target: 'new-2' });
    expect(pasted.id).not.toBe('e');
  });

  it('⚠️ keeps our FIXED branch handle ids — they carry no node id to rewrite', () => {
    // `ACTION_BRANCH_HANDLES` are `source:inner:<fixed>`, deliberately free of the
    // node id so the worker can know them without reading the diagram. The
    // vendor's `replace(oldNodeId, newNodeId)` must therefore leave them alone,
    // or a pasted condition's "ok" branch would lose its edge.
    counter = 0;
    const b = board([]);
    pasteElements({
      elements: {
        nodes: [node('cond', 0, 0), node('next', 100, 0)],
        edges: [edge('e', 'cond', 'next', { sourceHandle: 'source:inner:ok' })],
      },
      mousePosition: { x: 0, y: 0 },
      generateId,
      getHandleId,
      ...b,
    });

    expect(b.state.edges[0]!.sourceHandle).toBe('source:inner:ok');
  });

  it('pasted items are the new selection; what was selected before is not', () => {
    counter = 0;
    const b = board([node('a', 0, 0, { selected: true })]);
    pasteElements({ elements: { nodes: [node('a', 0, 0)], edges: [] }, mousePosition: { x: 0, y: 0 }, generateId, getHandleId, ...b });

    expect(b.state.nodes.map((n) => [n.id, n.selected])).toEqual([
      ['a', false],
      ['new-1', true],
    ]);
  });
});

describe('getSelectionWithNodesBetween', () => {
  it('adds the edges BETWEEN selected nodes and drops those leaving the selection', () => {
    const selection = { nodes: [node('a', 0, 0), node('b', 0, 0)], edges: [] as Edge[] };
    const all = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')];

    expect(getSelectionWithNodesBetween(selection, all).edges.map((e) => e.id)).toEqual(['ab']);
  });
});

describe('removeElements', () => {
  it('removes exactly the given nodes and edges', () => {
    const b = board([node('a', 0, 0), node('b', 0, 0)], [edge('ab', 'a', 'b')]);
    removeElements({ elements: { nodes: [node('a', 0, 0)], edges: [edge('ab', 'a', 'b')] }, ...b });

    expect(b.state.nodes.map((n) => n.id)).toEqual(['b']);
    expect(b.state.edges).toEqual([]);
  });
});

describe('⚠️ the port never touches the system clipboard', () => {
  // The whole reason this uses the vendor's `useCopyPaste` rather than their
  // `useExternalCopyPaste`: the external one writes every copied node's
  // properties — webhook URLs, headers an owner may have typed a key into — to
  // `navigator.clipboard`, where any clipboard manager can read them. That is the
  // leak `export-diagram.tsx` exists to close. A future "restore the vendor's
  // original" must fail here first.
  it.each(['copy-paste.tsx', 'copy-paste-utils.ts'])('%s has no clipboard API call', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');

    expect(code).not.toMatch(/navigator\s*\.\s*clipboard/);
    expect(code).not.toMatch(/useExternalCopyPaste/);
  });
});
