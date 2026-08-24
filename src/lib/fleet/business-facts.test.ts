import { describe, expect, it } from 'vitest';

import { buildBusinessFacts, type PackageFacts } from './business-facts';

const pkg: PackageFacts = {
  name: 'אישורי הגעה — וואטסאפ + שיחות AI',
  price_per_reached: 4,
  base_price: 200,
  included_reached: 200,
  channels: ['whatsapp', 'call'],
};

describe('buildBusinessFacts', () => {
  it('reports unavailable when there is no active campaign package', () => {
    const f = buildBusinessFacts(true, null);
    expect(f.available).toBe(false);
    expect(f.reason).toBeTruthy();
  });

  it('gate OFF → per-reached model, base zeroed out (never quote an un-billed base)', () => {
    const f = buildBusinessFacts(false, pkg);
    expect(f.available).toBe(true);
    expect(f.model).toBe('per_reached');
    expect(f.per_reached_price).toBe(4);
    expect(f.base_price).toBe(0);
    expect(f.included_reached).toBe(0);
    expect(f.summary_he).toContain('₪4');
    expect(f.summary_he).not.toContain('דמי בסיס');
  });

  it('gate ON + base set → base+overage model with the real numbers', () => {
    const f = buildBusinessFacts(true, pkg);
    expect(f.model).toBe('base_overage');
    expect(f.base_price).toBe(200);
    expect(f.included_reached).toBe(200);
    expect(f.per_reached_price).toBe(4);
    expect(f.summary_he).toContain('₪200');
    expect(f.summary_he).toContain('₪4');
    // §2-safe framing: the base must be disclosed as UNCONDITIONAL (charged even
    // if no one responded), and must NOT carry the outcome-only "pay only for
    // responders" claim that (correctly) belongs to the per-reached model / overage.
    expect(f.summary_he).toContain('אינם מותנים בתוצאה');
    expect(f.summary_he).toContain('גם אם לא נענה אף איש קשר');
    expect(f.summary_he).not.toContain('משלמים רק');
  });

  it('gate ON but package has no base → still per-reached', () => {
    const f = buildBusinessFacts(true, { ...pkg, base_price: 0, included_reached: 0 });
    expect(f.model).toBe('per_reached');
    expect(f.base_price).toBe(0);
  });

  it('passes through channels + package name', () => {
    const f = buildBusinessFacts(false, pkg);
    expect(f.channels).toEqual(['whatsapp', 'call']);
    expect(f.package_name).toBe('אישורי הגעה — וואטסאפ + שיחות AI');
  });
});

describe('billing_unit_he', () => {
  // Regression for a real drafting error: a "150 אורחים" question was answered
  // as though 150 were contacts, and contacts were reached. The facts payload
  // said nothing about the units, so the drafter had nothing to go on.
  const pkg: PackageFacts = {
    name: 'אישורי הגעה',
    price_per_reached: 4,
    base_price: 200,
    included_reached: 200,
    channels: ['whatsapp'],
  };

  it.each([true, false])('is present whenever a price is quoted (gate=%s)', (gateOn) => {
    const facts = buildBusinessFacts(gateOn, pkg);
    expect(facts.billing_unit_he).toBeTruthy();
  });

  it('names all three units so they cannot be read as one', () => {
    const unit = buildBusinessFacts(true, pkg).billing_unit_he ?? '';
    expect(unit).toContain('אורח');
    expect(unit).toContain('איש קשר');
    expect(unit).toContain('נענה');
  });

  it('tells the drafter not to derive a price from a guest count', () => {
    const unit = buildBusinessFacts(true, pkg).billing_unit_he ?? '';
    expect(unit).toContain('אי אפשר לגזור מחיר ממספר אורחים');
  });

  it('is absent when there is no package to price', () => {
    expect(buildBusinessFacts(true, null).billing_unit_he).toBeUndefined();
    expect(buildBusinessFacts(true, null).billing_unit_drafter_note_he).toBeUndefined();
  });

  // Regression: the drafter instruction ("כשלקוח נוקב…") used to be the last
  // sentence of billing_unit_he, and billing_unit_he is rendered verbatim on
  // the public /faq page — so a bot-facing instruction leaked to customers
  // (owner report 2026-08-24). The instruction lives in its own field now.
  it('keeps the drafter instruction OUT of the customer-facing text and IN its own field', () => {
    const facts = buildBusinessFacts(true, pkg);
    expect(facts.billing_unit_he).not.toContain('כשלקוח נוקב');
    expect(facts.billing_unit_he).not.toContain('הצג לו');
    expect(facts.billing_unit_he?.trim().endsWith('.')).toBe(true);
    expect(facts.billing_unit_drafter_note_he).toContain('כשלקוח נוקב במספר אורחים');
  });
});
