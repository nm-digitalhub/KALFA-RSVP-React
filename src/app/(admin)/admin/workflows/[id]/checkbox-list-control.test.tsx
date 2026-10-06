// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonForms } from '@jsonforms/react';
import type { JsonSchema, Middleware } from '@jsonforms/core';

import { CHECKBOX_LIST_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import { checkboxListRenderer } from './checkbox-list-control';

// The SDK re-exports @jsonforms/react's HOCs and does not bundle its own copy
// (its dist imports "@jsonforms/react"), so the app's <JsonForms> supplies the
// context the renderer reads.

const schema: JsonSchema = {
  type: 'object',
  properties: { kinds: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' } } } } },
};
const uischema = {
  type: 'Control',
  scope: '#/properties/kinds',
  label: 'סוגי הודעות',
  options: {
    format: CHECKBOX_LIST_FORMAT,
    choices: [
      { value: 'text', label: 'טקסט' },
      { value: 'image', label: 'תמונה' },
    ],
  },
};

let latest: Record<string, unknown> = {};

// The data is read through `middleware`, which JsonForms runs synchronously
// on every core action. Its `onChange` goes through a 10 ms lodash debounce on
// real timers, which made a waitFor on it depend on machine load.
const record: Middleware = (state, action, reducer) => {
  const next = reducer(state, action);
  latest = (next.data ?? {}) as Record<string, unknown>;
  return next;
};

function Harness({ initial }: { initial: Record<string, unknown> }) {
  return (
    <JsonForms
      schema={schema}
      uischema={uischema}
      data={initial}
      renderers={[checkboxListRenderer]}
      middleware={record}
    />
  );
}

afterEach(() => {
  cleanup();
  latest = {};
});

describe('checkbox list control, accessibility', () => {
  it('the choices form a group named by the field label', () => {
    render(<Harness initial={{}} />);
    const group = screen.getByRole('group', { name: 'סוגי הודעות' });
    expect(group.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('each checkbox is named by its choice, and no label sits inside another label', () => {
    const { container } = render(<Harness initial={{}} />);
    expect(screen.getByRole('checkbox', { name: 'טקסט' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'תמונה' })).toBeTruthy();
    expect(container.querySelector('label label')).toBeNull();
  });

  it('clicking the choice text ticks it, and the stored shape is unchanged ({ value } objects; none → undefined)', () => {
    render(<Harness initial={{}} />);
    fireEvent.click(screen.getByText('תמונה'));
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'תמונה' }).checked).toBe(true);
    expect(latest.kinds).toEqual([{ value: 'image' }]);
    fireEvent.click(screen.getByText('תמונה'));
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'תמונה' }).checked).toBe(false);
    expect(latest.kinds).toBeUndefined();
  });
});
