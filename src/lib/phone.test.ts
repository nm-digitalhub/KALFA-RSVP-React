import { describe, expect, it } from 'vitest';

import { normalizePhone, isValidPhone, repairIsraeliLocalPhone } from '@/lib/phone';

describe('normalizePhone', () => {
  it('normalizes an Israeli local mobile to E.164', () => {
    expect(normalizePhone('050-123-4567')).toBe('+972501234567');
    expect(normalizePhone('0501234567')).toBe('+972501234567');
  });

  it('keeps an already-E.164 Israeli number', () => {
    expect(normalizePhone('+972501234567')).toBe('+972501234567');
  });

  it('treats the same number written differently as the SAME dedup key', () => {
    const a = normalizePhone('050-123-4567');
    const b = normalizePhone('+972 50 123 4567');
    expect(a).toBe(b);
  });

  it('returns null for empty / missing input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for an invalid / too-short number', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('not a phone')).toBeNull();
  });
});

describe('isValidPhone', () => {
  it('is true for a valid number and false otherwise', () => {
    expect(isValidPhone('0501234567')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone(null)).toBe(false);
  });
});

describe('repairIsraeliLocalPhone', () => {
  it('restores the leading 0 Excel strips from a mobile number', () => {
    expect(repairIsraeliLocalPhone('501234567')).toBe('0501234567');
  });

  it('converts a 972-prefixed export to the local 0-form', () => {
    expect(repairIsraeliLocalPhone('972501234567')).toBe('0501234567');
    expect(repairIsraeliLocalPhone('+972-50-123-4567')).toBe('0501234567');
  });

  it('repairs a zero-less geographic (landline) number', () => {
    expect(repairIsraeliLocalPhone('31234567')).toBe('031234567');
  });

  it('returns null for garbage and for non-Israeli numbers', () => {
    expect(repairIsraeliLocalPhone('5.01E+08')).toBe(null);
    expect(repairIsraeliLocalPhone('abc')).toBe(null);
    expect(repairIsraeliLocalPhone('+14155552671')).toBe(null);
  });
});
