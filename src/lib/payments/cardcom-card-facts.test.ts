import { describe, expect, it } from 'vitest';

import { cardFactsFromCardcom, documentUrlFromCardcom, holderIdFromCardcom, occurredAtFromCardcom } from './cardcom-card-facts';

// What the ledger keeps from CardCom's answer about the card: display facts only, each checked on its own, so that a
// value the ledger would refuse never gets in the way of recording a payment CardCom confirmed.

// The shape measured on the first real run (terminal 1000, 7.10.2026).
const MEASURED = { Last4CardDigitsString: '0008', CardMonth: 12, CardYear: 30, Brand: 'Visa', Issuer: 'CAL' };

describe('cardFactsFromCardcom', () => {
  it('reads the last four digits (zeros kept), the expiry, the brand and the issuer', () => {
    expect(cardFactsFromCardcom(MEASURED)).toEqual({ last4: '0008', expMonth: 12, expYear: 2030, brand: 'Visa', issuer: 'CAL', tokenRef: null, citizenSecretId: null });
  });

  it('accepts the expiry year in four digits as well as two', () => {
    expect(cardFactsFromCardcom({ ...MEASURED, CardYear: 2031 })?.expYear).toBe(2031);
  });

  it('keeps the card token CardCom returns (owner: nothing dropped) and the Vault id of the holder ID it is given', () => {
    expect(cardFactsFromCardcom({ ...MEASURED, Token: 'tok-1' }, 'secret-1')).toMatchObject({ tokenRef: 'tok-1', citizenSecretId: 'secret-1' });
  });

  it('is not misled by what it does not map: the first digits and the card product name belong to other columns', () => {
    const facts = cardFactsFromCardcom({ ...MEASURED, FirstCardDigits: 458028, CardName: 'ויזה זהב' } as never);
    expect(JSON.stringify(facts)).not.toMatch(/458028|ויזה/);
  });

  it('a holder-ID reference alone is enough to be worth writing', () => {
    expect(cardFactsFromCardcom(null, 'secret-1')).toEqual({ last4: null, expMonth: null, expYear: null, brand: null, issuer: null, tokenRef: null, citizenSecretId: 'secret-1' });
  });

  it.each([
    ['a last4 that is not four digits', { Last4CardDigitsString: '8' }, 'last4'],
    ['a last4 that is a number (zeros would be lost)', { Last4CardDigitsString: 8 }, 'last4'],
    ['a month of 0', { CardMonth: 0 }, 'expMonth'],
    ['a month of 13', { CardMonth: 13 }, 'expMonth'],
    ['a month that is not a whole number', { CardMonth: 1.5 }, 'expMonth'],
    ['a year before the ledger\'s range', { CardYear: 23 }, 'expYear'],
    ['a year beyond the ledger\'s range', { CardYear: 2101 }, 'expYear'],
    ['a year that is a string', { CardYear: '30' }, 'expYear'],
    ['a brand that is not text', { Brand: { name: 'Visa' } }, 'brand'],
    ['an empty brand', { Brand: '   ' }, 'brand'],
    ['an issuer far too long to be a name', { Issuer: 'x'.repeat(61) }, 'issuer'],
    ['a token that is not text', { Token: 12345 }, 'tokenRef'],
    ['a token far too long to be one', { Token: 'x'.repeat(201) }, 'tokenRef'],
  ])('drops %s — that field only, and the rest is kept', (_name, bad, field) => {
    expect(cardFactsFromCardcom({ ...MEASURED, Token: 'tok-1', ...bad })).toEqual({ last4: '0008', expMonth: 12, expYear: 2030, brand: 'Visa', issuer: 'CAL', tokenRef: 'tok-1', citizenSecretId: null, [field]: null });
  });

  it('is null when there is nothing usable, so nothing is written', () => {
    expect(cardFactsFromCardcom(null)).toBeNull();
    expect(cardFactsFromCardcom(undefined)).toBeNull();
    expect(cardFactsFromCardcom({})).toBeNull();
    expect(cardFactsFromCardcom({ Last4CardDigitsString: 'abcd', CardMonth: 99, CardYear: 1, Brand: 5, Issuer: null })).toBeNull();
  });
});

describe('holderIdFromCardcom', () => {
  it('takes the ID as CardCom gives it, trimmed (UIValues has a trailing space), the first usable candidate winning', () => {
    expect(holderIdFromCardcom('123456782 ')).toBe('123456782');
    expect(holderIdFromCardcom(undefined, null, '  ', '000000018')).toBe('000000018');
  });
  it('refuses what is not text or is not of a sane length', () => {
    expect(holderIdFromCardcom(123456782, 'x'.repeat(21), '')).toBeNull();
    expect(holderIdFromCardcom()).toBeNull();
  });
});

describe('occurredAtFromCardcom', () => {
  it('reads CardCom\'s zone-less time as Israel wall-clock time: 23:36:52 in October is 20:36:52 UTC', () => {
    expect(occurredAtFromCardcom('2026-10-07T23:36:52')).toBe('2026-10-07T20:36:52.000Z');
  });
  it('knows winter time too: 23:36:52 in January is 21:36:52 UTC', () => {
    expect(occurredAtFromCardcom('2026-01-15T23:36:52')).toBe('2026-01-15T21:36:52.000Z');
  });
  it('is null for anything that is not a date-time text', () => {
    expect(occurredAtFromCardcom('soon')).toBeNull();
    expect(occurredAtFromCardcom(1791404212)).toBeNull();
    expect(occurredAtFromCardcom(undefined)).toBeNull();
  });
});

describe('documentUrlFromCardcom', () => {
  const OWN = 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=abc%2B123';

  it('keeps CardCom\'s own https link exactly as it came (the access code is part of it)', () => {
    expect(documentUrlFromCardcom(OWN)).toBe(OWN);
  });

  it('takes the first usable candidate: TranzactionInfo\'s when DocumentInfo\'s is null', () => {
    expect(documentUrlFromCardcom(null, OWN)).toBe(OWN);
    expect(documentUrlFromCardcom(OWN, 'https://secure.cardcom.solutions/other')).toBe(OWN);
  });

  it.each([
    ['plain http', 'http://secure.cardcom.solutions/doc'],
    ['another host', 'https://evil.example/doc'],
    ['a look-alike host', 'https://secure.cardcom.solutions.evil.example/doc'],
    ['a javascript: link', 'javascript:alert(1)'],
    ['text that is not a URL', 'not a url'],
    ['an empty string', '   '],
    ['a number', 5],
    ['an over-long link', `https://secure.cardcom.solutions/${'a'.repeat(2100)}`],
  ])('refuses %s', (_name, bad) => {
    expect(documentUrlFromCardcom(bad)).toBeNull();
  });

  it('is null when there are no candidates', () => {
    expect(documentUrlFromCardcom()).toBeNull();
    expect(documentUrlFromCardcom(undefined, null)).toBeNull();
  });
});
