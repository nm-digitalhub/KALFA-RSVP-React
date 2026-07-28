import { describe, expect, it } from 'vitest';

import { parseCategoryList } from './category-list';
import { categoryColorHex, OUTLOOK_CATEGORY_COLORS } from './category-colors';

// The first fixture is the real document read out of the business mailbox on
// 28.07.2026, trimmed of the attributes nothing here reads. Its colour values —
// 0,1,3,4,7,8 with gaps where Peach, Teal and Olive sit — are the evidence that
// the stored index is OlCategoryColor minus one.
const LIVE_LIST = `<?xml version="1.0" encoding="utf-8"?><categories lastSavedTime="2026-05-20T08:32:33.4073227Z" xmlns="CategoryList.xsd"><category renameOnFirstUse="1" name="Red category" color="0" keyboardShortcut="0" guid="{00d19ed5-75f6-47e4-a99a-5c3b0ebce48b}" /><category renameOnFirstUse="1" name="Orange category" color="1" keyboardShortcut="0" guid="{5167bcb2-411e-4cec-b770-551d75b6a9d1}" /><category renameOnFirstUse="1" name="Yellow category" color="3" keyboardShortcut="0" guid="{a1b2c3d4-0000-0000-0000-000000000003}" /><category renameOnFirstUse="1" name="Green category" color="4" keyboardShortcut="0" guid="{a1b2c3d4-0000-0000-0000-000000000004}" /><category renameOnFirstUse="1" name="Blue category" color="7" keyboardShortcut="0" guid="{a1b2c3d4-0000-0000-0000-000000000007}" /><category renameOnFirstUse="1" name="Purple category" color="8" keyboardShortcut="0" guid="{a1b2c3d4-0000-0000-0000-000000000008}" /></categories>`;

describe('parseCategoryList', () => {
  it('reads the live mailbox document in order, with its colour indices', () => {
    expect(parseCategoryList(LIVE_LIST)).toEqual([
      { name: 'Red category', colorIndex: 0 },
      { name: 'Orange category', colorIndex: 1 },
      { name: 'Yellow category', colorIndex: 3 },
      { name: 'Green category', colorIndex: 4 },
      { name: 'Blue category', colorIndex: 7 },
      { name: 'Purple category', colorIndex: 8 },
    ]);
  });

  it('treats -1 as no colour, which is what Outlook writes for an uncoloured one', () => {
    const xml = '<categories><category name="ללא צבע" color="-1" /></categories>';
    expect(parseCategoryList(xml)).toEqual([{ name: 'ללא צבע', colorIndex: null }]);
  });

  it('treats a missing colour attribute as no colour rather than as index 0', () => {
    // Index 0 is Red — guessing it would paint an uncoloured category red.
    const xml = '<categories><category name="בלי מאפיין" guid="{x}" /></categories>';
    expect(parseCategoryList(xml)).toEqual([{ name: 'בלי מאפיין', colorIndex: null }]);
  });

  it('decodes entities in the name, so an ampersand survives the round trip', () => {
    const xml = '<categories><category name="דנה &amp; יוסי" color="4" /></categories>';
    expect(parseCategoryList(xml)[0].name).toBe('דנה & יוסי');
  });

  it('decodes &amp; LAST, so an escaped numeric entity is not resolved twice', () => {
    const xml = '<categories><category name="&amp;#43;" color="0" /></categories>';
    expect(parseCategoryList(xml)[0].name).toBe('&#43;');
  });

  it('keeps a Hebrew name intact', () => {
    const xml = '<categories><category name="פגישת לקוח" color="4" /></categories>';
    expect(parseCategoryList(xml)).toEqual([{ name: 'פגישת לקוח', colorIndex: 4 }]);
  });

  it('skips a nameless entry instead of offering a blank choice', () => {
    const xml = '<categories><category color="4" /><category name="תקין" color="0" /></categories>';
    expect(parseCategoryList(xml)).toEqual([{ name: 'תקין', colorIndex: 0 }]);
  });

  it('returns nothing for an empty or unreadable document rather than throwing', () => {
    // Failing to read the list must never be able to block editing an event.
    expect(parseCategoryList('')).toEqual([]);
    expect(parseCategoryList('not xml at all')).toEqual([]);
  });
});

describe('categoryColorHex', () => {
  it('maps the live mailbox indices to the colours Outlook names them', () => {
    expect(OUTLOOK_CATEGORY_COLORS[0].name).toBe('Red');
    expect(OUTLOOK_CATEGORY_COLORS[1].name).toBe('Orange');
    expect(OUTLOOK_CATEGORY_COLORS[3].name).toBe('Yellow');
    expect(OUTLOOK_CATEGORY_COLORS[4].name).toBe('Green');
    expect(OUTLOOK_CATEGORY_COLORS[7].name).toBe('Blue');
    expect(OUTLOOK_CATEGORY_COLORS[8].name).toBe('Purple');
  });

  it('covers the whole OlCategoryColor range, 25 slots', () => {
    expect(OUTLOOK_CATEGORY_COLORS).toHaveLength(25);
    expect(OUTLOOK_CATEGORY_COLORS[24].name).toBe('Dark Maroon');
  });

  it('gives every slot a distinct swatch, so two categories never look alike', () => {
    const hexes = OUTLOOK_CATEGORY_COLORS.map((c) => c.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('returns null — never a colour — for absent or unknown indices', () => {
    expect(categoryColorHex(null)).toBeNull();
    expect(categoryColorHex(undefined)).toBeNull();
    expect(categoryColorHex(99)).toBeNull();
    expect(categoryColorHex(-1)).toBeNull();
  });
});
