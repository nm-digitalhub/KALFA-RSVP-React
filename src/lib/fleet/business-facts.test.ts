import { describe, expect, it } from 'vitest';

import { buildBusinessFacts, type PackageFacts } from './business-facts';

const SCHEDULE = [
  { days_before: 10, channel: 'whatsapp' },
  { days_before: 2, channel: 'call' },
];

const pkg = (over: Partial<PackageFacts> = {}): PackageFacts => ({
  name: 'אישורי הגעה — וואטסאפ + שיחות AI',
  price: 200,
  contact_quota: 200,
  channels: ['whatsapp', 'call'],
  description: null,
  includes: [],
  outreach_schedule: SCHEDULE,
  ...over,
});

describe('buildBusinessFacts', () => {
  it('reports unavailable when no package is on sale', () => {
    const f = buildBusinessFacts([]);
    expect(f.available).toBe(false);
    expect(f.reason).toBeTruthy();
    expect(f.summary_he).toBeUndefined();
    expect(f.billing_unit_he).toBeUndefined();
  });

  it('quotes every package on sale, in order, with its own price and quota — nothing typed into the code', () => {
    const f = buildBusinessFacts([pkg(), pkg({ name: 'חבילה קטנה', price: 99.5, contact_quota: 1 })]);
    expect(f.available).toBe(true);
    expect(f.packages?.map((p) => p.name)).toEqual(['אישורי הגעה — וואטסאפ + שיחות AI', 'חבילה קטנה']);
    expect(f.packages_list_he).toBe(
      'אישורי הגעה — וואטסאפ + שיחות AI — ₪200, עד 200 אנשי קשר. חבילה קטנה — ₪99.5, עד איש קשר אחד.',
    );
    expect(f.summary_he?.startsWith(f.packages_list_he ?? '')).toBe(true);
  });

  it('a price change in the package changes what is quoted', () => {
    expect(buildBusinessFacts([pkg({ price: 350 })]).summary_he).toContain('₪350');
    expect(buildBusinessFacts([pkg({ price: 350 })]).summary_he).not.toContain('₪200');
  });

  it('states the one-payment rule and the VAT status, and nothing of the pay-per-result model', () => {
    const f = buildBusinessFacts([pkg()]);
    expect(f.pricing_rule_he).toContain('משולם פעם אחת ברכישה');
    expect(f.pricing_rule_he).toContain('אינו תלוי במספר האורחים שהשיבו');
    expect(f.pricing_rule_he).toContain('ללא מע״מ (עוסק פטור)');
    for (const retired of ['דמי הפעלה', 'לכל איש קשר שהושג', 'תקרה', 'משלמים רק']) {
      expect(f.summary_he).not.toContain(retired);
    }
  });

  it('names the channels every package on sale uses, so the sentence is true whatever is bought', () => {
    expect(buildBusinessFacts([pkg()]).channels).toEqual(['whatsapp', 'call']);
    expect(buildBusinessFacts([pkg(), pkg({ channels: ['whatsapp'] })]).channels).toEqual(['whatsapp']);
  });

  it('passes the cadence through only when every package on sale runs the same one', () => {
    expect(buildBusinessFacts([pkg(), pkg()]).outreach_schedule).toEqual(SCHEDULE);
    expect(
      buildBusinessFacts([pkg(), pkg({ outreach_schedule: [{ days_before: 5, channel: 'whatsapp' }] })]).outreach_schedule,
    ).toEqual([]);
  });
});

describe('billing_unit_he', () => {
  // Regression for a real drafting error: a "150 אורחים" question was answered
  // as though 150 were contacts. The facts payload said nothing about the units,
  // so the drafter had nothing to go on.
  it('names all three units so they cannot be read as one', () => {
    const unit = buildBusinessFacts([pkg()]).billing_unit_he ?? '';
    expect(unit).toContain('אורח');
    expect(unit).toContain('איש קשר');
    expect(unit).toContain('נענה');
  });

  it('says the quota counts contacts, not guests, and that answers do not change the price', () => {
    const unit = buildBusinessFacts([pkg()]).billing_unit_he ?? '';
    expect(unit).toContain('מכסת החבילה נספרת באנשי קשר ולא באורחים');
    expect(unit).toContain('מספר הנענים אינו משנה את המחיר');
  });

  // Regression: the drafter instruction ("כשלקוח נוקב…") used to be the last
  // sentence of billing_unit_he, and billing_unit_he is rendered verbatim on
  // the public /faq page — so a bot-facing instruction leaked to customers
  // (owner report 2026-08-24). The instruction lives in its own field now.
  it('keeps the drafter instruction OUT of the customer-facing text and IN its own field', () => {
    const facts = buildBusinessFacts([pkg()]);
    expect(facts.billing_unit_he).not.toContain('כשלקוח נוקב');
    expect(facts.billing_unit_he).not.toContain('הצג לו');
    expect(facts.billing_unit_he?.trim().endsWith('.')).toBe(true);
    expect(facts.billing_unit_drafter_note_he).toContain('כשלקוח נוקב במספר אורחים');
  });
});
