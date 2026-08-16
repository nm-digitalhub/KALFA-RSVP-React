import { describe, expect, it } from 'vitest';

import { buildFaqJsonLd, faqJsonLdScript } from './json-ld';
import { buildFaqPageModel, flattenFaqEntries, type FaqItemRow } from './page-model';
import { buildBusinessFacts, type PackageFacts } from '@/lib/fleet/business-facts';

const pkg: PackageFacts = {
  name: 'אישורי הגעה',
  price_per_reached: 4,
  base_price: 200,
  included_reached: 200,
  channels: ['whatsapp', 'call'],
};

describe('buildFaqJsonLd', () => {
  it('mirrors the exact entries the page renders (same source, no second copy)', () => {
    const items: FaqItemRow[] = [
      { item_key: null, category: 'about', question: 'מה זה KALFA?', answer: 'תשובה.', sort_order: 1 },
    ];
    const model = buildFaqPageModel(items, buildBusinessFacts(true, pkg));
    const flat = flattenFaqEntries(model);
    const jsonLd = buildFaqJsonLd(flat);

    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity).toHaveLength(flat.length);
    expect(jsonLd.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: flat[0].question,
      acceptedAnswer: { '@type': 'Answer', text: flat[0].answer },
    });
    // The price card (first flattened entry) must be present in the structured
    // data too — it's the answer to the highest-value question for AI search.
    expect(jsonLd.mainEntity.some((q) => q.name === 'כמה עולה השירות?')).toBe(true);
  });

  it('drops any entry with a blank question or answer (defensive; never advertise a blank Q&A)', () => {
    const jsonLd = buildFaqJsonLd([
      { question: '', answer: 'x' },
      { question: 'x', answer: '' },
      { question: 'שאלה', answer: 'תשובה' },
    ]);
    expect(jsonLd.mainEntity).toHaveLength(1);
    expect(jsonLd.mainEntity[0].name).toBe('שאלה');
  });
});

describe('faqJsonLdScript', () => {
  it('escapes "<" so admin-editable content can never close the script tag early', () => {
    const jsonLd = buildFaqJsonLd([{ question: 'שאלה', answer: '</script><script>alert(1)</script>' }]);
    const script = faqJsonLdScript(jsonLd);
    expect(script).not.toContain('</script>');
    expect(script).toContain('\\u003c/script>');
  });
});
