import { z } from 'zod';

import { CANCELLATION_REFERENCE_PREFIX } from './cancellation-reference';

// The admin list's search box, parsed. Staff type a reference ("CX-7K4Q-92XM", "7k4q", "#14" by habit) or part of an
// event's name; both are matched with LIKE in the database, so the text is escaped for LIKE (\ % _ match themselves).
// The reference is matched without its prefix and in upper case, because the stored code has neither.
export type CancellationSearch = { likeCode: string; likeText: string };

const MAX_LENGTH = 80;
const searchText = z.string().trim().min(1).max(MAX_LENGTH);

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** null = no search (empty, too long, or not text). */
export function cancellationSearch(raw: unknown): CancellationSearch | null {
  const parsed = searchText.safeParse(raw);
  if (!parsed.success) return null;
  const text = parsed.data;
  const prefix = new RegExp(`^${CANCELLATION_REFERENCE_PREFIX}`, 'i');
  const code = text.replace(/^#/, '').replace(prefix, '').toUpperCase();
  return { likeCode: escapeLike(code), likeText: escapeLike(text) };
}
