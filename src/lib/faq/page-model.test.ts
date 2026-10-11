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
  price: 200,
  contact_quota: 200,
  channels: ['whatsapp', 'call'],
  description: null,
  includes: [],
  outreach_schedule: [],
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

// The highest-value guarantee on this page: the answer to "do I still pay if
// nobody answers?" must never read as outcome-dependent. This is the FIRST test
// in the file on purpose.
describe('the protected pricing_no_response answer', () => {
  const protectedOf = (facts: ReturnType<typeof buildBusinessFacts>, items: FaqItemRow[] = ITEMS) =>
    buildFaqPageModel(items, facts)
      .sections.find((s) => s.category === 'pricing')!
      .entries.find((e) => e.question === 'אם אף אחד לא יענה, האם עדיין אני משלם?')!;

  it('answers "כן": the package price is paid once at purchase, whoever answers', () => {
    const answer = protectedOf(buildBusinessFacts([pkg])).answer;
    expect(answer.startsWith('כן.')).toBe(true);
    expect(answer).toContain('אינו תלוי במספר האורחים שהשיבו');
    expect(answer).not.toContain('משלמים רק');
  });

  it('reuses the one pricing_rule_he sentence the price card states, not a new one', () => {
    const facts = buildBusinessFacts([pkg]);
    expect(protectedOf(facts).answer).toBe(`כן. ${facts.pricing_rule_he}`);
    expect(facts.summary_he).toContain(facts.pricing_rule_he);
  });

  it('appends the optional DB supplement AFTER the mandatory sentence, never replacing it', () => {
    const itemsWithSupplement: FaqItemRow[] = ITEMS.map((row) =>
      row.item_key === PROTECTED_FAQ_ITEM_KEY ? { ...row, answer: 'הערה משלימה.' } : row,
    );
    const facts = buildBusinessFacts([pkg]);
    const answer = protectedOf(facts, itemsWithSupplement).answer;
    expect(answer.startsWith(`כן. ${facts.pricing_rule_he}`)).toBe(true);
    expect(answer.endsWith('הערה משלימה.')).toBe(true);
  });

  it('with no package on sale it says the pricing is unavailable instead of guessing', () => {
    expect(protectedOf(buildBusinessFacts([])).answer).toBe('פרטי התמחור המדויקים אינם זמינים כרגע. לבירור המחיר, צרו קשר.');
  });
});

describe('buildFaqPageModel structure', () => {
  it('always includes the price card first, code-owned from summary_he', () => {
    const facts = buildBusinessFacts([pkg]);
    const model = buildFaqPageModel(ITEMS, facts);
    expect(model.priceCard.question).toBe('כמה עולה השירות?');
    expect(model.priceCard.answer).toBe(facts.summary_he);
  });

  it('inserts the code-owned billing_unit question right after the protected row, before free rows', () => {
    const facts = buildBusinessFacts([pkg]);
    const model = buildFaqPageModel(ITEMS, facts);
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    expect(pricing.entries.map((e) => e.question)).toEqual([
      'אם אף אחד לא יענה, האם עדיין אני משלם?',
      'מה ההבדל בין "אורח", "איש קשר" ו"נענה"?',
      'איך התשלום מתבצע בפועל?',
    ]);
  });

  // Regression (owner report 2026-08-24): the public answer is buildBusinessFacts().
  // billing_unit_he verbatim — a sentence addressed to the drafter bot must
  // never reach the customer-facing page (or the FAQPage JSON-LD).
  it('the public billing_unit answer carries no bot-facing instruction', () => {
    const facts = buildBusinessFacts([pkg]);
    const model = buildFaqPageModel(ITEMS, facts);
    const pricing = model.sections.find((s) => s.category === 'pricing')!;
    const answer = pricing.entries[1].answer;
    expect(answer).toContain('מכסת החבילה נספרת באנשי קשר ולא באורחים');
    expect(answer).not.toContain('כשלקוח נוקב');
    expect(answer).not.toContain('הצג לו');
    expect(answer).not.toContain(facts.billing_unit_drafter_note_he!);
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
    const model = buildFaqPageModel(withToken, buildBusinessFacts([pkg]));
    const about = model.sections.find((s) => s.category === 'about')!;
    expect(about.entries[0].answer).toBe('שולחים ב־וואטסאפ, שיחה טלפונית (AI).');
  });

  it('drops an empty category entirely instead of rendering an empty heading', () => {
    const noHowItWorks = ITEMS.filter((i) => i.category !== 'how_it_works');
    const model = buildFaqPageModel(noHowItWorks, buildBusinessFacts([pkg]));
    expect(model.sections.some((s) => s.category === 'how_it_works')).toBe(false);
  });

  it('sorts rows within a category by sort_order, independent of input order', () => {
    const shuffled: FaqItemRow[] = [
      { item_key: null, category: 'about', question: 'שנייה', answer: 'ב', sort_order: 2 },
      { item_key: null, category: 'about', question: 'ראשונה', answer: 'א', sort_order: 1 },
    ];
    const model = buildFaqPageModel(shuffled, buildBusinessFacts([pkg]));
    const about = model.sections.find((s) => s.category === 'about')!;
    expect(about.entries.map((e) => e.question)).toEqual(['ראשונה', 'שנייה']);
  });
});

describe('flattenFaqEntries', () => {
  it('starts with the price card, then every section in order, with no gaps', () => {
    const model = buildFaqPageModel(ITEMS, buildBusinessFacts([pkg]));
    const flat = flattenFaqEntries(model);
    expect(flat[0].question).toBe('כמה עולה השירות?');
    // price card + 3 pricing entries + 1 about + 1 legal = 6
    expect(flat).toHaveLength(6);
    expect(flat.every((e) => e.question.trim() !== '' && e.answer.trim() !== '')).toBe(true);
  });
});
