// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PACKAGE_SEED_BODY } from '@/test/agreement-seed';
import { ContractBodyEditor } from './contract-body-editor';

// The contract body field. The property defended: opening a contract in the editor never changes it. A body the visual
// editor reproduces exactly is edited visually; any other body falls back to the plain HTML field, untouched.

afterEach(cleanup);

// ProseMirror measures ranges when it scrolls a selection into view; jsdom has no layout.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

const TOKENS = ['eventName', 'packagePrice', 'contactQuota', 'company.name', 'liabilityCap'];

function field(container: HTMLElement): HTMLInputElement | HTMLTextAreaElement {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name="body_html"]') as HTMLInputElement;
}

async function visual(initialHtml: string, model: 'package' | 'per_result' = 'package') {
  const view = render(<ContractBodyEditor name="body_html" initialHtml={initialHtml} tokens={TOKENS} model={model} />);
  await waitFor(() => expect(view.container.querySelector('.ProseMirror')).not.toBeNull());
  return view;
}

describe('ContractBodyEditor — a body the visual editor reproduces exactly', () => {
  it('opens the seeded package contract in the visual editor, with the terms table and the box intact', async () => {
    const { container } = await visual(PACKAGE_SEED_BODY);
    const root = container.querySelector('.ProseMirror') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('dl.terms')).not.toBeNull();
    expect(root.querySelector('div.intent')).not.toBeNull();
    expect(root.textContent).toContain('{{packagePrice}}');
    // the form field is the body, one field, no textarea
    expect(field(container).tagName).toBe('INPUT');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('inserts a token at the cursor from the token buttons, and the form field follows', async () => {
    const { container } = await visual('<p>שלום </p>');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '{{eventName}}' }));
    });
    await waitFor(() => expect(field(container).value).toContain('{{eventName}}'));
    expect(field(container).value).toMatch(/^<p>(?=.*שלום)(?=.*\{\{eventName\}\}).*<\/p>$/);
  });

  it('an empty editor submits the empty string ("no custom body"), not <p></p>', async () => {
    const { container } = await visual('');
    expect(field(container).value).toBe('');
  });

  it('formats: bold is a button with a pressed state', async () => {
    await visual('<p>טקסט</p>');
    const bold = screen.getByRole('button', { name: 'מודגש' });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
  });

  it('warns about a token no one resolves, and about a package contract that lacks the price', async () => {
    const { container } = await visual('<p>{{pakagePrice}}</p>');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '{{eventName}}' }));
    });
    await waitFor(() => expect(container.textContent).toContain('תחליפים שאינם מוכרים'));
    expect(container.textContent).toContain('{{pakagePrice}}');
    expect(container.textContent).toContain('חוזה החבילה חייב לכלול');
  });

  it('warns when a package contract quotes a pay-per-result figure', async () => {
    const { container } = await visual('<p>{{packagePrice}} {{contactQuota}} {{pricePerReached}}</p>');
    expect(container.textContent).toContain('אינו יכול לצטט נתוני חיוב לפי תוצאה');
  });

  it('does not warn about the package tokens on a pay-per-result contract', async () => {
    const { container } = await visual('<p>{{eventName}}</p>', 'per_result');
    expect(container.textContent).not.toContain('חוזה החבילה חייב לכלול');
  });
});

describe('ContractBodyEditor — a body it cannot reproduce exactly', () => {
  const EXOTIC = '<p>טקסט</p><table><tr><td>{{packagePrice}}</td></tr></table>';

  it('is edited as plain HTML, unchanged, with a note saying why', async () => {
    const { container } = render(<ContractBodyEditor name="body_html" initialHtml={EXOTIC} tokens={TOKENS} model="package" />);
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    const ta = field(container) as HTMLTextAreaElement;
    expect(ta.value).toBe(EXOTIC);
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(container.textContent).toContain('נערך כ-HTML');
  });

  it('keeps what the admin types in the HTML field', async () => {
    const { container } = render(<ContractBodyEditor name="body_html" initialHtml={EXOTIC} tokens={TOKENS} model="package" />);
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    fireEvent.change(field(container), { target: { value: `${EXOTIC}<p>עוד</p>` } });
    expect((field(container) as HTMLTextAreaElement).value).toBe(`${EXOTIC}<p>עוד</p>`);
  });
});
