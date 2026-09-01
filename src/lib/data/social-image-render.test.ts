import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// puppeteer is loaded via createRequire (see social-image-render.ts's own
// comment for why), which bypasses vi.mock('puppeteer', ...) entirely — that
// intercepts the ESM/static-import graph, not a runtime require() call. Mock
// node:module's createRequire itself instead, so the fake require it returns
// is what the module under test actually calls.
const launchMock = vi.fn();
vi.mock('node:module', () => ({
  createRequire: () => (id: string) => {
    if (id === 'puppeteer') return { launch: (...args: unknown[]) => launchMock(...args) };
    throw new Error(`unexpected require in test: ${id}`);
  },
}));

import { renderHtmlToImage } from './social-image-render';

function mockBrowser(pngBytes: Uint8Array) {
  const setViewport = vi.fn();
  const setContent = vi.fn();
  const screenshot = vi.fn().mockResolvedValue(pngBytes);
  const close = vi.fn();
  const newPage = vi.fn().mockResolvedValue({ setViewport, setContent, screenshot });
  launchMock.mockResolvedValue({ newPage, close });
  return { setViewport, setContent, screenshot, close, newPage };
}

describe('renderHtmlToImage', () => {
  it('launches with the same sandbox args as renderAgreementPdf, sets the viewport, and returns PNG bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { setViewport, setContent, close } = mockBrowser(bytes);

    const result = await renderHtmlToImage({ html: '<div>x</div>', width: 1080, height: 1080 });

    expect(launchMock).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    expect(setViewport).toHaveBeenCalledWith({ width: 1080, height: 1080, deviceScaleFactor: 1 });
    expect(setContent).toHaveBeenCalledWith('<div>x</div>', { waitUntil: 'load' });
    expect(Buffer.compare(result, Buffer.from(bytes))).toBe(0);
    expect(close).toHaveBeenCalled();
  });

  it('applies a custom deviceScaleFactor when given', async () => {
    const { setViewport } = mockBrowser(new Uint8Array());

    await renderHtmlToImage({ html: '<div/>', width: 400, height: 400, deviceScaleFactor: 2 });

    expect(setViewport).toHaveBeenCalledWith({ width: 400, height: 400, deviceScaleFactor: 2 });
  });

  it('closes the browser even when the screenshot throws', async () => {
    const setViewport = vi.fn();
    const setContent = vi.fn();
    const screenshot = vi.fn().mockRejectedValue(new Error('boom'));
    const close = vi.fn();
    const newPage = vi.fn().mockResolvedValue({ setViewport, setContent, screenshot });
    launchMock.mockResolvedValue({ newPage, close });

    await expect(
      renderHtmlToImage({ html: '<div/>', width: 100, height: 100 }),
    ).rejects.toThrow('boom');
    expect(close).toHaveBeenCalled();
  });
});
