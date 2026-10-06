// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CustomerNumberField } from './customer-number-field';

afterEach(cleanup);

function field() {
  return screen.getByLabelText('מספר לקוח') as HTMLInputElement;
}

describe('CustomerNumberField', () => {
  it('shows the SUMIT customer number in a read-only field labelled "מספר לקוח"', () => {
    render(<CustomerNumberField customerNumber={2127277236} inputClassName="x" />);
    expect(field().value).toBe('2127277236');
    expect(field().readOnly).toBe(true);
  });

  it('is written left-to-right so the digits are not reordered inside the right-to-left page', () => {
    render(<CustomerNumberField customerNumber={2127277236} inputClassName="x" />);
    expect(field().getAttribute('dir')).toBe('ltr');
  });

  it('is not part of the profile form: it has no name, so saving the profile can never submit it', () => {
    render(<CustomerNumberField customerNumber={2127277236} inputClassName="x" />);
    expect(field().hasAttribute('name')).toBe(false);
  });

  it('before the first payment the field is empty and says when the number will appear', () => {
    render(<CustomerNumberField customerNumber={null} inputClassName="x" />);
    expect(field().value).toBe('');
    expect(field().placeholder).toBe('יופיע לאחר התשלום הראשון');
  });

  it('explains what the number is, and ties the explanation to the field for screen readers', () => {
    render(<CustomerNumberField customerNumber={2127277236} inputClassName="x" />);
    const hint = screen.getByText(/הוא נוצר בתשלום הראשון ואינו ניתן לעריכה/);
    expect(hint.id).toBeTruthy();
    expect(field().getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('never names the payment provider to the customer — not in the label, the hint, or the placeholder', () => {
    const { container } = render(<CustomerNumberField customerNumber={null} inputClassName="x" />);
    expect(container.textContent).not.toMatch(/sumit/i);
    expect(field().placeholder).not.toMatch(/sumit/i);
    expect(container.innerHTML).not.toMatch(/sumit/i);
  });

  it('uses the page input styling it is given', () => {
    render(<CustomerNumberField customerNumber={1} inputClassName="page-input" />);
    expect(field().className).toContain('page-input');
  });
});
