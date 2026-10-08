import { describe, expect, it } from 'vitest';

import {
  OPEN_FIELDS_CAPTCHA_FIELD,
  OPEN_FIELDS_FRAME_ID,
  OPEN_FIELDS_FRAME_SRC,
  OPEN_FIELDS_ORIGIN,
  buildDoTransactionMessage,
  buildInitMessage,
  parseFrameMessage,
  validateCardholder,
  isValidIsraeliId,
  normalizeIsraeliPhone,
} from './open-fields';

// The protocol between our payment page and CardCom's Open Fields iframes (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 1ב). Everything here is pure: what we SEND, what we ACCEPT, and what we refuse. The two rules that matter most:
//   - we post only to CardCom's origin, never '*', and accept messages only FROM it;
//   - nothing the iframe says decides a payment (the server asks CardCom): a message is at most a reason to ask.

const NOW = new Date('2026-10-07T12:00:00Z');
// Synthetic checksum-valid fixture; not proof of an issued identity.
const valid = { ownerId: '123456782', name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567', address: 'הרצל 10', city: 'תל אביב', month: '08', year: '27' };

describe('the four frames CardCom\'s documentation says must exist', () => {
  it('have exactly the ids CardCom lists (its article and Readme), the captcha one included', () => {
    expect(Object.values(OPEN_FIELDS_FRAME_ID).sort()).toEqual(['CardComCaptchaIframe', 'CardComCardNumber', 'CardComCvv', 'CardComMasterFrame']);
  });

  it('are all served from CardCom\'s own origin over https', () => {
    for (const src of Object.values(OPEN_FIELDS_FRAME_SRC)) expect(src.startsWith(`${OPEN_FIELDS_ORIGIN}/api/openfields/`)).toBe(true);
    expect(OPEN_FIELDS_FRAME_SRC.captcha).toBe('https://secure.cardcom.solutions/api/openfields/reCaptcha');
  });
});

describe('buildInitMessage', () => {
  it('carries the LowProfile code, our CSS and our placeholders, in the property names the module expects', () => {
    expect(buildInitMessage({ lowProfileCode: 'lp-1' })).toMatchObject({
      action: 'init',
      lowProfileCode: 'lp-1',
      language: 'he',
      placeholder: expect.any(String),
      cvvPlaceholder: expect.any(String),
      cardFieldCSS: expect.stringContaining('input'),
      cvvFieldCSS: expect.stringContaining('input'),
      reCaptchaFieldCSS: expect.any(String),
    });
  });

  it('refuses an empty LowProfile code: a form with no session cannot pay', () => {
    expect(() => buildInitMessage({ lowProfileCode: '' })).toThrow();
  });
});

describe('validateCardholder', () => {
  it('accepts a complete, current cardholder and trims the text', () => {
    expect(validateCardholder({ ...valid, name: '  דנה כהן ' }, NOW)).toEqual({ ok: true, value: { ownerId: '123456782', name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567', address: 'הרצל 10', city: 'תל אביב', month: '08', year: '27' } });
  });

  it.each([
    ['a blank name', { name: ' ' }, 'name'],
    ['a name that is far too long', { name: 'x'.repeat(80) }, 'name'],
    ['an e-mail with no @', { email: 'dana.example.com' }, 'email'],
    ['a blank e-mail', { email: '' }, 'email'],
    ['no phone', { phone: '' }, 'phone'],
    ['a phone that is not an Israeli number', { phone: '12345' }, 'phone'],
    ['a phone with letters', { phone: '050-abc4567' }, 'phone'],
    ['no address', { address: '  ' }, 'address'],
    ['an address longer than CardCom allows', { address: 'x'.repeat(51) }, 'address'],
    ['no city', { city: '' }, 'city'],
    ['a city longer than CardCom allows', { city: 'x'.repeat(51) }, 'city'],
    ['month 00', { month: '00' }, 'month'],
    ['month 13', { month: '13' }, 'month'],
    ['a one-digit month', { month: '8' }, 'month'],
    ['a four-digit year', { year: '2027' }, 'year'],
    ['a non-numeric year', { year: 'ab' }, 'year'],
    ['a card that expired last month', { month: '09', year: '26' }, 'expiry'],
    ['a card that expired years ago', { month: '12', year: '24' }, 'expiry'],
  ])('refuses %s', (_label, over, field) => {
    expect(validateCardholder({ ...valid, ...over }, NOW)).toEqual({ ok: false, field });
  });

  it('accepts a card that expires this month (it is valid through the end of it)', () => {
    expect(validateCardholder({ ...valid, month: '10', year: '26' }, NOW)).toMatchObject({ ok: true });
  });
});

describe('buildDoTransactionMessage', () => {
  it('asks the master frame to charge, once, with what the buyer typed — the details CardCom\'s documentation says must accompany it', () => {
    expect(buildDoTransactionMessage({ ...valid })).toEqual({
      action: 'doTransaction',
      cardOwnerId: '123456782',
      cardOwnerName: 'דנה כהן',
      cardOwnerEmail: 'dana@example.com',
      cardOwnerPhone: '0501234567',
      expirationMonth: '08',
      expirationYear: '27',
      numberOfPayments: '1',
      document: { Name: 'דנה כהן', Email: 'dana@example.com', AddressLine1: 'הרצל 10', City: 'תל אביב', Mobile: '0501234567', Phone: '0501234567', Language: 'he' },
    });
  });

  it('sends the phone in its plain local form, in BOTH Mobile and Phone, because CardCom\'s own sources disagree about which is which', () => {
    const message = buildDoTransactionMessage({ ...valid, phone: '+972 50-123-4567' });
    expect(message.cardOwnerPhone).toBe('0501234567');
    expect(message.document).toMatchObject({ Mobile: '0501234567', Phone: '0501234567' });
  });

  it('carries only WHO the customer is in the document: never a price, a product or a document type — those were fixed on the server', () => {
    const message = JSON.stringify(buildDoTransactionMessage({ ...valid }));
    expect(message).not.toMatch(/amount|price|product|UnitCost|DocumentType/i);
  });

  it.each([
    ['no phone', { phone: '' }],
    ['a phone that is not a number', { phone: 'abc' }],
    ['no address', { address: ' ' }],
    ['no city', { city: '' }],
  ])('refuses %s: a placeholder is never sent in its place', (_label, over) => {
    expect(() => buildDoTransactionMessage({ ...valid, ...over })).toThrow();
  });
});

describe('normalizeIsraeliPhone', () => {
  it.each([
    ['0501234567', '0501234567'],
    ['050-123-4567', '0501234567'],
    ['050 123 4567', '0501234567'],
    ['+972501234567', '0501234567'],
    ['972501234567', '0501234567'],
    ['03-5551234', '035551234'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIsraeliPhone(input)).toBe(expected);
  });

  it.each(['', '123', '05012345678901', '+1 202 555 0100', 'phone', '1501234567'])('rejects %j', (input) => {
    expect(normalizeIsraeliPhone(input)).toBeNull();
  });
});

describe('parseFrameMessage', () => {
  const from = (data: unknown, origin = OPEN_FIELDS_ORIGIN) => parseFrameMessage({ origin, data });

  it('reads a submit result, success and not', () => {
    expect(from({ action: 'HandleSubmit', data: { IsSuccess: true, Description: 'x' } })).toEqual({ kind: 'submit', success: true });
    expect(from({ action: 'HandleSubmit', data: { IsSuccess: false } })).toEqual({ kind: 'submit', success: false });
    expect(from({ action: 'HandleSubmit' })).toEqual({ kind: 'submit', success: false });
  });

  it('reads an error, spelled the way CardCom spells it and the way it should be', () => {
    expect(from({ action: 'HandleEror', message: 'secret detail' })).toEqual({ kind: 'error' });
    expect(from({ action: 'HandleError' })).toEqual({ kind: 'error' });
  });

  it('never passes on CardCom\'s own text: the page shows only its own, generic sentences', () => {
    expect(JSON.stringify(from({ action: 'HandleEror', message: 'secret detail' }))).not.toContain('secret');
    expect(JSON.stringify(from({ action: 'HandleSubmit', data: { IsSuccess: false, Description: 'secret detail' } }))).not.toContain('secret');
  });

  it('reads a field validation', () => {
    expect(from({ action: 'handleValidations', field: 'cvv', isValid: false })).toEqual({ kind: 'validation', field: 'cvv', valid: false });
    expect(from({ action: 'handleValidations', field: 'cardNumber', isValid: true })).toEqual({ kind: 'validation', field: 'cardNumber', valid: true });
  });

  it('reads the captcha being solved under the field name the master frame reports it by', () => {
    expect(from({ action: 'handleValidations', lowProfileCode: 'lp-1', field: OPEN_FIELDS_CAPTCHA_FIELD, isValid: true })).toEqual({ kind: 'validation', field: 'reCaptcha', valid: true });
  });

  it('ignores a message from any other origin, even one that looks right', () => {
    expect(from({ action: 'HandleSubmit', data: { IsSuccess: true } }, 'https://evil.example')).toBeNull();
    expect(from({ action: 'HandleSubmit', data: { IsSuccess: true } }, 'http://secure.cardcom.solutions')).toBeNull();
    expect(from({ action: 'HandleSubmit', data: { IsSuccess: true } }, 'https://secure.cardcom.solutions.evil.example')).toBeNull();
  });

  it('ignores 3DS traffic (no action), unknown actions, and anything that is not an object', () => {
    expect(from({ some: '3ds' })).toBeNull();
    expect(from({ action: 'somethingNew' })).toBeNull();
    expect(from({ action: 42 })).toBeNull();
    expect(from('HandleSubmit')).toBeNull();
    expect(from(null)).toBeNull();
    expect(from(undefined)).toBeNull();
  });
});


describe('mandatory owner ID', () => {
  it.each(['', ' ', '000000000', '123456789', '12345678', '1234567820', '12345678x'])
    ('rejects invalid ID %j before building a payment message', (ownerId) => {
      expect(validateCardholder({ ...valid, ownerId }, NOW))
        .toEqual({ ok: false, field: 'ownerId' });
      expect(() => buildDoTransactionMessage({ ...valid, ownerId }))
        .toThrow('Invalid cardholder ID');
    });

  it('preserves leading zeros and trims surrounding whitespace', () => {
    const input = { ...valid, ownerId: ' 000000018 ' };
    expect(isValidIsraeliId('000000018')).toBe(true);
    expect(validateCardholder(input, NOW))
      .toMatchObject({ ok: true, value: { ownerId: '000000018' } });
    expect(buildDoTransactionMessage(input).cardOwnerId).toBe('000000018');
  });
});
