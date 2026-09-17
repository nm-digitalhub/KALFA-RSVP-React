import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { openModalMock, storeDataMock } = vi.hoisted(() => ({
  openModalMock: vi.fn(),
  storeDataMock: vi.fn(),
}));

vi.mock('@workflowbuilder/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openModal: openModalMock,
  getStoreDataForIntegration: storeDataMock,
}));

import { isVendorExportItem, openScrubbedExport } from './export-diagram';

function node(type: string, properties: Record<string, unknown>, id = 'n1') {
  return { id, position: { x: 0, y: 0 }, data: { type, properties } };
}

function renderedText(): string {
  // The modal content is a React element tree; the payload is the textarea's
  // `value`. Walking it is enough — this asserts what a person can select and
  // copy, which is the whole point of the change.
  const content = openModalMock.mock.calls.at(-1)?.[0]?.content;
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as { props?: Record<string, unknown> };
    if (typeof el.props?.value === 'string') found.push(el.props.value as string);
    if (el.props?.children) walk(el.props.children);
  };
  const root = content as { type?: unknown; props?: unknown };
  walk(typeof root?.type === 'function' ? (root.type as () => unknown)() : root);
  return found.join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('⚠️ the vendor export is the one that leaks', () => {
  it('still ships an item with the icon we drop it by', async () => {
    // Fail-closed, and it has to read the BUNDLE: `getControlsDotsItems` is the
    // name a decorator registers against, not a public export, so there is no
    // way to call it and inspect what it returns.
    //
    // What is asserted is the fact the filter depends on — that the vendor's
    // dots-items factory still builds an item with the `Export` icon. If an SDK
    // upgrade renames it, this fails here instead of silently shipping BOTH
    // exports: ours, and the one that copies the webhook token.
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = 'node_modules/@workflowbuilder/sdk/dist';
    const chunk = readdirSync(dir).find(
      (f) => f.endsWith('.js') && readFileSync(`${dir}/${f}`, 'utf8').includes('getControlsDotsItems'),
    );
    expect(chunk, 'no bundle chunk defines getControlsDotsItems').toBeDefined();

    const source = readFileSync(`${dir}/${chunk}`, 'utf8');
    const factory = source.slice(
      source.lastIndexOf('return [', source.indexOf('"getControlsDotsItems"')),
      source.indexOf('"getControlsDotsItems"'),
    );

    expect(factory).toContain('importExport.export');
    expect(factory).toContain('name: "Export"');
  });

  it('is matched by icon, not by its translated label', () => {
    expect(isVendorExportItem({ icon: { props: { name: 'Export' } }, label: 'anything' })).toBe(
      true,
    );
    expect(isVendorExportItem({ icon: { props: { name: 'DownloadSimple' } } })).toBe(false);
    expect(isVendorExportItem({ label: 'Export' })).toBe(false);
    expect(isVendorExportItem(null)).toBe(false);
  });
});

describe('what our export puts on screen', () => {
  it('⚠️ never the webhook trigger hash, which still names THIS installation', () => {
    // The token itself no longer lives in a diagram at all — the field holds a
    // sha256 (see webhook-token.ts). The hash still travels out of here blanked:
    // it is not a secret any more, but it is the address of an endpoint on this
    // installation, and a file carrying it would arrive somewhere the endpoint
    // does not exist.
    storeDataMock.mockReturnValue({
      name: 'תהליך',
      layoutDirection: 'DOWN',
      globalVariables: {},
      edges: [],
      nodes: [node('trigger.webhook', { label: 'נכנס', tokenHash: 'c'.repeat(64) })],
    });

    openScrubbedExport();

    expect(renderedText()).not.toContain('c'.repeat(64));
    expect(renderedText()).toContain('"tokenHash": ""');
  });

  it('⚠️ never an outbound webhook header value', () => {
    storeDataMock.mockReturnValue({
      name: 'תהליך',
      layoutDirection: 'DOWN',
      globalVariables: {},
      edges: [],
      nodes: [
        node('action.webhook', {
          label: 'קריאה',
          method: 'POST',
          url: 'https://hooks.example.test/t/abc123',
          headers: [{ name: 'X-Api-Key', value: 'literally-a-key' }],
        }),
      ],
    });

    openScrubbedExport();
    const text = renderedText();

    expect(text).not.toContain('literally-a-key');
    expect(text).not.toContain('abc123');
    expect(text).toContain('"method": "POST"');
  });

  it('keeps a template key, which every installation compiles in', () => {
    storeDataMock.mockReturnValue({
      name: 'תהליך',
      layoutDirection: 'DOWN',
      globalVariables: {},
      edges: [],
      nodes: [node('action.send_template', { label: 'תבנית', messageKey: 'reminder_1' })],
    });

    openScrubbedExport();
    expect(renderedText()).toContain('"messageKey": "reminder_1"');
  });

  it('⚠️ removes a voice purpose, because every selectable one is local', () => {
    // `listDialableVoicePurposes()` filters `!p.isBuiltin`, so a purpose an author
    // could pick is by construction one this installation created.
    storeDataMock.mockReturnValue({
      name: 'תהליך',
      layoutDirection: 'DOWN',
      globalVariables: {},
      edges: [],
      nodes: [node('action.start_voice_call', { label: 'שיחה', purposeKey: 'purchase_callback' })],
    });

    openScrubbedExport();
    expect(renderedText()).not.toContain('purchase_callback');
  });

  it('opens the editor’s own modal rather than a page of ours', () => {
    storeDataMock.mockReturnValue({
      name: 'תהליך',
      layoutDirection: 'DOWN',
      globalVariables: {},
      edges: [],
      nodes: [],
    });

    openScrubbedExport();

    expect(openModalMock).toHaveBeenCalledOnce();
    expect(openModalMock.mock.calls[0][0]).toMatchObject({ title: 'ייצוא התהליך' });
  });
});
