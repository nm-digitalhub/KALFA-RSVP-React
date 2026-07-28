import type { ExchangeCategory } from './types';

// Parsing the mailbox's master category list.
//
// The document Outlook stores is a flat list of attribute-only elements:
//
//   <categories lastSavedTime="…" xmlns="CategoryList.xsd">
//     <category name="Red category" color="0" guid="{…}" … />
//   </categories>
//
// Read with regexes rather than an XML parser on purpose: there is no nesting,
// the shape is written by Outlook and does not vary, and adding a parser
// dependency to this boundary would work against the plan's aim of keeping the
// Exchange integration thin enough to drop.
//
// Pure and separate from ews-impl so it can be tested against real captured
// documents without a mailbox.

/** Decodes the XML entities that can legally appear in an attribute value. */
function decodeAttribute(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // LAST, so "&amp;#43;" does not become a live "&#43;" the numeric pass
    // above would then resolve a second time. Same rule as bodyToPlainText.
    .replace(/&amp;/gi, '&');
}

/**
 * Every category in the document, in the order Outlook stores them.
 *
 * A malformed or empty document yields an empty list rather than throwing: the
 * category picker is a convenience, and failing to read it must never be able
 * to stop the owner editing an appointment.
 */
export function parseCategoryList(xml: string): ExchangeCategory[] {
  const categories: ExchangeCategory[] = [];
  for (const match of xml.matchAll(/<category\s+([^>]*?)\/?>/g)) {
    const attrs = match[1];
    const rawName = /\bname="([^"]*)"/.exec(attrs)?.[1];
    // A category with no name cannot be selected or written; skip it rather
    // than offering a blank chip.
    if (!rawName) continue;

    const rawColor = /\bcolor="(-?\d+)"/.exec(attrs)?.[1];
    const parsed = rawColor === undefined ? Number.NaN : Number(rawColor);

    categories.push({
      name: decodeAttribute(rawName),
      // Outlook writes -1 for "no colour". Anything missing or unparseable is
      // treated the same way — an absent colour, never a guessed one.
      colorIndex: Number.isInteger(parsed) && parsed >= 0 ? parsed : null,
    });
  }
  return categories;
}
