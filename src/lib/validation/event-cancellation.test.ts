import { describe, expect, it } from 'vitest';
import { createCancellationRequestSchema, resolveCancellationRequestSchema } from './event-cancellation';

describe('createCancellationRequestSchema', () => {
  it('accepts a valid reason with smsConsent', () => {
    const r = createCancellationRequestSchema.safeParse({ reason: 'שינוי תוכניות', smsConsent: true });
    expect(r.success).toBe(true);
  });
  it('rejects a too-short reason', () => {
    const r = createCancellationRequestSchema.safeParse({ reason: 'קצר', smsConsent: false });
    expect(r.success).toBe(false);
  });
  it('defaults smsConsent to false when omitted', () => {
    const r = createCancellationRequestSchema.parse({ reason: 'שינוי תוכניות משפחתיות' });
    expect(r.smsConsent).toBe(false);
  });
});

describe('resolveCancellationRequestSchema', () => {
  it('accepts declined with just a note', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'declined',
      resolutionNote: 'האירוע כבר בעיצומו, לא ניתן לבטל',
    });
    expect(r.success).toBe(true);
  });
  it('requires resolutionAmount for partial_charge', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'partial_charge',
      resolutionNote: 'חויב חלקית',
    });
    expect(r.success).toBe(false);
  });
  it('accepts partial_charge with a positive amount', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'partial_charge',
      resolutionAmount: 50,
      resolutionNote: 'חויב חלקית עבור הודעות שכבר נשלחו',
    });
    expect(r.success).toBe(true);
  });
  it('rejects a zero or negative resolutionAmount', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'partial_charge',
      resolutionAmount: 0,
      resolutionNote: 'חויב חלקית',
    });
    expect(r.success).toBe(false);
  });
  it('rejects resolutionAmount present on full_cancellation', () => {
    const r = resolveCancellationRequestSchema.safeParse({
      resolution: 'full_cancellation',
      resolutionAmount: 50,
      resolutionNote: 'בוטל במלואו',
    });
    expect(r.success).toBe(false);
  });

  // The fee may be chosen as a PERCENTAGE: the server turns it into an amount from a base it determines itself.
  describe('resolutionPercent', () => {
    const note = 'חויב חלקית עבור שירות שניתן';
    it('accepts partial_charge with a percentage instead of an amount', () => {
      const r = resolveCancellationRequestSchema.safeParse({ resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: note });
      expect(r.success).toBe(true);
    });
    it('accepts a fractional percentage and exactly 100', () => {
      expect(resolveCancellationRequestSchema.safeParse({ resolution: 'partial_charge', resolutionPercent: 2.5, resolutionNote: note }).success).toBe(true);
      expect(resolveCancellationRequestSchema.safeParse({ resolution: 'partial_charge', resolutionPercent: 100, resolutionNote: note }).success).toBe(true);
    });
    it.each([0, -5, 100.01, 250])('rejects a percentage of %s', (resolutionPercent) => {
      const r = resolveCancellationRequestSchema.safeParse({ resolution: 'partial_charge', resolutionPercent, resolutionNote: note });
      expect(r.success).toBe(false);
    });
    it('rejects an amount AND a percentage together — one decides, never both', () => {
      const r = resolveCancellationRequestSchema.safeParse({ resolution: 'partial_charge', resolutionAmount: 50, resolutionPercent: 5, resolutionNote: note });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'resolutionPercent')).toBe(true);
    });
    it('still requires one of the two for partial_charge, with the error on the amount field', () => {
      const r = resolveCancellationRequestSchema.safeParse({ resolution: 'partial_charge', resolutionNote: note });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'resolutionAmount')).toBe(true);
    });
    it.each(['full_cancellation', 'declined'] as const)('rejects a percentage on %s', (resolution) => {
      const r = resolveCancellationRequestSchema.safeParse({ resolution, resolutionPercent: 5, resolutionNote: note });
      expect(r.success).toBe(false);
    });
  });
});
