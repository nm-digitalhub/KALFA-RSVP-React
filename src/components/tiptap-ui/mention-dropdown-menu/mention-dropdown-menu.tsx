'use client';

import { Mention } from '@tiptap/extension-mention';

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
 * HTML shows the name only, styled as a tag. Mention's
 * own suggestion plugin is switched off (`allow: false`): this menu is the one
 * that opens.
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
  // Theme tokens, so light and dark mode follow the site's palette.
  HTMLAttributes: {
    class: cn(
      'inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 align-baseline text-sm leading-none font-medium text-primary',
      '[&.ProseMirror-selectednode]:ring-2 [&.ProseMirror-selectednode]:ring-primary',
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
  subtext?: string;
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
};

export function MentionDropdownMenu({
  mentions,
  char = '@',
  selector = 'tiptap-mention-dropdown-menu',
  pluginKey = 'mentionDropdownMenu',
  emptyLabel,
  ...props
}: MentionDropdownMenuProps) {
  const items = async ({ query }: { query: string }) => {
    const list = typeof mentions === 'function' ? await mentions(query) : mentions;
    const all = list.map((entry) => mentionSuggestionItem(entry, char));
    // A function source filters itself; a static list is filtered here.
    return typeof mentions === 'function' ? all : filterSuggestionItems(all, query);
  };

  return (
    <SuggestionMenu<MentionEntry> {...props} char={char} selector={selector} pluginKey={pluginKey} items={items}>
      {({ items: visible, selectedIndex, onSelect, getItemId }) => (
        <Card size="sm" className="max-h-(--suggestion-menu-max-height) min-w-[min(14rem,100%)] overflow-y-auto py-1 shadow-md">
          <CardContent className="px-1">
            {visible.length === 0 && emptyLabel ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
            ) : (
              <div data-orientation="vertical" className="flex flex-col gap-0.5">
                {visible.map((item, index) => {
                  const entry = item.context;
                  const active = index === selectedIndex;
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
                      className="w-full justify-start data-[active-state=on]:bg-muted"
                    >
                      <Avatar size="sm">
                        {entry?.avatarUrl ? <AvatarImage src={entry.avatarUrl} alt="" /> : null}
                        <AvatarFallback>{item.title.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.subtext ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{item.subtext}</span>
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </SuggestionMenu>
  );
}
