import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';

import { calculateStartPosition, filterSuggestionItems } from './suggestion-menu-utils';

const schema = getSchema([Document, Paragraph, Text]);
const item = (title: string, extra: { subtext?: string; keywords?: string[] } = {}) => ({ title, ...extra, onSelect: () => {} });

describe('filterSuggestionItems', () => {
  const items = [item('שם האורח', { keywords: ['guest'] }), item('תאריך עברי'), item('תאריך לועזי', { subtext: 'date' })];

  it('empty query returns everything, in order', () => {
    expect(filterSuggestionItems(items, '  ')).toBe(items);
  });

  it('matches title, subtext and keywords as a contiguous run; drops non-matches', () => {
    expect(filterSuggestionItems(items, 'תאריך').map((i) => i.title)).toEqual(['תאריך עברי', 'תאריך לועזי']);
    expect(filterSuggestionItems(items, 'guest').map((i) => i.title)).toEqual(['שם האורח']);
    expect(filterSuggestionItems(items, 'date').map((i) => i.title)).toEqual(['תאריך לועזי']);
    expect(filterSuggestionItems(items, 'תר')).toEqual([]);
    expect(filterSuggestionItems(items, 'zzz')).toEqual([]);
  });

  it('ranks the name above subtext/keywords, and exact/starts-with above contains', () => {
    const list = [item('עברית', { keywords: ['תאריך'] }), item('ראש תאריך'), item('תאריך')];
    expect(filterSuggestionItems(list, 'תאריך').map((i) => i.title)).toEqual(['תאריך', 'ראש תאריך', 'עברית']);
  });

  it('ignores bidi marks and a closing brace typed into the query', () => {
    expect(filterSuggestionItems(items, '\u200fתאריך}').map((i) => i.title)).toEqual(['תאריך עברי', 'תאריך לועזי']);
  });
});

describe('calculateStartPosition', () => {
  it('points at the last trigger in the text before the cursor', () => {
    const text = schema.text('שלום {שם');
    expect(calculateStartPosition(20, text, '{')).toBe(20 - 3);
  });
  it('no trigger or no text node → the cursor itself', () => {
    expect(calculateStartPosition(7, schema.text('abc'), '{')).toBe(7);
    expect(calculateStartPosition(7, null, '{')).toBe(7);
  });
});
