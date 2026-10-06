// The layout-direction menu item, driven through the decorator it is registered
// with rather than through the function directly.
//
// ⚠️ THE PROPERTY THIS EXISTS FOR IS THE ANNOUNCEMENT, AND ITS ORDER.
//
// `setStoreLayoutDirection` and `setStoreNodes` are a bare `useStore.setState`
// in the vendor's `store/slices/diagram-slice/actions.ts` — neither tells the
// changes tracker anything, and the vendor's own `toggleLayoutDirection` adds no
// announcement of its own. So upstream, flipping the layout is a change no
// subscriber can see: auto-save stays idle on a diagram that really did change,
// and a history plugin records no entry, which makes the NEXT undo revert the
// flip along with whatever the user actually meant to undo.
//
// `trackFutureChange` is named for its contract: it announces a change that has
// not happened yet, so a `place: 'before'` decorator can snapshot the state as
// it was. Announcing after the writes would snapshot the flipped diagram and
// restore to it — the same bug in a costume. Hence the order assertion below.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DotsItem = { label: string; onClick: () => void };
type AfterDecorator = {
  place: 'after';
  callback: (args: { returnValue: unknown }) => { replacedReturn: DotsItem[] };
};

const calls: string[] = [];

const trackFutureChange = vi.fn((name: string) => {
  calls.push(`track:${name}`);
});
const setStoreLayoutDirection = vi.fn((_direction: string) => {
  calls.push('setLayoutDirection');
});
const setStoreNodes = vi.fn((_nodes: unknown[]) => {
  calls.push('setNodes');
});
const functionDecorators = new Map<string, AfterDecorator>();

// Spread over the real module rather than replacing it: `app-bar.tsx` now also
// pulls in `./export-diagram`, and through it the node catalogue, which reads
// real SDK values (`sharedProperties`, `getScope`, `statusOptions`). Those are
// data this test has no opinion about — only the store accessors and the
// decorator registry below are stubbed, because those are what it asserts on.
vi.mock('@workflowbuilder/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Icon: () => null,
  getStoreLayoutDirection: () => 'DOWN',
  getStoreNodes: () => [{ id: 'n1', position: { x: 10, y: 40 }, data: {} }],
  registerComponentDecorator: vi.fn(),
  registerFunctionDecorator: (name: string, decorator: AfterDecorator) => {
    functionDecorators.set(name, decorator);
  },
  setStoreLayoutDirection: (direction: string) => setStoreLayoutDirection(direction),
  setStoreNodes: (nodes: unknown[]) => setStoreNodes(nodes),
  trackFutureChange: (name: string) => trackFutureChange(name),
  useSingleSelectedElement: () => undefined,
  useStore: Object.assign(() => undefined, { getState: () => ({}) }),
}));

// `toggleLayoutDirection` schedules the fit-view through it, and the suite runs
// in the `node` environment, which has no frame loop to schedule against.
globalThis.requestAnimationFrame = ((): number => 0) as typeof requestAnimationFrame;

const { appBarPlugin } = await import('./app-bar');

/** Register, then pull the menu item the owner actually clicks. */
function flowDirectionItem(): DotsItem {
  appBarPlugin();

  const decorator = functionDecorators.get('getControlsDotsItems');
  if (!decorator) throw new Error('getControlsDotsItems was never decorated');

  const items = decorator.callback({ returnValue: [] }).replacedReturn;
  const item = items.find((entry) => entry.label === 'כיוון הזרימה');
  if (!item) throw new Error('the flow-direction item is no longer in the dots menu');

  return item;
}

beforeEach(() => {
  calls.length = 0;
  trackFutureChange.mockClear();
  setStoreLayoutDirection.mockClear();
  setStoreNodes.mockClear();
  functionDecorators.clear();
});

describe('the layout-direction menu item', () => {
  it('⚠️ announces the change — the property the vendor is missing', () => {
    flowDirectionItem().onClick();

    expect(trackFutureChange).toHaveBeenCalledWith('layoutDirection');
  });

  it('⚠️ announces BEFORE it writes, so a snapshot catches the old layout', () => {
    flowDirectionItem().onClick();

    expect(calls).toEqual(['track:layoutDirection', 'setLayoutDirection', 'setNodes']);
  });

  it('is not one of the two names the SDK excludes from auto-save', () => {
    // `SKIP_AUTO_SAVE_CHECK_FOR_EVENTS` in the vendor's integration consts. A
    // flip changes `layoutDirection` and every node position — both persisted —
    // so it has to mark the diagram dirty, exactly as dropping a dragged node
    // already does.
    flowDirectionItem().onClick();

    const [announced] = trackFutureChange.mock.calls[0] ?? [];
    expect(['nodeDragStart', 'nodeDragChange']).not.toContain(announced);
  });

  it('still flips the direction and mirrors the coordinates', () => {
    flowDirectionItem().onClick();

    expect(setStoreLayoutDirection).toHaveBeenCalledWith('RIGHT');
    expect(setStoreNodes).toHaveBeenCalledWith([{ id: 'n1', position: { x: 40, y: 10 }, data: {} }]);
  });
});
