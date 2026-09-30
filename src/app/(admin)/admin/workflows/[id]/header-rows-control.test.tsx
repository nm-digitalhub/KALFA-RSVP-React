// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonForms } from '@jsonforms/react';
import type { JsonSchema } from '@jsonforms/core';

import { HEADER_ROWS_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { headerRowsRenderer } from './header-rows-control';
import { setSecretNames } from './use-secrets-store';

// Same harness as checkbox-list-control.test.tsx: the SDK uses the app's
// @jsonforms/react, so the app's <JsonForms> provides the renderer's context.

const schema: JsonSchema = {
  type: 'object',
  properties: {
    headers: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } },
    },
  },
};
const uischema = {
  type: 'Control',
  scope: '#/properties/headers',
  label: 'כותרות HTTP',
  options: { format: HEADER_ROWS_FORMAT },
};

function renderRows(data: Record<string, unknown>) {
  return render(<JsonForms schema={schema} uischema={uischema} data={data} renderers={[headerRowsRenderer]} />);
}

afterEach(() => {
  cleanup();
  setSecretNames([]);
});

describe('header rows control, accessibility', () => {
  it('the rows form a group named by the field label, and each input has its own name', () => {
    renderRows({ headers: [{ name: 'Authorization', value: 'Bearer x' }] });
    const group = screen.getByRole('group', { name: 'כותרות HTTP' });
    expect(group.contains(screen.getByRole('textbox', { name: 'שם הכותרת 1' }))).toBe(true);
    expect(group.contains(screen.getByRole('textbox', { name: 'ערך הכותרת 1' }))).toBe(true);
  });

  it('an unknown secret marks the value invalid and describes it with the warning', () => {
    setSecretNames(['ACME_API_KEY']);
    renderRows({ headers: [{ name: 'Authorization', value: 'Bearer {{secrets.TYPO_KEY}}' }] });
    // With secrets known the input has a datalist, which makes its role combobox.
    const value = screen.getByRole('combobox', { name: 'ערך הכותרת 1' });
    expect(value.getAttribute('aria-invalid')).toBe('true');
    const warning = document.getElementById(value.getAttribute('aria-describedby')!);
    expect(warning?.textContent).toContain('TYPO_KEY');
  });

  it('a known secret leaves the value valid and undescribed', () => {
    setSecretNames(['ACME_API_KEY']);
    renderRows({ headers: [{ name: 'Authorization', value: 'Bearer {{secrets.ACME_API_KEY}}' }] });
    // With secrets known the input has a datalist, which makes its role combobox.
    const value = screen.getByRole('combobox', { name: 'ערך הכותרת 1' });
    expect(value.hasAttribute('aria-invalid')).toBe(false);
    expect(value.hasAttribute('aria-describedby')).toBe(false);
  });
});
