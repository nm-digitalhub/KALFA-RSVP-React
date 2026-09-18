import { describe, expect, it } from 'vitest';

import { buildPaletteItems, PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { NODE_RUN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { describeWait, formatOutput, nodeRunRenderer } from './node-run-control';

// The run report, tested where it can silently disappear.
//
// ⚠️ THE FAILURE MODE IS AN ABSENT PANEL, NOT A CRASH. A uischema element with
// no matching renderer, or a renderer with no matching element, produces nothing
// on screen and no error anywhere. The first attempt at this feature reached one
// node type out of nineteen for exactly that reason — the SDK's `tabs` prop
// renders its tab strip only when `selection.node.type === 'node'`, which is the
// node's VISUAL template, and our palette declares `decision-node` for fifteen
// entries and `start-node` for three. Nothing failed; the tab was simply
// unreachable. These tests pin both halves of the replacement so the same thing
// cannot happen quietly again.

const testerContext = { rootSchema: {}, config: {} };

type Element = { type?: string; options?: { format?: string }; elements?: Element[] };

const runElementsIn = (uischema: unknown): Element[] => {
  const out: Element[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const element = node as Element;
    if (element.options?.format === NODE_RUN_FORMAT) out.push(element);
    if (Array.isArray(element.elements)) element.elements.forEach(walk);
  };
  walk(uischema);
  return out;
};

describe('⚠️ every node type carries the element', () => {
  const items = buildPaletteItems();

  it('the palette is not empty, so the loop below can fail', () => {
    // Without this, an empty array would pass every assertion that follows.
    expect(items.length).toBeGreaterThan(15);
  });

  it('every entry has exactly one run element, and it is first', () => {
    for (const item of items) {
      const found = runElementsIn(item.uischema);
      expect(found, item.type).toHaveLength(1);

      const elements = (item.uischema as Element).elements ?? [];
      expect(elements[0], `${item.type}: the report belongs above the settings`).toBe(found[0]);
    }
  });

  it('it is a Label — the SDK union has no element type we could invent', () => {
    // `UISchemaElement` is a closed union. A `type: 'NodeRun'` would not
    // type-check, and a control element would demand a scope that names a
    // property no node has.
    for (const item of items) {
      expect(runElementsIn(item.uischema)[0]!.type, item.type).toBe('Label');
    }
  });

  it('⚠️ live options still reach the three rewritten entries', () => {
    // `buildPaletteItems` rewrites the schema of three node types before the
    // element is added. Wrapping the wrong side would drop those options and
    // leave three dropdowns empty, which is a silent failure of its own.
    const withOptions = buildPaletteItems(
      [{ label: 'מספר', providerRef: '972500000000' }],
      [],
      [],
      [],
      [],
      [{ label: 'תיבה', value: '11111111-1111-4111-8111-111111111111' }],
    );
    const email = withOptions.find((i) => i.type === 'action.microsoft_send_email')!;
    expect(JSON.stringify(email.schema)).toContain('11111111-1111-4111-8111-111111111111');
    expect(runElementsIn(email.uischema)).toHaveLength(1);
  });

  it('⚠️ PALETTE_ITEMS itself stays clean', () => {
    // The raw array is also read by `normalizeLegacyProperties` and by the tests
    // that police container choice. Neither has any business seeing an element
    // that exists only for the editor's live view.
    for (const item of PALETTE_ITEMS) {
      expect(runElementsIn(item.uischema), item.type).toHaveLength(0);
    }
  });
});

describe('⚠️ the tester claims that element and nothing else', () => {
  const runElement = {
    type: 'Label',
    text: 'הרצה',
    options: { format: NODE_RUN_FORMAT },
  } as const;

  it('matches the element the palette actually ships', () => {
    expect(nodeRunRenderer.tester(runElement as never, {}, testerContext)).toBeGreaterThan(0);
  });

  it('does not claim any other element', () => {
    for (const other of [
      { ...runElement, options: { format: 'integration-connection' } },
      { ...runElement, options: {} },
      { type: 'Label', text: 'שם הצעד' },
      { type: 'Text', scope: '#/properties/label' },
      { type: 'VerticalLayout', elements: [] },
    ]) {
      expect(nodeRunRenderer.tester(other as never, {}, testerContext)).toBe(-1);
    }
  });

  it('⚠️ outranks the built-in Label renderer', () => {
    // A lower rank would lose to the SDK's own Label and render the word "הרצה"
    // at the top of every properties panel instead of the report.
    expect(nodeRunRenderer.tester(runElement as never, {}, testerContext)).toBeGreaterThanOrEqual(
      5000,
    );
  });
});

describe('formatOutput', () => {
  it('says nothing for a step that returned nothing', () => {
    expect(formatOutput(undefined)).toBeNull();
    expect(formatOutput(null)).toBeNull();
  });

  it('pretty-prints whatever shape a handler returned', () => {
    expect(formatOutput({ sent: true })).toBe('{\n  "sent": true\n}');
    expect(formatOutput(0)).toBe('0');
    expect(formatOutput('')).toBe('""');
  });

  it('⚠️ still names a payload JSON cannot serialise', () => {
    // A cyclic output must not take the panel down with it.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatOutput(cyclic)).toBe('[object Object]');
  });
});

describe('⚠️ describeWait keeps a timer apart from an event', () => {
  // `node-markers.tsx` records the mistake this guards: the canvas once "said
  // 'continues at 14:30' about a node really waiting for a phone call to end".
  const at = '2026-09-18T11:30:00.000Z';

  it('a timer resumes at a known time', () => {
    const shown = describeWait({ resumeAt: at, waitKind: 'timer' });
    expect(shown?.label).toBe('ממשיכה ב־');
    expect(shown?.value).toBeTruthy();
  });

  it('an event wait states a deadline, not a resume time', () => {
    expect(describeWait({ resumeAt: at, waitKind: 'event' })?.label).toBe(
      'ממתינה לתוצאה · פג ב־',
    );
  });

  it('⚠️ says nothing when the kind is unknown', () => {
    // A row written before `waitKind` shipped carries a `resumeAt` and no kind.
    // Reading that as a timer would announce a resume time it never had.
    expect(describeWait({ resumeAt: at, waitKind: undefined })).toBeNull();
  });

  it('says nothing when there is no time at all', () => {
    expect(describeWait({ resumeAt: undefined, waitKind: 'timer' })).toBeNull();
  });
});
