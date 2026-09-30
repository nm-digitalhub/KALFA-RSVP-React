'use client';

import * as React from 'react';
import { optionIs, rankWith, type ControlProps } from '@jsonforms/core';
import { withJsonFormsControlProps } from '@jsonforms/react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Placeholder } from '@tiptap/extensions';
import { Extension } from '@tiptap/core';

import { MentionChip, MentionDropdownMenu, type MentionEntry } from '@/components/tiptap-ui/mention-dropdown-menu';
import { cn } from '@/lib/utils';

// JSON Forms control for "which value fills this variable": a one-line field
// where typing `{` opens the list of values and the pick becomes a chip. The
// control's value is the picked value's id (a source path), or undefined.
//
// Bound by `options.format: 'kalfa-value-path'` on the uischema Control. The
// values offered come from `options.values` ({ id, label }[]) — built by the
// screen from the server's value catalog, never hard-coded here.
//
// JSON Forms sends the value in through `data` and gets it back through
// `handleChange`; the editor is kept in step with `emitUpdate: false` so the
// two never loop (Tiptap map §4.6).

export const VALUE_PATH_FORMAT = 'kalfa-value-path';

type Options = {
  values?: MentionEntry[];
  placeholder?: string;
  trigger?: string;
};

// One paragraph, no line breaks: Enter/Shift-Enter do nothing here. Priority
// stays at the default (100), below Mention's 101, so an open list still gets
// Enter first (Tiptap map §4.3).
const SingleLine = Extension.create({
  name: 'singleLine',
  addKeyboardShortcuts() {
    return { Enter: () => true, 'Shift-Enter': () => true, 'Mod-Enter': () => true };
  },
});
const OneParagraph = Document.extend({ content: 'paragraph' });

function chipIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention' && typeof node.attrs.id === 'string') ids.push(node.attrs.id);
  });
  return ids;
}

function contentFor(id: string | undefined, values: MentionEntry[], trigger: string): JSONContent {
  if (!id) return { type: 'doc', content: [{ type: 'paragraph' }] };
  const label = values.find((v) => v.id === id)?.label ?? id;
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id, label, mentionSuggestionChar: trigger } }] }],
  };
}

function ValuePathControl({
  data,
  handleChange,
  path,
  id,
  label,
  required,
  enabled,
  visible,
  errors,
  description,
  uischema,
}: ControlProps) {
  const options = (uischema.options ?? {}) as Options;
  const values = React.useMemo(() => options.values ?? [], [options.values]);
  const trigger = options.trigger ?? '{';
  const value = typeof data === 'string' && data !== '' ? data : undefined;
  // JSON Forms ids are scope paths ("#/properties/p1"); DOM references use React ids.
  const domId = React.useId();
  const labelId = `${domId}-label`;
  const errorId = `${domId}-error`;
  const descriptionId = `${domId}-description`;
  const hasError = errors !== '';
  // The line under the field that the editor is described by: the error, else the description.
  const describedBy = hasError ? errorId : description ? descriptionId : null;

  // One chip at most. A pick replaces whatever was there (old chip, query
  // text) with exactly the picked chip; deleting the chip clears the value;
  // query text left behind is dropped when the field loses focus. useEditor
  // always calls the latest callbacks, so they read the current value.
  const onUpdate = (editor: Editor) => {
    const ids = chipIds(editor);
    const picked = ids.find((i) => i !== value);
    if (picked) {
      handleChange(path, picked);
      editor.commands.setContent(contentFor(picked, values, trigger), { emitUpdate: false });
      editor.commands.focus('end');
    } else if (ids.length === 0 && value) {
      handleChange(path, undefined);
    }
  };
  const onBlur = (editor: Editor) => {
    if (editor.state.doc.textContent !== '') {
      editor.commands.setContent(contentFor(value, values, trigger), { emitUpdate: false });
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      OneParagraph,
      Paragraph,
      Text,
      MentionChip,
      SingleLine,
      Placeholder.configure({ placeholder: options.placeholder ?? `הקלידו ${trigger} כדי לבחור ערך` }),
    ],
    content: contentFor(value, values, trigger),
    editable: enabled,
    editorProps: {
      attributes: {
        id,
        'aria-labelledby': labelId,
        'aria-multiline': 'false',
        dir: 'rtl',
        class: cn(
          'min-h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base leading-6 outline-none md:text-sm',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
          '[&_p.is-empty::before]:pointer-events-none [&_p.is-empty::before]:float-start [&_p.is-empty::before]:h-0 [&_p.is-empty::before]:text-muted-foreground [&_p.is-empty::before]:content-[attr(data-placeholder)]',
        ),
      },
    },
    onUpdate: ({ editor: ed }) => onUpdate(ed as Editor),
    onBlur: ({ editor: ed }) => onBlur(ed as Editor),
  });

  // Value from outside (a reset, a server error round, another field) → editor.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = chipIds(editor)[0];
    if (current !== value) editor.commands.setContent(contentFor(value, values, trigger), { emitUpdate: false });
  }, [editor, value, values, trigger]);

  React.useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(enabled, false);
  }, [editor, enabled]);

  React.useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    if (hasError) dom.setAttribute('aria-invalid', 'true');
    else dom.removeAttribute('aria-invalid');
    if (describedBy) dom.setAttribute('aria-describedby', describedBy);
    else dom.removeAttribute('aria-describedby');
    if (required) dom.setAttribute('aria-required', 'true');
    else dom.removeAttribute('aria-required');
  }, [editor, hasError, describedBy, required]);

  if (!visible) return null;

  return (
    <div className="grid gap-1.5" data-slot="value-path-control">
      {/* A contenteditable is not a labelable element: the name comes from
          aria-labelledby, and a click on the label focuses the field. */}
      <label id={labelId} className="text-sm font-medium" onClick={() => editor?.commands.focus('end')}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <MentionDropdownMenu editor={editor} mentions={values} char={trigger} allowedPrefixes={null} emptyLabel="אין ערך כזה" />
      <EditorContent editor={editor} />
      {description && !hasError ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {errors}
        </p>
      ) : null}
    </div>
  );
}

export const valuePathControlTester = rankWith(5000, optionIs('format', VALUE_PATH_FORMAT));
export const ValuePathControlRenderer = withJsonFormsControlProps(ValuePathControl);
export const valuePathControlEntry = { tester: valuePathControlTester, renderer: ValuePathControlRenderer };
