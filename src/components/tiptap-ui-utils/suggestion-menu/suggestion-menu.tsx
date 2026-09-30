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
  /** Make the item at `index` the active one (e.g. on mouse hover), so Enter picks what is highlighted. */
  setSelectedIndex: (index: number) => void;
  /** True while items are being fetched (show a loading row, not "no results"). */
  loading: boolean;
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
  /**
   * Accessible name for the editor when it has none of its own (no aria-label /
   * aria-labelledby). A field inside a labelled form control should label it there.
   */
  fieldLabel?: string;
  /** What the live region announces: result count, or no results. */
  announce?: (count: number) => string;
  className?: string;
  /** Tab picks the active item ("select", default here) or moves the selection ("navigate", Tiptap's). */
  tabBehavior?: 'select' | 'navigate';
};

type OpenState = {
  query: string;
  range: Range;
  items: SuggestionItem[];
  loading: boolean;
  clientRect: SuggestionProps['clientRect'];
};

// Same padding for flip, shift and size, as the Floating UI docs ask.
const EDGE_GAP = 8;

const DEFAULT_ANNOUNCE = (count: number) =>
  count === 0 ? 'אין תוצאות' : count === 1 ? 'תוצאה אחת' : `${count} תוצאות`;

// Attributes this component sets on the editor element, restored on cleanup to
// whatever they were before (not just removed).
const COMBOBOX_ATTRS = ['role', 'aria-autocomplete', 'aria-haspopup', 'aria-expanded', 'aria-label'] as const;

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
  fieldLabel = 'בחירת ערך',
  announce = DEFAULT_ANNOUNCE,
  className,
  tabBehavior = 'select',
  ...suggestionOptions
}: SuggestionMenuProps<T>) {
  const { editor } = useTiptapEditor(providedEditor);
  const [open, setOpen] = React.useState<OpenState | null>(null);
  const menuId = React.useId();

  // Plugins capture their options once; useEffectEvent always calls the latest source.
  const readItems = React.useEffectEvent((props: { query: string; editor: Editor }) => getItems(props));

  const key = React.useMemo(() => (typeof pluginKey === 'string' ? new PluginKey(pluginKey) : pluginKey), [pluginKey]);

  const optionsKey = JSON.stringify(suggestionOptions);
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const plugin = Suggestion<SuggestionItem, SuggestionItem>({
      editor,
      char,
      pluginKey: key,
      ...(JSON.parse(optionsKey) as PassThroughOptions),
      items: ({ query, editor: ed }) =>
        readItems({ query, editor: ed }) as SuggestionItem[] | Promise<SuggestionItem[]>,
      // Selection runs through each item's own onSelect (below), not here.
      command: ({ editor: ed, range, props }) => props.onSelect({ editor: ed, range, context: props.context }),
      render: () => {
        const sync = (p: SuggestionProps<SuggestionItem, SuggestionItem>) =>
          setOpen({
            query: p.query,
            range: p.range,
            items: p.items,
            loading: p.loading,
            clientRect: p.clientRect,
          });
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
      flip({ mainAxis: true, crossAxis: false, padding: EDGE_GAP }),
      // Keep a gap from the screen edge (floating-ui.com/docs/shift, padding).
      shift({ padding: EDGE_GAP }),
      // Fit the space left on screen — the visual viewport by default, so a
      // phone's open keyboard counts (floating-ui.com/docs/detectoverflow).
      size({
        padding: EDGE_GAP,
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.setProperty(
            '--suggestion-menu-max-height',
            `${Math.max(0, Math.min(maxHeight, availableHeight))}px`,
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
  const { selectedIndex, setSelectedIndex } = useMenuNavigation<SuggestionItem<T>>({
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
  //
  // ProseMirror owns the editor element's attributes: when the host re-renders
  // with new editorProps, it recomputes them and removes ones it had set (Tiptap
  // adds role="textbox" only when the view is created, so the first such update
  // drops `role`, ours included). So the wanted state is kept in a ref and
  // re-applied by a MutationObserver whenever something changes one of them.
  const wantedRef = React.useRef<Map<string, string | null>>(new Map());
  const previousRef = React.useRef<Map<string, string | null>>(new Map());

  const applyWanted = React.useCallback((dom: HTMLElement) => {
    for (const [a, value] of wantedRef.current) {
      if (dom.getAttribute(a) === value) continue;
      if (value === null) dom.removeAttribute(a);
      else dom.setAttribute(a, value);
    }
  }, []);

  React.useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    previousRef.current = new Map(COMBOBOX_ATTRS.map((a) => [a, dom.getAttribute(a)]));
    const named = dom.hasAttribute('aria-label') || dom.hasAttribute('aria-labelledby');
    wantedRef.current = new Map<string, string | null>([
      ['role', 'combobox'],
      ['aria-autocomplete', 'list'],
      ['aria-haspopup', 'listbox'],
      ['aria-expanded', 'false'],
      ...(named ? [] : ([['aria-label', fieldLabel]] as Array<[string, string]>)),
    ]);
    applyWanted(dom);
    const observer = new MutationObserver(() => applyWanted(dom));
    observer.observe(dom, {
      attributes: true,
      attributeFilter: [...COMBOBOX_ATTRS, 'aria-controls', 'aria-activedescendant'],
    });
    return () => {
      observer.disconnect();
      for (const [a, value] of previousRef.current) {
        if (value === null) dom.removeAttribute(a);
        else dom.setAttribute(a, value);
      }
      wantedRef.current = new Map();
    };
  }, [editor, fieldLabel, applyWanted]);

  React.useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom || !open) return;
    const previousControls = dom.getAttribute('aria-controls');
    const previousActive = dom.getAttribute('aria-activedescendant');
    const active = selectedIndex !== undefined && selectedIndex >= 0 ? getItemId(selectedIndex) : null;
    wantedRef.current.set('aria-expanded', 'true');
    wantedRef.current.set('aria-controls', menuId);
    wantedRef.current.set('aria-activedescendant', active);
    applyWanted(dom);
    if (active) document.getElementById(active)?.scrollIntoView({ block: 'nearest' });
    return () => {
      wantedRef.current.set('aria-expanded', 'false');
      wantedRef.current.set('aria-controls', previousControls);
      wantedRef.current.set('aria-activedescendant', previousActive);
      applyWanted(dom);
      wantedRef.current.delete('aria-controls');
      wantedRef.current.delete('aria-activedescendant');
    };
  }, [editor, open, menuId, selectedIndex, getItemId, applyWanted]);

  // A press outside the editor and the list closes it — also on a control that
  // keeps the editor focused (preventDefault on pointerdown), where no blur
  // happens. Same rule as @tiptap/suggestion's own dismissOnOutsideClick, which
  // only runs through props.mount (not used here).
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!editor || !open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (editor.view.dom.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editor, open, close]);

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
    <>
      <div
        ref={(node) => {
          menuRef.current = node;
          setFloating(node);
        }}
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
        {children?.({
          items: visibleItems,
          selectedIndex,
          onSelect,
          getItemId,
          setSelectedIndex,
          loading: open.loading,
        })}
      </div>
      {/* Result count for screen readers, outside the listbox (a listbox holds
        options only); silent while items are loading. */}
      <span className="sr-only" role="status" aria-live="polite">
        {open.loading ? '' : announce(visibleItems.length)}
      </span>
    </>,
    document.body,
  );
}
