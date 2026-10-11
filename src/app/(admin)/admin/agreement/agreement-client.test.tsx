// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  saveAgreementAction: vi.fn(),
  approveAgreementAction: vi.fn(),
}));

import { AgreementEditor } from './agreement-client';

afterEach(cleanup);

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

const TOKENS = ['eventName', 'packagePrice'];

describe('AgreementEditor — the package contract', () => {
  function pkg(over: Partial<React.ComponentProps<typeof AgreementEditor>> = {}) {
    return render(
      <AgreementEditor version="draft-2026-10-v6" bodyHtml="<p>{{packagePrice}} {{contactQuota}}</p>" status="draft" tokens={TOKENS} {...over} />,
    );
  }

  it('has a save form and an approve form, and no other contract to choose', () => {
    const { container } = pkg();
    expect(container.querySelectorAll('form')).toHaveLength(2);
    expect(container.querySelector('input[name="model"]')).toBeNull();
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

  it('suggests the approved version without the draft- prefix', () => {
    const { container } = pkg();
    expect(container.querySelector<HTMLInputElement>('#approve-version')?.value).toBe('2026-10-v6');
  });
});
