// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JsonForms } from '@jsonforms/react';
import type { ErrorObject } from 'ajv';
import type { JsonSchema } from '@jsonforms/core';
import type { Editor } from '@tiptap/core';

import { VALUE_PATH_FORMAT, valuePathControlEntry } from './value-path-control';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 10, 10);
  const rects = () => [rect()] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = rect;
  Range.prototype.getClientRects = rects;
  Element.prototype.getClientRects = rects;
  Element.prototype.scrollIntoView = () => {};
  window.scrollBy = () => {};
});

const VALUES = [
  { id: 'guest.greeting_name', label: 'שם האורח' },
  { id: 'event.date_hebrew', label: 'תאריך עברי' },
  { id: 'event.venue', label: 'מקום האירוע' },
];
const schema: JsonSchema = { type: 'object', properties: { p1: { type: 'string' } }, required: ['p1'] };
const uischema = {
  type: 'Control',
  scope: '#/properties/p1',
  label: '{{1}}',
  options: { format: VALUE_PATH_FORMAT, values: VALUES },
};
const renderers = [valuePathControlEntry];

let container: HTMLDivElement;
let root: Root;
let latest: Record<string, unknown> = {};
let setData: (d: Record<string, unknown>) => void = () => {};

async function mount(
  initial: Record<string, unknown>,
  extra: { enabled?: boolean; additionalErrors?: ErrorObject[]; schema?: JsonSchema } = {},
) {
  function Harness() {
    const [data, set] = useState(initial);
    setData = set;
    return createElement(JsonForms, {
      schema: extra.schema ?? schema,
      uischema,
      data,
      renderers,
      readonly: extra.enabled === false,
      validationMode: 'ValidateAndShow',
      additionalErrors: extra.additionalErrors,
      onChange: ({ data: d }: { data: Record<string, unknown> }) => {
        latest = d;
        set(d);
      },
    });
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  await tick();
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const field = () => container.querySelector<HTMLElement>('[contenteditable]')!;
// Tiptap puts the editor on its root element (core: view.dom.editor).
const editor = () => (field() as unknown as { editor: Editor }).editor;
const view = () => editor().view;
const chip = () => field().querySelector<HTMLElement>('span[data-type="mention"]');
const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
const key = async (k: string) => {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
  await tick();
};
// Type through the editor's own view (what an input event does).
const type = async (text: string) => {
  await act(async () => {
    editor().chain().focus('end').insertContent(text).run();
  });
  await tick();
};

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  latest = {};
});

describe('ValuePathControl in JsonForms', () => {
  it('renders for format kalfa-value-path, with the label and a required error while empty', async () => {
    await mount({});
    expect(field()).not.toBeNull();
    expect(container.textContent).toContain('{{1}}');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('shows the stored value as a chip with its label', async () => {
    await mount({ p1: 'event.venue' });
    expect(chip()?.textContent).toBe('מקום האירוע');
    expect(field().hasAttribute('aria-invalid')).toBe(false);
  });

  it('picking writes the id into the form data; a new pick replaces the old one', async () => {
    await mount({});
    await type('{');
    expect(options().map((o) => o.getAttribute('data-user-id'))).toEqual(VALUES.map((v) => v.id));
    await key('Enter');
    expect(latest.p1).toBe('guest.greeting_name');
    expect(chip()?.textContent).toBe('שם האורח');
    await type('{מקום');
    await key('Enter');
    expect(latest.p1).toBe('event.venue');
    expect(field().querySelectorAll('span[data-type="mention"]')).toHaveLength(1);
    expect(chip()?.textContent).toBe('מקום האירוע');
  });

  it('deleting the chip clears the value', async () => {
    await mount({ p1: 'event.venue' });
    await act(async () => {
      const v = view();
      v.focus();
      v.dispatch(v.state.tr.delete(1, v.state.doc.content.size - 1));
    });
    await tick();
    expect(latest.p1).toBeUndefined();
  });

  it('a value set from outside replaces the chip, and the control does not write a different value back', async () => {
    await mount({ p1: 'event.venue' });
    await act(async () => setData({ p1: 'event.date_hebrew' }));
    await tick();
    expect(chip()?.textContent).toBe('תאריך עברי');
    // JSON Forms reports the new data once; the control never answers with another value.
    expect(latest.p1 ?? 'event.date_hebrew').toBe('event.date_hebrew');
  });

  it('shows a server error passed as additionalErrors on this field', async () => {
    const serverError: ErrorObject = {
      instancePath: '/p1',
      message: 'הערך לא קיים בשלב הזה',
      schemaPath: '',
      keyword: '',
      params: {},
    };
    await mount({ p1: 'event.venue' }, { additionalErrors: [serverError] });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('הערך לא קיים בשלב הזה');
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('read-only form: the field cannot be edited', async () => {
    await mount({ p1: 'event.venue' }, { enabled: false });
    expect(field().getAttribute('contenteditable')).toBe('false');
  });

  it('the field is described by its description, or by the error while there is one', async () => {
    const described: JsonSchema = {
      type: 'object',
      properties: { p1: { type: 'string', description: 'הערך שיוצב במקום המשתנה' } },
      required: ['p1'],
    };
    const serverError: ErrorObject = { instancePath: '/p1', message: 'שגיאה', schemaPath: '', keyword: '', params: {} };
    await mount({ p1: 'event.venue' }, { schema: described });
    const describedBy = field().getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('הערך שיוצב במקום המשתנה');
    await act(async () => root.unmount());
    container.remove();

    await mount({ p1: 'event.venue' }, { schema: described, additionalErrors: [serverError] });
    const errorRef = field().getAttribute('aria-describedby');
    expect(document.getElementById(errorRef!)?.getAttribute('role')).toBe('alert');
    expect(document.getElementById(errorRef!)?.textContent).toContain('שגיאה');
  });

  it('two instances on one page get their own label and error ids', async () => {
    const form = () =>
      createElement(JsonForms, { schema, uischema, data: {}, renderers, validationMode: 'ValidateAndShow' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement('div', null, form(), form())));
    await tick();
    const fields = [...container.querySelectorAll<HTMLElement>('[contenteditable]')];
    expect(fields).toHaveLength(2);
    const ref = (f: HTMLElement, attr: string) => f.getAttribute(attr)!;
    expect(ref(fields[0], 'aria-labelledby')).not.toBe(ref(fields[1], 'aria-labelledby'));
    expect(ref(fields[0], 'aria-describedby')).not.toBe(ref(fields[1], 'aria-describedby'));
    for (const f of fields) {
      expect(document.getElementById(ref(f, 'aria-labelledby'))?.textContent).toContain('{{1}}');
      expect(f.closest('[data-slot="value-path-control"]')?.contains(document.getElementById(ref(f, 'aria-describedby')))).toBe(true);
    }
  });
});
