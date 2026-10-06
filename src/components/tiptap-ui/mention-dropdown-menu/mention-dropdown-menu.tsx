'use client';

import { useId, type ComponentType } from 'react';
import { Mention } from '@tiptap/extension-mention';
import { Braces } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import {
  filterSuggestionItems,
  SuggestionMenu,
  type SuggestionItem,
  type SuggestionMenuProps,
} from '@/components/tiptap-ui-utils/suggestion-menu';

// Tiptap UI's MentionDropdownMenu
// (https://tiptap.dev/docs/ui-components/components/mention-dropdown-menu):
// "inherits all props from SuggestionMenuProps", triggers on `@`, and picks
// insert a `mention` node plus a space — the demo produces
// `<span data-type="mention" data-id data-label data-mention-suggestion-char="@">`
// followed by " " (observed 2026-09-30). Tiptap's is a paid registry item; this
// is built from that documented API and observed behaviour, rendered with our
// Card / Avatar / Button instead of their SCSS primitives. Needs the Mention
// extension — use MentionChip below.

/**
 * The Mention extension for editors that use this menu. Tiptap's Mention writes
 * a chip's text/HTML with the trigger of ITS OWN configured suggestion and
 * falls back to "@" (extension-mention index.js 69–75, 86–98), so a `{` chip
 * would read "@name". Here the text form uses the chip's stored trigger and the
 * HTML shows the name only, styled as a tag. Mention's own suggestion plugin is
 * switched off (`allow: false`): this menu is the one that opens.
 */
export const MentionChip = Mention.extend({
  // A chip can be selected as a whole by clicking it, which gives
  // it ProseMirror's `ProseMirror-selectednode` class for the selected style.
  selectable: true,
}).configure({
  // Backspace next to a chip removes the whole chip (Tiptap's default turns it
  // back into the trigger and reopens the list).
  deleteTriggerWithBackspace: true,
  // A tag inside the sentence: the variable's name only, no trigger/brackets.
  // Own tokens (globals.css --variable-*), indigo in light and dark mode.
  HTMLAttributes: {
    class: cn(
      'mx-0.5 inline-block rounded-md border border-variable-border bg-variable-bg px-1.5 py-px align-baseline text-[0.92em] leading-normal font-medium text-variable-text',
      '[&.ProseMirror-selectednode]:ring-2 [&.ProseMirror-selectednode]:ring-variable-ring',
    ),
  },
  renderText: ({ node }) => `${node.attrs.mentionSuggestionChar ?? '@'}${node.attrs.label ?? node.attrs.id}`,
  // options.HTMLAttributes carries data-type / data-id / data-label /
  // data-mention-suggestion-char plus the class above — all of them are needed
  // to read the chip back from HTML.
  renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, `${node.attrs.label ?? node.attrs.id}`],
  suggestion: { allow: () => false },
});

export type MentionEntry = {
  id: string;
  label: string;
  /** Second line under the name (a short description). */
  subtext?: string;
  /** Heading the entry is listed under ("פרטי האירוע", "פרטי האורח"…). */
  group?: string;
  /** Icon for the kind of value (date, text, place…); a generic variable icon otherwise. */
  icon?: ComponentType<{ className?: string }>;
  /** A person's picture, when the entries are people. */
  avatarUrl?: string;
  keywords?: string[];
};

/** A suggestion item that inserts a mention of `entry` at the trigger. */
export function mentionSuggestionItem(entry: MentionEntry, char = '@'): SuggestionItem<MentionEntry> {
  return {
    title: entry.label,
    subtext: entry.subtext,
    keywords: entry.keywords,
    context: entry,
    onSelect: ({ editor, range, context }) => {
      if (!context) return;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { id: context.id, label: context.label, mentionSuggestionChar: char } },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
  };
}

export type MentionDropdownMenuProps = Omit<SuggestionMenuProps<MentionEntry>, 'items' | 'children'> & {
  /** Who can be mentioned; filtered by the typed query. */
  mentions: MentionEntry[] | ((query: string) => MentionEntry[] | Promise<MentionEntry[]>);
  /** Shown when nothing matches. */
  emptyLabel?: string;
  /** Shown while the list is being fetched. */
  loadingLabel?: string;
};

export function MentionDropdownMenu({
  mentions,
  char = '@',
  selector = 'tiptap-mention-dropdown-menu',
  pluginKey = 'mentionDropdownMenu',
  emptyLabel = 'אין תוצאות',
  loadingLabel = 'טוען…',
  ...props
}: MentionDropdownMenuProps) {
  const groupIdBase = useId();
  const items = async ({ query }: { query: string }) => {
    const list = typeof mentions === 'function' ? await mentions(query) : mentions;
    const all = list.map((entry) => mentionSuggestionItem(entry, char));
    // A function source filters itself; a static list is filtered here.
    return typeof mentions === 'function' ? all : filterSuggestionItems(all, query);
  };

  return (
    <SuggestionMenu<MentionEntry> {...props} char={char} selector={selector} pluginKey={pluginKey} items={items}>
      {({ items: visible, selectedIndex, onSelect, getItemId, setSelectedIndex, loading }) => {
        const row = (item: (typeof visible)[number], index: number) => {
          const entry = item.context;
          const active = index === selectedIndex;
          const Icon = entry?.icon ?? Braces;
          return (
            <Button
              key={entry?.id ?? item.title}
              id={getItemId(index)}
              variant="ghost"
              role="option"
              aria-selected={active}
              tabIndex={-1}
              data-active-state={active ? 'on' : 'off'}
              data-user-id={entry?.id}
              onClick={() => onSelect(item)}
              // The mouse moves the active row, so what is highlighted is what
              // Enter picks. Touch does not: a finger scrolling the list must
              // not move the selection.
              onPointerMove={(event) => {
                if (event.pointerType === 'mouse' && !active) setSelectedIndex(index);
              }}
              className={cn(
                // A row, not a button: 44px touch height, grows with a second line.
                'relative h-auto min-h-11 w-full items-start justify-start gap-2.5 rounded-md px-2.5 py-2 text-start whitespace-normal',
                'hover:bg-transparent',
                // Active: brand tint + a bar on the inline-start edge.
                'data-[active-state=on]:bg-suggestion-active-bg data-[active-state=on]:hover:bg-suggestion-active-bg',
                'before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-transparent',
                'data-[active-state=on]:before:bg-suggestion-active-bar',
              )}
            >
              {entry?.avatarUrl ? (
                <Avatar size="sm" className="mt-0.5">
                  <AvatarImage src={entry.avatarUrl} alt="" />
                  <AvatarFallback>{item.title.slice(0, 1)}</AvatarFallback>
                </Avatar>
              ) : (
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-variable-bg text-variable-text"
                >
                  <Icon className="size-3.5" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                {item.subtext ? (
                  <span className="text-xs leading-snug text-muted-foreground">{item.subtext}</span>
                ) : null}
              </span>
            </Button>
          );
        };

        // Consecutive entries with the same `group` share a heading.
        const groups: Array<{ name: string | undefined; rows: Array<[(typeof visible)[number], number]> }> = [];
        visible.forEach((item, index) => {
          const name = item.context?.group;
          const last = groups.at(-1);
          if (last && last.name === name) last.rows.push([item, index]);
          else groups.push({ name, rows: [[item, index]] });
        });

        return (
          <Card
            size="sm"
            className="max-h-(--suggestion-menu-max-height) min-w-[min(15rem,100%)] overflow-y-auto py-1 shadow-md"
          >
            <CardContent className="px-1">
              {visible.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-muted-foreground">{loading ? loadingLabel : emptyLabel}</p>
              ) : (
                groups.map((group, g) =>
                  group.name ? (
                    <div
                      key={`g${g}`}
                      role="group"
                      aria-labelledby={`${groupIdBase}-g${g}`}
                      className="flex flex-col gap-0.5"
                    >
                      <div
                        id={`${groupIdBase}-g${g}`}
                        className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                      >
                        {group.name}
                      </div>
                      {group.rows.map(([item, index]) => row(item, index))}
                    </div>
                  ) : (
                    <div key={`g${g}`} data-orientation="vertical" className="flex flex-col gap-0.5">
                      {group.rows.map(([item, index]) => row(item, index))}
                    </div>
                  ),
                )
              )}
            </CardContent>
          </Card>
        );
      }}
    </SuggestionMenu>
  );
}
