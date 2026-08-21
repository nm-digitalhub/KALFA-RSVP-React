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
});
