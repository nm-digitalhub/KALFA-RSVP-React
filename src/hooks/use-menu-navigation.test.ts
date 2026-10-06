// @vitest-environment jsdom
import { act, createElement, createRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { useMenuNavigation } from './use-menu-navigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let result: { selectedIndex?: number } = {};
let picked: string[] = [];
// Module-level, so the component never creates or reassigns it during render.
const target = createRef<HTMLDivElement>();

function Probe({ items, query, onResult }: { items: string[]; query?: string; onResult: (r: { selectedIndex?: number }) => void }) {
  const r = useMenuNavigation({ containerRef: target, items, query, onSelect: (i) => picked.push(i) });
  useEffect(() => {
    onResult(r);
  });
  return createElement('div', { ref: target, tabIndex: 0 });
}
async function render(items: string[], query?: string) {
  await act(async () => root.render(createElement(Probe, { items, query, onResult: (r) => {
    result = r;
  } })));
}
const key = async (k: string) => {
  await act(async () => {
    target.current!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
};

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  picked = [];
});

describe('useMenuNavigation', () => {
  it('an index past the end of a shorter list falls back to the first row, and Enter picks it', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await render(['a', 'b', 'c'], 'x');
    await key('End');
    expect(result.selectedIndex).toBe(2);
    await render(['a', 'b'], 'x'); // fewer results, same query
    expect(result.selectedIndex).toBe(0);
    await key('Enter');
    expect(picked).toEqual(['a']);
  });

  it('resets on an empty query too (upstream kept the old row)', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await render(['a', 'b', 'c'], 'x');
    await key('ArrowDown');
    expect(result.selectedIndex).toBe(1);
    await render(['a', 'b', 'c'], '');
    expect(result.selectedIndex).toBe(0);
  });
});
