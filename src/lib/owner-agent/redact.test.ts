import { describe, expect, it } from 'vitest';

import { REDACTED_PHONE, redactPhoneNumbers } from './redact';

// Invisible characters are built from code points, never typed: a literal LRM
// or NBSP in a test file is unreadable in review.
const LRM = String.fromCodePoint(0x200e);
const RLM = String.fromCodePoint(0x200f);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const NBSP = String.fromCodePoint(0x00a0);
const EN_DASH = String.fromCodePoint(0x2013);
// Arabic-Indic digits for 0501234567.
const ARABIC_INDIC = [0, 5, 0, 1, 2, 3, 4, 5, 6, 7].map((d) => String.fromCodePoint(0x0660 + d)).join('');

const masked = (s: string) => redactPhoneNumbers(s) === REDACTED_PHONE;

describe('masks phone-shaped digit runs', () => {
  it.each([
    // Israeli mobile, local form
    '0501234567',
    '050-1234567',
    '050-123-4567',
    '050 123 4567',
    '(050) 123-4567',
    '050.123.4567',
    // Israeli landline, local form
    '02-6234567',
    '03-123-4567',
    '077-1234567',
    // Israeli, international
    '+972501234567',
    '+972-50-123-4567',
    '+972 50 123 4567',
    '+972 (0)50 123 4567',
    '972501234567',
    '97235551234',
    // E.164, other countries
    '+14155552671',
    '+1 415 555 2671',
    '+1 (415) 555-2671',
    '+44 20 7946 0958',
    '+33 1 42 68 53 00',
    '+5084123456',
    '+508 41 23 45',
    '14155552671',
    // Obfuscated by separators a renderer adds or a writer uses
    `050${NBSP}123${NBSP}4567`,
    `050${EN_DASH}1234567`,
    `050${LRM}-${RLM}1234567`,
    ARABIC_INDIC,
    // A Meta phone_number_id is sixteen digits: masked too
    '1234567890123456',
  ])('%j', (phone) => {
    expect(masked(phone)).toBe(true);
  });

  it('inside Hebrew text, keeping the words around it', () => {
    expect(redactPhoneNumbers('התקשר ל-050-1234567 מחר')).toBe(`התקשר ל-${REDACTED_PHONE} מחר`);
    expect(redactPhoneNumbers('מספר:+972501234567.')).toBe(`מספר:${REDACTED_PHONE}.`);
    expect(redactPhoneNumbers(`טלפון ${LRI}+972 52 765 4321${PDI} בבקשה`)).toBe(
      `טלפון ${LRI}${REDACTED_PHONE}${PDI} בבקשה`,
    );
  });

  it('a Hebrew prefix glued to the number does not shield it', () => {
    expect(redactPhoneNumbers('התקשר ל0501234567 או ב+972501234567')).toBe(
      `התקשר ל${REDACTED_PHONE} או ב${REDACTED_PHONE}`,
    );
    expect(redactPhoneNumbers('tel0501234567')).toBe(`tel${REDACTED_PHONE}`);
  });

  it('every number in a sentence, not just the first', () => {
    const out = redactPhoneNumbers('050-1111111, 052-2222222 ו-+14155552671');
    expect(out).toBe(`${REDACTED_PHONE}, ${REDACTED_PHONE} ו-${REDACTED_PHONE}`);
  });

  it('a full stop does not glue the next sentence\'s number onto it', () => {
    expect(redactPhoneNumbers('מספר פנימי: 97235551234. 12 אירועים.')).toBe(
      `מספר פנימי: ${REDACTED_PHONE}. 12 אירועים.`,
    );
  });

  it('a phone number right before a colon is still masked', () => {
    expect(redactPhoneNumbers('050-1234567: לא עונה')).toBe(`${REDACTED_PHONE}: לא עונה`);
    expect(redactPhoneNumbers('050 123 45 67: לא עונה')).toBe(`${REDACTED_PHONE}: לא עונה`);
  });
});

describe('leaves ordinary numbers alone', () => {
  it.each([
    'יש 12 אירועים פעילים ו-340 אורחים.',
    'שיעור מענה 0.61, כלומר 61%.',
    'סה"כ 1,234,567 ₪',
    '₪12,500.50',
    'נוצרו 3 קמפיינים ב-7 הימים האחרונים',
    'ב-24.09.2026',
    '2026-09-24',
    'ב-24.09.2026 10:30 נשלחו 5 הודעות',
    'ב-2026-09-24 09:15',
    'בשעה 10:30',
    '1234567',
    '12345678',
    '+123456',
    'session 3f2b8c1e-5d4a-4b6f-9e21-7a8c9d0e1f23',
    'wamid.HBgMOTcyNTAxMjM0NTY3FQIAEhgUM0E',
    'code131026',
  ])('%j', (text) => {
    expect(redactPhoneNumbers(text)).toBe(text);
  });

  it('the empty string', () => {
    expect(redactPhoneNumbers('')).toBe('');
  });
});
