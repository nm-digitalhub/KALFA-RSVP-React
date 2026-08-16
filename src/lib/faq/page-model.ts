// Pure shaping of the public /faq page content. No DB, no I/O — takes the
// published DB rows (already filtered server-side, see src/lib/data/faq.ts)
// plus the live BusinessFacts (src/lib/fleet/business-facts.ts) and produces
// ONE ordered model that both the page JSX and the FAQPage JSON-LD render
// from — so the two can never drift into two different question sets (the
// FAQ spec's requirement 7: JSON-LD generated from the SAME data that
// renders the visible page, never a second hardcoded copy).
//
// Of the platform's 14 FAQ questions, 2 are fully code-owned and never
// become `faq_items` rows at all:
//   - "כמה עולה השירות?" → the price card, buildBusinessFacts().summary_he.
//     Already passed compliance review (2026-07-26) for this exact wording —
//     never re-worded here.
//   - 'מה ההבדל בין "אורח", "איש קשר" ו"נענה"?' → buildBusinessFacts().billing_unit_he.
// One more (`pricing_no_response`, the item_key below) is a DB row but only
// PARTIALLY DB-owned: its `answer` column holds an optional supplementary
// note only — the mandatory "yes/no, unconditional" sentence is composed
// here from the SAME approved `summary_he`, never new legal wording.

import { buildFaqTokenValues, substituteFaqTokens } from './tokens';
import type { BusinessFacts } from '@/lib/fleet/business-facts';

export type FaqCategory = 'about' | 'pricing' | 'how_it_works' | 'legal_support';

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  'about',
  'pricing',
  'how_it_works',
  'legal_support',
] as const;

export const FAQ_CATEGORY_TITLES: Record<FaqCategory, string> = {
  about: 'מה זה KALFA ולמי זה מתאים',
  pricing: 'מחיר ותשלום',
  how_it_works: 'איך זה עובד',
  legal_support: 'ביטול, פרטיות ותמיכה',
};

// The one row whose lifecycle is restricted (see actions.ts): can be edited
// (only its optional supplement), never unpublished, never deleted.
export const PROTECTED_FAQ_ITEM_KEY = 'pricing_no_response';

export type FaqItemRow = {
  item_key: string | null;
  category: FaqCategory;
  question: string;
  answer: string;
  sort_order: number;
};

export type FaqEntry = { question: string; answer: string };
export type FaqSection = { category: FaqCategory; title: string; entries: FaqEntry[] };
export type FaqPageModel = { priceCard: FaqEntry; sections: FaqSection[] };

const PRICE_CARD_QUESTION = 'כמה עולה השירות?';
const BILLING_UNIT_QUESTION = 'מה ההבדל בין "אורח", "איש קשר" ו"נענה"?';

// Only reached when there is no active campaign package configured at all
// (buildBusinessFacts's own `available: false` branch) — a misconfiguration,
// not the normal state. Points the reader at a human instead of a stale or
// fabricated number.
const FALLBACK_PRICING_ANSWER = 'פרטי התמחור המדויקים אינם זמינים כרגע. לבירור המחיר, צרו קשר.';

// The mandatory, code-owned portion of the pricing_no_response answer.
// Exported (not inlined into buildFaqPageModel) so /admin/faq can render the
// EXACT same live sentence as a read-only preview next to the row's optional
// supplement field — one composition, two call sites, never two sentences
// that can drift apart.
//
// "כן"/"לא" is mechanically derived from the model buildBusinessFacts()
// already computed (base+overage: the base is charged regardless of
// outcome, so the answer is "yes, you still pay" → כן; pure per-reached:
// nothing is charged for zero responders → לא) — not a second legal
// judgment, just a yes/no lead-in onto the one compliance-approved sentence.
export function buildProtectedPricingMandatorySentence(facts: BusinessFacts): string {
  return facts.available && facts.summary_he
    ? `${facts.model === 'base_overage' ? 'כן.' : 'לא.'} ${facts.summary_he}`
    : FALLBACK_PRICING_ANSWER;
}

function categoryRows(items: FaqItemRow[], category: FaqCategory): FaqItemRow[] {
  return items
    .filter((item) => item.category === category)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function buildFaqPageModel(items: FaqItemRow[], facts: BusinessFacts): FaqPageModel {
  const tokenValues = buildFaqTokenValues(facts);
  const sub = (text: string) => substituteFaqTokens(text, tokenValues);
  const asEntry = (row: FaqItemRow): FaqEntry => ({
    question: sub(row.question),
    answer: sub(row.answer),
  });

  const priceCard: FaqEntry = {
    question: PRICE_CARD_QUESTION,
    answer: facts.available && facts.summary_he ? facts.summary_he : FALLBACK_PRICING_ANSWER,
  };

  const aboutEntries = categoryRows(items, 'about').map(asEntry);

  const pricingRows = categoryRows(items, 'pricing');
  const protectedRow = pricingRows.find((row) => row.item_key === PROTECTED_FAQ_ITEM_KEY) ?? null;
  const freePricingEntries = pricingRows
    .filter((row) => row.item_key !== PROTECTED_FAQ_ITEM_KEY)
    .map(asEntry);

  const pricingEntries: FaqEntry[] = [];
  if (protectedRow) {
    const mandatory = buildProtectedPricingMandatorySentence(facts);
    const supplement = sub(protectedRow.answer).trim();
    pricingEntries.push({
      question: sub(protectedRow.question),
      answer: supplement ? `${mandatory} ${supplement}` : mandatory,
    });
  }
  pricingEntries.push({
    question: BILLING_UNIT_QUESTION,
    answer: facts.available && facts.billing_unit_he ? facts.billing_unit_he : FALLBACK_PRICING_ANSWER,
  });
  pricingEntries.push(...freePricingEntries);

  const howEntries = categoryRows(items, 'how_it_works').map(asEntry);
  const legalEntries = categoryRows(items, 'legal_support').map(asEntry);

  // Declared as its own `FaqSection[]`-typed statement (not inline before
  // `.filter()`) so each `category` literal is checked against FaqCategory
  // instead of widening to `string` — `.filter()`'s return type is inferred
  // from its receiver, so contextual typing must land on the array literal
  // itself.
  const allSections: FaqSection[] = [
    { category: 'about', title: FAQ_CATEGORY_TITLES.about, entries: aboutEntries },
    { category: 'pricing', title: FAQ_CATEGORY_TITLES.pricing, entries: pricingEntries },
    { category: 'how_it_works', title: FAQ_CATEGORY_TITLES.how_it_works, entries: howEntries },
    { category: 'legal_support', title: FAQ_CATEGORY_TITLES.legal_support, entries: legalEntries },
  ];
  // Empty categories (spec §7) are dropped here, once, so the page and the
  // JSON-LD both simply never see them rather than each needing its own
  // "is this section empty?" check.
  const sections = allSections.filter((section) => section.entries.length > 0);

  return { priceCard, sections };
}

// The flat list both the page's quick-nav chips and the JSON-LD builder
// iterate — the price card first (it renders first on the page, before any
// category), then every section's entries in page order.
export function flattenFaqEntries(model: FaqPageModel): FaqEntry[] {
  return [model.priceCard, ...model.sections.flatMap((section) => section.entries)];
}
