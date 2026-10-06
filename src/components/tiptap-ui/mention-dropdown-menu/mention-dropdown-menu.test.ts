// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
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
let setShowMenu: (v: boolean) => void = () => {};

async function mount(char: string, content = '<p>שלום</p>', attributes: Record<string, string> = {}) {
  function Harness() {
    const [showMenu, set] = useState(true);
    setShowMenu = set;
    const ed = useEditor({
      immediatelyRender: true,
      extensions: [Document, Paragraph, Text, MentionChip],
      content,
      editorProps: { attributes },
      onCreate: ({ editor: created }) => {
        editor = created as Editor;
      },
    });
    return createElement(
      'div',
      null,
      showMenu ? createElement(MentionDropdownMenu, { editor: ed, mentions: PEOPLE, char, allowedPrefixes: null }) : null,
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

const activeId = () => options().find((o) => o.getAttribute('data-active-state') === 'on')?.getAttribute('data-user-id');
const pointer = async (el: HTMLElement, pointerType: string) => {
  await act(async () => {
    const ev = new MouseEvent('pointermove', { bubbles: true });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    el.dispatchEvent(ev);
  });
  await tick();
};
const deleteLastChar = async () => {
  await act(async () => {
    const end = editor!.state.doc.content.size - 1;
    editor!.chain().focus('end').deleteRange({ from: end - 1, to: end }).run();
  });
  await tick();
};

describe('active row', () => {
  it('resets to the first row on every query change, including back to the bare trigger', async () => {
    await mount('{');
    await type(' {');
    await press('ArrowDown');
    expect(activeId()).toBe('event.date_gregorian');
    await type('ת');
    expect(activeId()).toBe('event.date_hebrew');
    await press('ArrowDown');
    expect(activeId()).toBe('event.date_gregorian');
    await deleteLastChar(); // query back to ''
    expect(activeId()).toBe('event.date_hebrew');
  });

  it('reopening the list starts at the first row', async () => {
    await mount('{');
    await type(' {');
    await press('ArrowDown');
    await press('Escape');
    await type(' {');
    expect(activeId()).toBe('event.date_hebrew');
  });

  it('mouse hover makes a row active, so Enter picks the highlighted row; touch does not move it', async () => {
    await mount('{');
    await type(' {');
    await pointer(options()[2], 'touch');
    expect(activeId()).toBe('event.date_hebrew');
    await pointer(options()[2], 'mouse');
    expect(activeId()).toBe('guest.first_name');
    await press('Enter');
    expect(chips().map((c) => c.id)).toEqual(['guest.first_name']);
  });
});

describe('closing on an outside press', () => {
  const pointerDown = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    await tick();
  };

  it('a press outside the editor and the list closes it, even when focus stays in the editor', async () => {
    await mount('{');
    await type(' {');
    const outside = document.createElement('button');
    outside.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.appendChild(outside);
    await pointerDown(outside);
    expect(menu()).toBeNull();
    outside.remove();
  });

  // Listened for in the capture phase: a control that stops the press from
  // bubbling (React's e.stopPropagation() stops it at the root container)
  // still closes the list. A bubble-phase document listener — what
  // @mantine/hooks' useClickOutside installs — never sees this press.
  it('a press outside that stops propagation still closes it', async () => {
    await mount('{');
    await type(' {');
    const wrapper = document.createElement('div');
    wrapper.addEventListener('pointerdown', (e) => e.stopPropagation());
    const outside = document.createElement('button');
    wrapper.appendChild(outside);
    document.body.appendChild(wrapper);
    await pointerDown(outside);
    expect(menu()).toBeNull();
    wrapper.remove();
  });

  it('a press inside the list or the editor keeps it open', async () => {
    await mount('{');
    await type(' {');
    await pointerDown(options()[1]);
    expect(menu()).not.toBeNull();
    await pointerDown(dom());
    expect(menu()).not.toBeNull();
  });
});

describe('variable list design', () => {
  it('groups consecutive entries under a heading (role=group, labelled); no avatar without a picture', async () => {
    const grouped: MentionEntry[] = [
      { id: 'event.date_hebrew', label: 'תאריך עברי', group: 'פרטי האירוע', subtext: 'למשל ט״ו באב' },
      { id: 'event.venue', label: 'מקום האירוע', group: 'פרטי האירוע' },
      { id: 'guest.first_name', label: 'שם האורח', group: 'פרטי האורח' },
    ];
    function G() {
      const ed = useEditor({
        immediatelyRender: true,
        extensions: [Document, Paragraph, Text, MentionChip],
        content: '<p>שלום</p>',
        onCreate: ({ editor: created }) => {
          editor = created as Editor;
        },
      });
      return createElement('div', null, createElement(MentionDropdownMenu, { editor: ed, mentions: grouped, char: '{', allowedPrefixes: null }), createElement(EditorContent, { editor: ed }));
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(G)));
    await tick();
    await type(' {');
    const groups = [...menu()!.querySelectorAll<HTMLElement>('[role="group"]')];
    expect(groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['פרטי האירוע', 'פרטי האורח']);
    expect(groups.map((g) => g.querySelectorAll('[role="option"]').length)).toEqual([2, 1]);
    expect(menu()!.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(options()[0].textContent).toContain('למשל ט״ו באב');
  });

  it('the chip uses the dedicated variable tokens', async () => {
    await mount('{');
    await type(' {');
    await press('Enter');
    const chip = dom().querySelector<HTMLElement>('span[data-type="mention"]')!;
    expect(chip.className).toContain('bg-variable-bg');
    expect(chip.className).toContain('text-variable-text');
    expect(chip.className).not.toContain('leading-none');
  });
});

describe('empty state and announcements', () => {
  it('shows "אין תוצאות" by default when nothing matches', async () => {
    await mount('{');
    await type(' {zzz');
    expect(options()).toHaveLength(0);
    expect(menu()?.textContent).toContain('אין תוצאות');
  });

  it('announces the result count in a live region outside the listbox', async () => {
    await mount('{');
    await type(' {');
    const status = document.body.querySelector('[role="status"][aria-live="polite"]');
    expect(status?.textContent).toBe('3 תוצאות');
    expect(menu()!.contains(status)).toBe(false);
    await type('תאר');
    expect(status?.textContent).toBe('2 תוצאות');
  });
});

describe('editor attributes', () => {
  it('keeps role=combobox when the host re-renders with new editorProps (ProseMirror drops role)', async () => {
    await mount('{');
    expect(dom().getAttribute('role')).toBe('combobox');
    // A host re-render: useEditor sees new editorProps and calls setOptions.
    await act(async () => {
      editor!.setOptions({ editorProps: { attributes: { 'data-x': String(Math.random()) } } });
    });
    await tick();
    expect(dom().getAttribute('role')).toBe('combobox');
    expect(dom().getAttribute('aria-expanded')).toBe('false');
    await type(' {');
    await act(async () => {
      editor!.setOptions({ editorProps: { attributes: { 'data-x': 'again' } } });
    });
    await tick();
    expect(dom().getAttribute('aria-expanded')).toBe('true');
    expect(dom().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('names an unnamed field, and leaves a named one alone', async () => {
    await mount('{');
    expect(dom().getAttribute('aria-label')).toBe('בחירת ערך');
    await act(async () => root.unmount());
    container.remove();
    await mount('{', '<p>שלום</p>', { 'aria-labelledby': 'my-label' });
    expect(dom().hasAttribute('aria-label')).toBe(false);
  });

  it('restores the attributes it changed when the menu goes away', async () => {
    await mount('{', '<p>שלום</p>', { 'aria-controls': 'outer-panel', 'aria-autocomplete': 'inline' });
    expect(dom().getAttribute('role')).toBe('combobox');
    await type(' {');
    expect(dom().getAttribute('aria-controls')).toBe(menu()!.id);
    await press('Escape');
    expect(dom().getAttribute('aria-controls')).toBe('outer-panel');
    await act(async () => setShowMenu(false));
    await tick();
    // Back to what it was before the menu (Tiptap's role, if ProseMirror still had it).
    expect(dom().getAttribute('role')).not.toBe('combobox');
    expect(dom().getAttribute('aria-autocomplete')).toBe('inline');
    expect(dom().hasAttribute('aria-expanded')).toBe(false);
    expect(dom().hasAttribute('aria-label')).toBe(false);
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

describe('aria-activedescendant', () => {
  const activeTarget = () => {
    const id = dom().getAttribute('aria-activedescendant');
    return id ? document.getElementById(id) : null;
  };

  it('follows ArrowDown to the highlighted option', async () => {
    await mount('{');
    await type(' {');
    await press('ArrowDown');
    expect(activeTarget()?.getAttribute('data-user-id')).toBe('event.date_gregorian');
    expect(activeTarget()?.getAttribute('aria-selected')).toBe('true');
  });

  it('points at an option that exists after the list shrinks', async () => {
    await mount('{');
    await type(' {');
    await press('End'); // third row
    expect(activeTarget()?.getAttribute('data-user-id')).toBe('guest.first_name');
    await type('תאר'); // two rows left
    expect(options()).toHaveLength(2);
    expect(activeTarget()).toBe(options()[0]);
  });

  it('is absent with no results, and Escape still closes the list', async () => {
    await mount('{');
    await type(' {zzz');
    expect(options()).toHaveLength(0);
    expect(menu()).not.toBeNull();
    expect(dom().hasAttribute('aria-activedescendant')).toBe(false);
    const escape = await press('Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(dom().getAttribute('aria-expanded')).toBe('false');
  });
});
