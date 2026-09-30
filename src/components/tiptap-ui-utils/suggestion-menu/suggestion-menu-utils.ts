import type { Node as PMNode } from '@tiptap/pm/model';

import type { SuggestionItem } from './suggestion-menu';

// The two utilities Tiptap documents for its SuggestionMenu.

// Bidi control marks and a closing brace can end up inside a typed query
// (Tiptap's matcher keeps them); they are never part of a name.
const QUERY_NOISE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069}]/g;

/**
 * Items whose text contains `query` as a contiguous run, case-insensitive —
 * the logic Tiptap documents: title, subtext and keywords, exact and
 * "starts with" first. The title (the display name) ranks above subtext and
 * keywords (e.g. the technical id). An empty query returns every item.
 */
export function filterSuggestionItems<T>(items: SuggestionItem<T>[], query: string): SuggestionItem<T>[] {
  const q = query.replace(QUERY_NOISE, '').trim().toLocaleLowerCase();
  if (!q) return items;
  const score = (text: string | undefined, base: number): number => {
    const t = text?.toLocaleLowerCase() ?? '';
    if (t === q) return base;
    if (t.startsWith(q)) return base + 1;
    if (t.includes(q)) return base + 2;
    return Infinity;
  };
  return items
    .map((item, index) => ({
      item,
      index,
      rank: Math.min(
        score(item.title, 0),
        ...[item.subtext, ...(item.keywords ?? [])].map((t) => score(t, 3)),
      ),
    }))
    .filter((r) => r.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.item);
}

/**
 * Document position where the trigger that is being typed starts: the last
 * `triggerChar` in the text node before the cursor. No trigger in that node →
 * the cursor position itself.
 */
export function calculateStartPosition(
  cursorPosition: number,
  previousNode: PMNode | null,
  triggerChar: string,
): number {
  const text = previousNode?.isText ? (previousNode.text ?? '') : '';
  const at = text.lastIndexOf(triggerChar);
  if (at === -1) return cursorPosition;
  return cursorPosition - (text.length - at);
}
