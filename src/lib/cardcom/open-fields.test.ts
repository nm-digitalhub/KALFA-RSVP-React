import { describe, expect, it } from 'vitest';

import {
  OPEN_FIELDS_CAPTCHA_FIELD,
  OPEN_FIELDS_FRAME_ID,
  OPEN_FIELDS_FRAME_SRC,
  OPEN_FIELDS_ORIGIN,
  buildDoTransactionMessage,
  buildInitMessage,
  buildSetCardOwnerDetailsMessage,
  checkWalletDetails,
  googlePayFrameSrc,
  isValidCardholderEmail,
  isValidCardholderName,
  parseFrameMessage,
  postCardOwnerDetails,
  postToFrame,
  threeDsErrorOf,
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

describe('the frames CardCom\'s documentation lists', () => {
  it('have exactly the ids CardCom lists (its article, Readme and sample): the four that must exist, the captcha one included, and the optional Google Pay one', () => {
    expect(Object.values(OPEN_FIELDS_FRAME_ID).sort()).toEqual(['CardComCaptchaIframe', 'CardComCardNumber', 'CardComCvv', 'CardComGooglePay', 'CardComMasterFrame']);
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
      address: 'הרצל 10',
      city: 'תל אביב',
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

describe('googlePayFrameSrc', () => {
  it('serves the Google Pay frame from CardCom\'s own origin, for the terminal the session was opened on', () => {
    expect(googlePayFrameSrc(172204)).toBe('https://secure.cardcom.solutions/api/openfields/GooglePay?terminalNumber=172204');
    expect(googlePayFrameSrc(1000)).toBe(`${OPEN_FIELDS_ORIGIN}/api/openfields/GooglePay?terminalNumber=1000`);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('never turns %j into an address', (terminal) => {
    expect(googlePayFrameSrc(terminal)).toBeNull();
  });
});

describe('isValidCardholderName / isValidCardholderEmail', () => {
  it('draw the same lines as the card form: two to fifty characters for a name, a plain e-mail of at most fifty', () => {
    expect(isValidCardholderName('דנה')).toBe(true);
    expect(isValidCardholderName(' ד ')).toBe(false);
    expect(isValidCardholderName('x'.repeat(50))).toBe(true);
    expect(isValidCardholderName('x'.repeat(51))).toBe(false);
    expect(isValidCardholderEmail('dana@example.com')).toBe(true);
    expect(isValidCardholderEmail(' dana@example.com ')).toBe(true);
    expect(isValidCardholderEmail('dana.example.com')).toBe(false);
    expect(isValidCardholderEmail(`${'x'.repeat(45)}@e.com`)).toBe(false);
  });
});

describe('checkWalletDetails', () => {
  const ok = { name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567' };

  it('accepts a complete buyer, trims the text and puts the phone in its plain local form', () => {
    expect(checkWalletDetails({ name: '  דנה כהן ', email: ' dana@example.com ', phone: '+972 50-123-4567' })).toEqual({
      ok: true,
      value: { name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567' },
    });
  });

  it.each([
    ['a blank name', { name: ' ' }, ['name']],
    ['a bad e-mail', { email: 'dana' }, ['email']],
    ['no phone', { phone: '' }, ['phone']],
    ['a phone that is not Israeli', { phone: '12345' }, ['phone']],
  ])('names the one detail that is missing: %s', (_label, over, missing) => {
    expect(checkWalletDetails({ ...ok, ...over })).toEqual({ ok: false, missing });
  });

  it('names every missing detail, always in the same order', () => {
    expect(checkWalletDetails({ name: '', email: '', phone: '' })).toEqual({ ok: false, missing: ['name', 'email', 'phone'] });
    expect(checkWalletDetails({ ...ok, phone: 'x', name: '' })).toEqual({ ok: false, missing: ['name', 'phone'] });
  });
});

describe('buildSetCardOwnerDetailsMessage', () => {
  const ok = { name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567' };

  it('is CardCom\'s setCardOwnerDetails, with exactly the three details its article names, under both spellings of the keys', () => {
    // PascalCase is what CardCom's running scripts read (OpenFields.js and GooglePay.js, 18.10.2026); camelCase is what its article
    // and sample write. Only the PascalCase pair reaches the wallet today, so it must never be dropped.
    expect(buildSetCardOwnerDetailsMessage(ok)).toEqual({
      action: 'setCardOwnerDetails',
      data: {
        CardOwnerName: 'דנה כהן',
        CardOwnerEmail: 'dana@example.com',
        CardOwnerPhone: '0501234567',
        cardOwnerName: 'דנה כהן',
        cardOwnerEmail: 'dana@example.com',
        cardOwnerPhone: '0501234567',
      },
    });
  });

  it('carries nothing else: no ID, no address, no amount, no document', () => {
    const message = JSON.stringify(buildSetCardOwnerDetailsMessage(ok));
    expect(message).not.toMatch(/ownerId|address|city|amount|price|document|expiration/i);
  });

  it.each([
    ['no name', { name: '' }],
    ['a bad e-mail', { email: 'x' }],
    ['a phone that is not a number', { phone: 'abc' }],
  ])('refuses %s: half a cardholder is never sent', (_label, over) => {
    expect(() => buildSetCardOwnerDetailsMessage({ ...ok, ...over })).toThrow('Incomplete wallet details');
  });
});

describe('postToFrame', () => {
  const frame = () => {
    const calls: Array<[unknown, string]> = [];
    return { calls, window: { postMessage: (message: unknown, target: string) => void calls.push([message, target]) } as unknown as Window };
  };

  it('posts init and doTransaction to CardCom\'s exact origin and never to a wildcard', () => {
    const { calls, window } = frame();
    postToFrame(window, buildInitMessage({ lowProfileCode: 'lp-1' }));
    postToFrame(window, buildDoTransactionMessage({ ...valid }));
    expect(calls.map(([, target]) => target)).toEqual([OPEN_FIELDS_ORIGIN, OPEN_FIELDS_ORIGIN]);
    expect(calls.some(([, target]) => target === '*')).toBe(false);
    expect(calls.map(([message]) => (message as { action: string }).action)).toEqual(['init', 'doTransaction']);
  });

  // The owner's instruction, 18.10.2026: the cardholder's details go exactly as CardCom writes the call, with '*' as the target.
  it('posts the cardholder details exactly as CardCom documents the call: { action: \'setCardOwnerDetails\', data } with \'*\'', () => {
    const { calls, window } = frame();
    postCardOwnerDetails(window, buildSetCardOwnerDetailsMessage({ name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567' }));
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('*');
    expect(Object.keys(calls[0][0] as object).sort()).toEqual(['action', 'data']);
    expect((calls[0][0] as { action: string }).action).toBe('setCardOwnerDetails');
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
    expect(from({ action: 'HandleEror', message: 'secret detail' })).toEqual({ kind: 'error', code: null, reason: null });
    expect(from({ action: 'HandleError' })).toEqual({ kind: 'error', code: null, reason: null });
  });

  it('keeps only the numeric ResponseCode of an error (408 3D Secure timeout, 333 3D Secure refused, 400 an invalid detail), never its text', () => {
    expect(from({ action: 'HandleEror', ResponseCode: 408, message: 'secret detail', redirectUrl: 'https://x' })).toEqual({ kind: 'error', code: 408, reason: null });
    expect(from({ action: 'HandleEror', ResponseCode: 333 })).toEqual({ kind: 'error', code: 333, reason: null });
    expect(from({ action: 'HandleEror', ResponseCode: 400 })).toEqual({ kind: 'error', code: 400, reason: null });
    for (const bad of ['408', 408.5, null, undefined, {}, [408], Number.NaN]) {
      expect(from({ action: 'HandleEror', ResponseCode: bad })).toEqual({ kind: 'error', code: null, reason: null });
    }
    expect(JSON.stringify(from({ action: 'HandleEror', ResponseCode: 408, message: 'secret detail' }))).not.toContain('secret');
  });

  // Code 333 is posted from several branches of CardCom's master frame; its Hebrew sentence says which (OpenFields.ts / Hebrew.ts).
  it.each([
    ['3DS אימות נכשל', 'fail_auth'],
    ['3DS שגיאת אימות', 'auth_error'],
    ['שגיאה כללית', 'general_error'],
    ['אימות 3D-Secure לא הושלם בזמן, אנא נסה שנית', 'timeout'],
    ['  3DS אימות נכשל  ', 'fail_auth'],
  ])('labels CardCom\'s 3D Secure sentence %j as %s', (sentence, reason) => {
    expect(from({ action: 'HandleEror', ResponseCode: 333, message: sentence })).toEqual({ kind: 'error', code: 333, reason });
  });

  it('keeps no label for a sentence it does not know, for a list of messages, or for a key that is not a sentence — and never the text', () => {
    for (const message of ['התשלום נכשל', '3DS אימות נכשל. פרטים: 4580-secret', ['תאריך תוקף שגוי'], 'constructor', '__proto__', 'toString', 7, null, {}]) {
      expect(from({ action: 'HandleEror', ResponseCode: 333, message })).toEqual({ kind: 'error', code: 333, reason: null });
    }
    expect(JSON.stringify(from({ action: 'HandleEror', ResponseCode: 333, message: '3DS אימות נכשל. פרטים: 4580-secret' }))).not.toContain('secret');
  });

  it('reads CardCom\'s "settings loaded" signal (`initialized`) and nothing it carries, and only from CardCom', () => {
    expect(from({ action: 'initialized', lowProfileCode: 'secret-lp', isGooglePayAvailable: true, isApplePayAvailable: false })).toEqual({ kind: 'settingsLoaded' });
    expect(JSON.stringify(from({ action: 'initialized', lowProfileCode: 'secret-lp' }))).not.toContain('secret');
    expect(from({ action: 'initialized' }, 'https://evil.example')).toBeNull();
  });

  it('names the three 3D Secure steps CardCom announces, and reads nothing else from them', () => {
    expect(from({ action: 'StartDeviceFingerPrint', params: { _3ds_method: 'https://acs.example/method', _3ds_trxid: 'abc', threeDSMethodData: 'zzz' } })).toEqual({ kind: 'threeDs', step: 'fingerprint' });
    expect(from({ action: 'CardHolderChallenge', params: 'https://acs.example/challenge?x=secret' })).toEqual({ kind: 'threeDs', step: 'challenge' });
    expect(from({ action: 'CloseCardHolderChallenge' })).toEqual({ kind: 'threeDs', step: 'closed' });
    expect(JSON.stringify(from({ action: 'StartDeviceFingerPrint', params: { _3ds_trxid: 'abc' } }))).not.toMatch(/abc|acs\.example|secret/);
  });

  it('ignores a 3D Secure step announced from another origin', () => {
    expect(from({ action: 'StartDeviceFingerPrint' }, 'https://evil.example')).toBeNull();
    expect(from({ action: 'CardHolderChallenge' }, 'https://evil.example')).toBeNull();
  });

  it('ignores the strings 3D Secure passes around (they carry no action name)', () => {
    expect(from('ThreeDSecureDeviceFingerprintResult_{"ResponseCode":1}')).toBeNull();
    expect(from('ThreeDSecureChallengeResult_{"ResponseCode":1}')).toBeNull();
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
    // Our own outgoing action name coming back is not a result either.
    expect(from({ action: 'setCardOwnerDetails', data: { cardOwnerName: 'x' } })).toBeNull();
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

describe('threeDsErrorOf', () => {
  it('tells a 3D Secure timeout (408) and a 3D Secure refusal (333) apart from a decline: the issuer did not decline the card', () => {
    expect(threeDsErrorOf(408)).toBe('three_ds_timeout');
    expect(threeDsErrorOf(333)).toBe('three_ds_failed');
  });

  it.each([400, 500, 5119, 0, null])('does not interpret %j', (code) => {
    expect(threeDsErrorOf(code)).toBeNull();
  });
});
