// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';

import { MentionChip, MentionDropdownMenu, type MentionEntry } from './mention-dropdown-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout; ProseMirror and Floating UI measure rects.
beforeAll(() => {
  const rect = () => new DOMRect(0, 0, 10, 10);
  const rects = () => [rect()] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = rect;
  Range.prototype.getClientRects = rects;
  Element.prototype.getClientRects = rects;
  Element.prototype.scrollIntoView = () => {};
  window.scrollBy = () => {};
});

const PEOPLE: MentionEntry[] = [
  { id: 'event.date_hebrew', label: 'תאריך עברי' },
  { id: 'event.date_gregorian', label: 'תאריך לועזי' },
  { id: 'guest.first_name', label: 'שם האורח' },
];

let container: HTMLDivElement;
let root: Root;
let editor: Editor | null = null;

async function mount(char: string, content = '<p>שלום</p>') {
  function Harness() {
    const ed = useEditor({
      immediatelyRender: true,
      extensions: [Document, Paragraph, Text, MentionChip],
      content,
      onCreate: ({ editor: created }) => {
        editor = created as Editor;
      },
    });
    return createElement(
      'div',
      null,
      createElement(MentionDropdownMenu, { editor: ed, mentions: PEOPLE, char, allowedPrefixes: null }),
      createElement(EditorContent, { editor: ed }),
    );
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  await tick();
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const menu = () => document.body.querySelector<HTMLElement>('.tiptap-suggestion-menu');
const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
const ids = () => options().map((o) => o.getAttribute('data-user-id'));
const dom = () => editor!.view.dom;
const press = async (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    dom().dispatchEvent(event);
  });
  await tick();
  return event;
};
const type = async (text: string) => {
  await act(async () => {
    editor!.chain().focus('end').insertContent(text).run();
  });
  await tick();
};
const chips = () => {
  const out: Record<string, unknown>[] = [];
  editor!.state.doc.descendants((n) => {
    if (n.type.name === 'mention') out.push(n.attrs);
  });
  return out;
};

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  editor = null;
});

describe.each(['@', '{'])('MentionDropdownMenu with trigger %s', (char) => {
  it('opens as a listbox, first item active, the editor is the combobox pointing at it', async () => {
    await mount(char);
    expect(menu()).toBeNull();
    expect(dom().getAttribute('role')).toBe('combobox');
    expect(dom().getAttribute('aria-expanded')).toBe('false');
    await type(` ${char}`);
    expect(menu()?.getAttribute('role')).toBe('listbox');
    expect(ids()).toEqual(['event.date_hebrew', 'event.date_gregorian', 'guest.first_name']);
    expect(options()[0].getAttribute('data-active-state')).toBe('on');
    expect(dom().getAttribute('aria-expanded')).toBe('true');
    expect(dom().getAttribute('aria-controls')).toBe(menu()!.id);
    expect(dom().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(new Set(options().map((o) => o.id)).size).toBe(3);
  });

  it('Enter inserts a chip storing the id and its own trigger; text reads with that trigger', async () => {
    await mount(char);
    await type(` ${char}`);
    await press('ArrowDown');
    await press('Enter');
    expect(menu()).toBeNull();
    expect(chips()).toEqual([{ id: 'event.date_gregorian', label: 'תאריך לועזי', mentionSuggestionChar: char }]);
    expect(editor!.getText()).toBe(`שלום ${char}תאריך לועזי `);
    expect(dom().getAttribute('aria-expanded')).toBe('false');
    expect(dom().hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('Tab picks the active item; Shift+Tab and Tab with the list closed are left to the browser', async () => {
    await mount(char);
    await type(` ${char}`);
    const shiftTab = await press('Tab', { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(false);
    const tab = await press('Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(chips().map((c) => c.id)).toEqual(['event.date_hebrew']);
    const closedTab = await press('Tab');
    expect(closedTab.defaultPrevented).toBe(false);
  });

  it('Backspace right after a chip removes the whole chip and does not reopen the list', async () => {
    await mount(char);
    await type(` ${char}`);
    await press('Enter');
    await act(async () => {
      editor!.chain().focus('end').deleteRange({ from: editor!.state.doc.content.size - 2, to: editor!.state.doc.content.size - 1 }).run();
    });
    await press('Backspace');
    expect(chips()).toEqual([]);
    expect(menu()).toBeNull();
    expect(editor!.getText()).toBe('שלום ');
  });

  it('Escape closes without inserting', async () => {
    await mount(char);
    await type(` ${char}`);
    await press('Escape');
    expect(menu()).toBeNull();
    expect(chips()).toEqual([]);
  });
});

describe('search', () => {
  it('contiguous match on the Hebrew name', async () => {
    await mount('{');
    await type(' {תאר');
    expect(ids()).toEqual(['event.date_hebrew', 'event.date_gregorian']);
  });

  it('"תר" (letters not next to each other) finds nothing', async () => {
    await mount('{');
    await type(' {תר');
    expect(ids()).toEqual([]);
  });
});

describe('chip display', () => {
  it('shows the name only, styled as a tag, and survives an HTML round trip with its trigger', async () => {
    await mount('{');
    await type(' {שם');
    await press('Enter');
    const chip = dom().querySelector<HTMLElement>('span[data-type="mention"]')!;
    expect(chip.textContent).toBe('שם האורח');
    expect(chip.className).toContain('rounded-md');
    expect(chip.getAttribute('data-mention-suggestion-char')).toBe('{');
    const html = editor!.getHTML();
    await act(async () => {
      editor!.commands.setContent(html, { emitUpdate: false });
    });
    expect(chips()).toEqual([{ id: 'guest.first_name', label: 'שם האורח', mentionSuggestionChar: '{' }]);
  });

  it('clicking a chip selects it as a whole (ProseMirror-selectednode) and Backspace then deletes it', async () => {
    await mount('{');
    await type(' {שם');
    await press('Enter');
    let pos = -1;
    editor!.state.doc.descendants((n, p) => {
      if (n.type.name === 'mention') pos = p;
    });
    await act(async () => {
      editor!.commands.setNodeSelection(pos);
    });
    expect(dom().querySelector('span[data-type="mention"]')!.classList.contains('ProseMirror-selectednode')).toBe(true);
    await press('Backspace');
    expect(chips()).toEqual([]);
  });
});

describe('saved content round trip', () => {
  it('several chips come back with the same ids, labels and text', async () => {
    await mount('{');
    await type(' {שם');
    await press('Enter');
    await type('ב-{תאריך');
    await press('Enter');
    const saved = editor!.getJSON();
    const before = editor!.getText();
    await act(async () => root.unmount());
    container.remove();
    await mount('{', '');
    await act(async () => {
      editor!.commands.setContent(saved, { emitUpdate: false });
    });
    expect(chips()).toEqual([
      { id: 'guest.first_name', label: 'שם האורח', mentionSuggestionChar: '{' },
      { id: 'event.date_hebrew', label: 'תאריך עברי', mentionSuggestionChar: '{' },
    ]);
    expect(editor!.getText()).toBe(before);
  });
});
