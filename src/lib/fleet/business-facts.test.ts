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
