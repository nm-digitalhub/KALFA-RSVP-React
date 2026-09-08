import { describe, expect, it } from 'vitest';

import {
  isAcceptablePhoneInput,
  isValidPhone,
  maskPhoneForDisplay,
  normalizePhone,
  repairIsraeliLocalPhone,
} from '@/lib/phone';

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

describe('maskPhoneForDisplay (signing page — audit §5)', () => {
  it('shows an Israeli mobile as 050***4567 — recognisable, not exposed', () => {
    expect(maskPhoneForDisplay('+972501234567')).toBe('050***4567');
    expect(maskPhoneForDisplay('050-123-4567')).toBe('050***4567');
  });

  it('keeps only the last 4 digits of a non-Israeli number', () => {
    expect(maskPhoneForDisplay('+14155552671')).toBe('+14***2671');
  });

  it('falls back to a dash for missing / invalid input', () => {
    expect(maskPhoneForDisplay(null)).toBe('—');
    expect(maskPhoneForDisplay('')).toBe('—');
    expect(maskPhoneForDisplay('123')).toBe('—');
  });
});

describe('isAcceptablePhoneInput (guest phone field — IL + international)', () => {
  it('accepts the Israeli forms the product has always accepted', () => {
    for (const v of [
      '0501234567',
      '050-123-4567',
      '050 123 4567',
      '+972501234567',
      '972501234567',
      '03-3301505',
      '0771234567',
    ]) {
      expect(isAcceptablePhoneInput(v)).toBe(true);
    }
  });

  it('accepts an international number written with a country code', () => {
    // The real case that motivated this: a French guest on an Israeli event.
    // `defaultCountry` is documented as IGNORED once the value starts with
    // "+", so the number is validated against FRANCE's numbering plan here.
    expect(isAcceptablePhoneInput('+33 7 56 98 23 70')).toBe(true);
    expect(isAcceptablePhoneInput('+33756982370')).toBe(true);
    expect(isAcceptablePhoneInput('0033756982370')).toBe(true);
    expect(isAcceptablePhoneInput('+1 415 555 2671')).toBe(true);
    expect(isAcceptablePhoneInput('+44 20 7946 0958')).toBe(true);
  });

  it('still rejects a typo inside an international number', () => {
    expect(isAcceptablePhoneInput('+3375698237')).toBe(false); // digit missing
    expect(isAcceptablePhoneInput('+337569823701')).toBe(false); // digit extra
    expect(isAcceptablePhoneInput('+99 756 982 370')).toBe(false); // no such country
    expect(isAcceptablePhoneInput('+33abc')).toBe(false);
    expect(isAcceptablePhoneInput('++33756982370')).toBe(false);
  });

  it('rejects a foreign number typed without its country code', () => {
    // Without a "+" the value is read as Israeli, and a French mobile is not a
    // valid Israeli number — so the owner is told to add the country code
    // instead of the number being silently stored as an Israeli one.
    expect(isAcceptablePhoneInput('33756982370')).toBe(false);
  });

  it('rejects empty and garbage input', () => {
    expect(isAcceptablePhoneInput('')).toBe(false);
    expect(isAcceptablePhoneInput('   ')).toBe(false);
    expect(isAcceptablePhoneInput(null)).toBe(false);
    expect(isAcceptablePhoneInput(undefined)).toBe(false);
    expect(isAcceptablePhoneInput('12')).toBe(false);
    expect(isAcceptablePhoneInput('abc')).toBe(false);
  });
});
