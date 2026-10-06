// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  saveAgreementAction: vi.fn(),
  approveAgreementAction: vi.fn(),
  revertAgreementAction: vi.fn(),
  loadAgreementStarterAction: vi.fn(),
}));

import { AgreementEditor } from './agreement-client';
import { loadAgreementStarterAction } from './actions';

afterEach(cleanup);

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

beforeEach(() => {
  vi.mocked(loadAgreementStarterAction).mockReset();
});

const TOKENS = ['eventName', 'baseFee'];
const forms = (c: HTMLElement) => Array.from(c.querySelectorAll('form'));
const modelOf = (f: HTMLFormElement) => f.querySelector<HTMLInputElement>('input[name="model"]')?.value;

describe('AgreementEditor — the package contract', () => {
  function pkg(over: Partial<React.ComponentProps<typeof AgreementEditor>> = {}) {
    return render(
      <AgreementEditor model="package" version="draft-2026-10-v6" bodyHtml="<p>{{packagePrice}} {{contactQuota}}</p>" status="draft" tokens={TOKENS} {...over} />,
    );
  }

  it('tells every form it is the package contract (save and approve act on the package document)', () => {
    const { container } = pkg();
    expect(forms(container).map(modelOf)).toEqual(['package', 'package']);
  });

  it('has no default template to load or return to: no "load current text" and no revert', () => {
    pkg({ bodyHtml: null });
    expect(screen.queryByRole('button', { name: /טעינת הנוסח הנוכחי/ })).toBeNull();
    expect(screen.queryByText('שחזור תבנית ברירת המחדל')).toBeNull();
  });

  it('says a draft package contract is not shown to any customer', () => {
    pkg();
    expect(screen.getByText(/כל עוד חוזה החבילה בטיוטה, הוא אינו מוצג לאף לקוח/)).toBeTruthy();
  });

  it('says so when it is approved', () => {
    pkg({ status: 'approved', version: '2026-10-v6' });
    expect(screen.getByText(/חוזה החבילה מאושר/)).toBeTruthy();
  });
});

describe('AgreementEditor — the pay-per-result contract', () => {
  function perResult(over: Partial<React.ComponentProps<typeof AgreementEditor>> = {}) {
    return render(
      <AgreementEditor model="per_result" version="2026-07-v4" bodyHtml={null} status="approved" tokens={TOKENS} {...over} />,
    );
  }

  it('acts on the pay-per-result document', () => {
    const { container } = perResult();
    expect(forms(container).map(modelOf)).toEqual(['per_result', 'per_result']);
  });

  it('offers to load the current text while there is no custom body, and loads it into the editor', async () => {
    vi.mocked(loadAgreementStarterAction).mockResolvedValue({ body: '<h2>1. הצדדים</h2><p>{{eventName}}</p>' });
    const { container } = perResult();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טעינת הנוסח הנוכחי לעריכה' }));
    });
    await waitFor(() => expect(container.querySelector('.ProseMirror')?.textContent).toContain('1. הצדדים'));
    const field = container.querySelector<HTMLInputElement>('[name="body_html"]');
    expect(field?.value).toContain('{{eventName}}');
  });

  it('shows why when the current text cannot be loaded, and leaves the body empty', async () => {
    vi.mocked(loadAgreementStarterAction).mockResolvedValue({ error: 'טעינת הנוסח הנוכחי נכשלה' });
    const { container } = perResult();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'טעינת הנוסח הנוכחי לעריכה' }));
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('טעינת הנוסח הנוכחי נכשלה'));
    expect(container.querySelector<HTMLInputElement>('[name="body_html"]')?.value).toBe('');
  });

  it('with a custom body there is nothing to load, and the way back to the template is offered', () => {
    perResult({ bodyHtml: '<p>נוסח</p>' });
    expect(screen.queryByRole('button', { name: /טעינת הנוסח הנוכחי/ })).toBeNull();
    expect(screen.getByText('שחזור תבנית ברירת המחדל')).toBeTruthy();
  });
});
