import { describe, expect, it } from 'vitest';

import {
  buildFaqPageModel,
  flattenFaqEntries,
  PROTECTED_FAQ_ITEM_KEY,
  type FaqItemRow,
} from './page-model';
import { buildBusinessFacts, type PackageFacts } from '@/lib/fleet/business-facts';

const pkg: PackageFacts = {
  name: 'אישורי הגעה — וואטסאפ + שיחות AI',
  price_per_reached: 4,
  base_price: 200,
  included_reached: 200,
  channels: ['whatsapp', 'call'],
};

const ITEMS: FaqItemRow[] = [
  { item_key: null, category: 'about', question: 'מה זה KALFA?', answer: 'תשובה על KALFA.', sort_order: 1 },
  {
    item_key: PROTECTED_FAQ_ITEM_KEY,
    category: 'pricing',
    question: 'אם אף אחד לא יענה, האם עדיין אני משלם?',
    answer: '',
    sort_order: 1,
  },
  {
    item_key: null,
    category: 'pricing',
    question: 'איך התשלום מתבצע בפועל?',
    answer: 'תיאור התהליך.',
    sort_order: 2,
  },
  { item_key: null, category: 'legal_support', question: 'איך מבטלים?', answer: 'תשובה על ביטול.', sort_order: 1 },
];

// The highest-value guarantee on this page: the ₪200 activation fee must
// never read as outcome-dependent (Consumer Protection Law price-
// misrepresentation review). This is the FIRST test in the file on purpose.
describe('the protected pricing_no_response answer', () => {
  it('under the base+overage model, states the fee is charged UNCONDITIONALLY', () => {
    const model = buildFaqPageModel(ITEMS, buildBusinessFacts(true, pkg));
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    const protectedEntry = pricing.entries.find(
      (e) => e.question === 'אם אף אחד לא יענה, האם עדיין אני משלם?',
    )!;
    expect(protectedEntry.answer.startsWith('כן.')).toBe(true);
    expect(protectedEntry.answer).toContain('אינם מותנים בתוצאה');
    expect(protectedEntry.answer).toContain('גם אם לא נענה אף איש קשר');
    // Never the opposite ("pay only for responders") framing on the base fee.
    expect(protectedEntry.answer).not.toContain('משלמים רק');
  });

  it('reuses the exact compliance-approved summary_he wording, not a new sentence', () => {
    const facts = buildBusinessFacts(true, pkg);
    const model = buildFaqPageModel(ITEMS, facts);
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    const protectedEntry = pricing.entries.find(
      (e) => e.question === 'אם אף אחד לא יענה, האם עדיין אני משלם?',
    )!;
    expect(protectedEntry.answer).toContain(facts.summary_he);
  });

  it('appends the optional DB supplement AFTER the mandatory sentence, never replacing it', () => {
    const itemsWithSupplement: FaqItemRow[] = ITEMS.map((row) =>
      row.item_key === PROTECTED_FAQ_ITEM_KEY ? { ...row, answer: 'הערה משלימה.' } : row,
    );
    const facts = buildBusinessFacts(true, pkg);
    const model = buildFaqPageModel(itemsWithSupplement, facts);
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    const protectedEntry = pricing.entries.find(
      (e) => e.question === 'אם אף אחד לא יענה, האם עדיין אני משלם?',
    )!;
    expect(protectedEntry.answer.startsWith(`כן. ${facts.summary_he}`)).toBe(true);
    expect(protectedEntry.answer.endsWith('הערה משלימה.')).toBe(true);
  });

  it('under the pure per-reached model (gate off), correctly flips to "לא" (nothing charged for 0 responders)', () => {
    const model = buildFaqPageModel(ITEMS, buildBusinessFacts(false, pkg));
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    const protectedEntry = pricing.entries.find(
      (e) => e.question === 'אם אף אחד לא יענה, האם עדיין אני משלם?',
    )!;
    expect(protectedEntry.answer.startsWith('לא.')).toBe(true);
  });
});

describe('buildFaqPageModel structure', () => {
  it('always includes the price card first, code-owned from summary_he', () => {
    const facts = buildBusinessFacts(true, pkg);
    const model = buildFaqPageModel(ITEMS, facts);
    expect(model.priceCard.question).toBe('כמה עולה השירות?');
    expect(model.priceCard.answer).toBe(facts.summary_he);
  });

  it('inserts the code-owned billing_unit question right after the protected row, before free rows', () => {
    const facts = buildBusinessFacts(true, pkg);
    const model = buildFaqPageModel(ITEMS, facts);
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    expect(pricing.entries.map((e) => e.question)).toEqual([
      'אם אף אחד לא יענה, האם עדיין אני משלם?',
      'מה ההבדל בין "אורח", "איש קשר" ו"נענה"?',
      'איך התשלום מתבצע בפועל?',
    ]);
  });

  it('substitutes {{channels_list}} inside a free-text DB row', () => {
    const withToken: FaqItemRow[] = [
      {
        item_key: null,
        category: 'about',
        question: 'איפה שולחים?',
        answer: 'שולחים ב־{{channels_list}}.',
        sort_order: 1,
      },
    ];
    const model = buildFaqPageModel(withToken, buildBusinessFacts(true, pkg));
    const about = model.sections.find((s) => s.category === 'about')!;
    expect(about.entries[0].answer).toBe('שולחים ב־וואטסאפ, שיחה טלפונית (AI).');
  });

  it('drops an empty category entirely instead of rendering an empty heading', () => {
    const noHowItWorks = ITEMS.filter((i) => i.category !== 'how_it_works');
    const model = buildFaqPageModel(noHowItWorks, buildBusinessFacts(true, pkg));
    expect(model.sections.some((s) => s.category === 'how_it_works')).toBe(false);
  });

  it('sorts rows within a category by sort_order, independent of input order', () => {
    const shuffled: FaqItemRow[] = [
      { item_key: null, category: 'about', question: 'שנייה', answer: 'ב', sort_order: 2 },
      { item_key: null, category: 'about', question: 'ראשונה', answer: 'א', sort_order: 1 },
    ];
    const model = buildFaqPageModel(shuffled, buildBusinessFacts(true, pkg));
    const about = model.sections.find((s) => s.category === 'about')!;
    expect(about.entries.map((e) => e.question)).toEqual(['ראשונה', 'שנייה']);
  });
});

describe('flattenFaqEntries', () => {
  it('starts with the price card, then every section in order, with no gaps', () => {
    const model = buildFaqPageModel(ITEMS, buildBusinessFacts(true, pkg));
    const flat = flattenFaqEntries(model);
    expect(flat[0].question).toBe('כמה עולה השירות?');
    // price card + 3 pricing entries + 1 about + 1 legal = 6
    expect(flat).toHaveLength(6);
    expect(flat.every((e) => e.question.trim() !== '' && e.answer.trim() !== '')).toBe(true);
  });
});
