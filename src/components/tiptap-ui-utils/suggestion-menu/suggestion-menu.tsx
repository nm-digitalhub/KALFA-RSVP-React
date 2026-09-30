'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { exitSuggestion, Suggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { autoUpdate, flip, offset, shift, size, useFloating, type UseFloatingOptions } from '@floating-ui/react';

import { useMenuNavigation } from '@/hooks/use-menu-navigation';
import { useTiptapEditor } from '@/hooks/use-tiptap-editor';
import { cn } from '@/lib/utils';

// The public API of Tiptap UI's SuggestionMenu
// (https://tiptap.dev/docs/ui-components/utils-components/suggestion-menu),
// built on the pieces its registry entry lists as dependencies:
// @tiptap/suggestion, use-menu-navigation, use-tiptap-editor and
// @floating-ui/react. Tiptap's own component is a paid registry item whose
// source we do not have; this follows the documented props, utilities and the
// behaviour observed on the public demo (2026-09-30): the list is a
// `div.tiptap-suggestion-menu[role=listbox]` portalled to <body>, positioned
// with a transform, focus stays in the editor, arrows / Tab / Home / End move
// the selection, Enter picks, Escape closes, typing resets to the first item.
//
// Types come from the packages (SuggestionOptions, UseFloatingOptions); only
// the item shape, which no package defines, is declared here.

export type SuggestionItem<T = unknown> = {
  title: string;
  subtext?: string;
  badge?: React.ComponentType<{ className?: string }> | string;
  group?: string;
  keywords?: string[];
  context?: T;
  onSelect: (props: { editor: Editor; range: Range; context?: T }) => void;
};

export type SuggestionMenuRenderProps<T = unknown> = {
  items: SuggestionItem<T>[];
  selectedIndex?: number;
  onSelect: (item: SuggestionItem<T>) => void;
  /** Id for the item at `index`, so the editor's aria-activedescendant resolves. */
  getItemId: (index: number) => string;
};

type PassThroughOptions = Pick<
  SuggestionOptions<SuggestionItem>,
  | 'char'
  | 'allowSpaces'
  | 'allowToIncludeChar'
  | 'allowedPrefixes'
  | 'startOfLine'
  | 'decorationTag'
  | 'decorationClass'
  | 'decorationContent'
>;

export type SuggestionMenuProps<T = unknown> = PassThroughOptions & {
  editor?: Editor | null;
  items?: (props: { query: string; editor: Editor }) => SuggestionItem<T>[] | Promise<SuggestionItem<T>[]>;
  children?: (props: SuggestionMenuRenderProps<T>) => React.ReactNode;
  floatingOptions?: Partial<UseFloatingOptions>;
  selector?: string;
  pluginKey?: string | PluginKey;
  maxHeight?: number;
  ariaLabel?: string;
  className?: string;
  /** Tab picks the active item ("select", default here) or moves the selection ("navigate", Tiptap's). */
  tabBehavior?: 'select' | 'navigate';
};

type OpenState = {
  query: string;
  range: Range;
  items: SuggestionItem[];
  clientRect: SuggestionProps['clientRect'];
};

export function SuggestionMenu<T = unknown>({
  editor: providedEditor,
  char = '@',
  items: getItems = () => [],
  children,
  floatingOptions,
  selector = 'tiptap-suggestion-menu',
  pluginKey = 'suggestion',
  maxHeight = 384,
  ariaLabel = 'Suggestions',
  className,
  tabBehavior = 'select',
  ...suggestionOptions
}: SuggestionMenuProps<T>) {
  const { editor } = useTiptapEditor(providedEditor);
  const [open, setOpen] = React.useState<OpenState | null>(null);
  const menuId = React.useId();

  // Plugins capture their options once; useEffectEvent always calls the latest source.
  const readItems = React.useEffectEvent((props: { query: string; editor: Editor }) => getItems(props));

  const key = React.useMemo(
    () => (typeof pluginKey === 'string' ? new PluginKey(pluginKey) : pluginKey),
    [pluginKey],
  );

  const optionsKey = JSON.stringify(suggestionOptions);
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const plugin = Suggestion<SuggestionItem, SuggestionItem>({
      editor,
      char,
      pluginKey: key,
      ...(JSON.parse(optionsKey) as PassThroughOptions),
      items: ({ query, editor: ed }) => readItems({ query, editor: ed }) as SuggestionItem[] | Promise<SuggestionItem[]>,
      // Selection runs through each item's own onSelect (below), not here.
      command: ({ editor: ed, range, props }) => props.onSelect({ editor: ed, range, context: props.context }),
      render: () => {
        const sync = (p: SuggestionProps<SuggestionItem, SuggestionItem>) =>
          setOpen({ query: p.query, range: p.range, items: p.items, clientRect: p.clientRect });
        return {
          onStart: sync,
          onUpdate: sync,
          onExit: () => setOpen(null),
        };
      },
    });
    editor.registerPlugin(plugin);
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
      setOpen(null);
    };
  }, [editor, char, key, optionsKey]);

  const {
    refs: { setFloating, setPositionReference },
    floatingStyles,
  } = useFloating({
    open: !!open,
    placement: 'bottom-start',
    strategy: 'absolute',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ mainAxis: true, crossAxis: false }),
      shift(),
      // Fit the space left on screen — the visual viewport by default, so a
      // phone's open keyboard counts (floating-ui.com/docs/detectoverflow).
      size({
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.setProperty(
            '--suggestion-menu-max-height',
            `${Math.max(0, Math.min(maxHeight, availableHeight - 10))}px`,
          );
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
        },
      }),
    ],
    ...floatingOptions,
  });

  // The suggestion plugin gives a live rect getter; anchor to it as a virtual element.
  React.useEffect(() => {
    if (!open || !editor) return;
    const rect = open.clientRect;
    setPositionReference({
      getBoundingClientRect: () => rect?.() ?? new DOMRect(),
      contextElement: editor.view.dom,
    });
  }, [open, editor, setPositionReference]);

  const close = React.useCallback(() => {
    if (editor && !editor.isDestroyed) exitSuggestion(editor.view, key);
  }, [editor, key]);

  const onSelect = React.useCallback(
    (item: SuggestionItem<T>) => {
      if (!editor || !open) return;
      item.onSelect({ editor, range: open.range, context: item.context });
    },
    [editor, open],
  );

  const visibleItems = (open?.items ?? []) as SuggestionItem<T>[];
  const { selectedIndex } = useMenuNavigation<SuggestionItem<T>>({
    editor,
    query: open?.query,
    items: visibleItems,
    onSelect,
    onClose: close,
    tabBehavior,
  });

  const getItemId = React.useCallback((index: number) => `${menuId}-option-${index}`, [menuId]);

  // Focus never leaves the editor, so the editor itself is the combobox
  // (WAI-ARIA combobox pattern; aria-expanded is not valid on role=textbox).
  React.useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const previousRole = dom.getAttribute('role');
    dom.setAttribute('role', 'combobox');
    dom.setAttribute('aria-autocomplete', 'list');
    dom.setAttribute('aria-haspopup', 'listbox');
    dom.setAttribute('aria-expanded', 'false');
    return () => {
      if (previousRole === null) dom.removeAttribute('role');
      else dom.setAttribute('role', previousRole);
      for (const a of ['aria-autocomplete', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) {
        dom.removeAttribute(a);
      }
    };
  }, [editor]);

  React.useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom || !open) return;
    dom.setAttribute('aria-expanded', 'true');
    dom.setAttribute('aria-controls', menuId);
    if (selectedIndex !== undefined && selectedIndex >= 0) {
      dom.setAttribute('aria-activedescendant', getItemId(selectedIndex));
      document.getElementById(getItemId(selectedIndex))?.scrollIntoView({ block: 'nearest' });
    } else {
      dom.removeAttribute('aria-activedescendant');
    }
    return () => {
      dom.setAttribute('aria-expanded', 'false');
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
    };
  }, [editor, open, menuId, selectedIndex, getItemId]);

  // Leaving the editor closes the menu (the plugin itself does not).
  React.useEffect(() => {
    if (!editor || !open) return;
    const onBlur = () => close();
    editor.on('blur', onBlur);
    return () => {
      editor.off('blur', onBlur);
    };
  }, [editor, open, close]);

  if (!open || !editor || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={setFloating}
      id={menuId}
      tabIndex={-1}
      data-selector={selector}
      className={cn('tiptap-suggestion-menu', className)}
      role="listbox"
      aria-label={ariaLabel}
      style={{ ...floatingStyles, zIndex: 1000 }}
      // Keep the editor focused while the pointer picks an item.
      onPointerDown={(event) => event.preventDefault()}
    >
      {children?.({ items: visibleItems, selectedIndex, onSelect, getItemId })}
    </div>,
    document.body,
  );
}
