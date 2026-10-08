// The protocol between our payment page and CardCom's Open Fields iframes (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 1ב; CardCom's article "OPEN FIELDS" and its public sample code). Open Fields puts CardCom's card-number and CVV boxes
// inside OUR form as iframes, so the card number never touches our servers or our DOM.
//
// Pure on purpose — no DOM, no React — so what we send, what we accept and what we refuse are all unit-tested:
//   - we post ONLY to CardCom's origin, never '*' (CardCom's own sample uses '*'), and we accept messages ONLY from it;
//   - a message is never believed about money: HandleSubmit/HandleEror are reasons for the server to ask CardCom
//     (GetLpResult), which alone decides whether a payment happened;
//   - CardCom's own text (Description, message) is never passed on: the page shows its own generic sentences;
//   - messages with no `action` are part of 3D Secure and are ignored.
//
// The captcha frame (`CardComCaptchaIframe`, listed by CardCom's article and Readme among the ids that "must" exist) is built.
// Its address is not in the article or the sample's HTML; it was read off CardCom's own live pages on 7.10.2026:
//   - GET {origin}/api/openfields/reCaptcha serves a Google reCAPTCHA v2 widget (the Readme: "Use Google reCaptcha (V2)");
//   - its script (External/OpenFields/reCaptcha/reCaptcha.js) hands the solved token to `window.parent.frames["CardComMasterFrame"]`
//     — the frame is found BY NAME, so every frame carries its id as its name too;
//   - the master script (OpenFields.js) finds this frame as `window.parent.frames.CardComCaptchaIframe` to give it the page's
//     `reCaptchaFieldCSS`, keeps the token in its state (which it sends whole to CardCom's ChargeLowProfileDeal) and tells the
//     page `handleValidations` with field 'reCaptcha'. Whether the token is REQUIRED is CardCom's server's decision (the
//     account's per-language captcha setting); the page only makes sure the buyer has done it before paying.
// Not in the pilot, and not mandatory: Google Pay (needs the cardholder details pushed to the iframe first) and the "credits"
// logos frame.

export const OPEN_FIELDS_ORIGIN = 'https://secure.cardcom.solutions';

export const OPEN_FIELDS_FRAME_SRC = {
  master: `${OPEN_FIELDS_ORIGIN}/api/openfields/master`,
  cardNumber: `${OPEN_FIELDS_ORIGIN}/api/openfields/cardNumber`,
  cvv: `${OPEN_FIELDS_ORIGIN}/api/openfields/CVV`,
  captcha: `${OPEN_FIELDS_ORIGIN}/api/openfields/reCaptcha`,
} as const;

// CardCom requires exactly these ids on the frames.
export const OPEN_FIELDS_FRAME_ID = {
  master: 'CardComMasterFrame',
  cardNumber: 'CardComCardNumber',
  cvv: 'CardComCvv',
  captcha: 'CardComCaptchaIframe',
} as const;

// The `field` of the master frame's `handleValidations` message that says the buyer has solved the captcha.
export const OPEN_FIELDS_CAPTCHA_FIELD = 'reCaptcha';

// Loaded onto the payment page: CardCom's 3D Secure handling.
export const OPEN_FIELDS_3DS_SCRIPT = `${OPEN_FIELDS_ORIGIN}/External/OpenFields/3DS.js`;

// The CSS CardCom injects into each frame. It cannot read our design tokens (a frame is another document), so it is plain:
// the same border, radius and height as the page's own inputs, and a visible focus ring.
const FIELD_CSS = `
  body { margin: 0; }
  input, #cardNumber, #cvvField {
    box-sizing: border-box;
    width: 100%;
    height: 40px;
    margin: 0;
    padding: 0 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 16px;
    background: #ffffff;
    color: #0f172a;
  }
  input:focus, #cardNumber:focus, #cvvField:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
  .invalid { border-color: #b91c1c; }
  input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
`;

export type InitMessage = {
  action: 'init';
  lowProfileCode: string;
  cardFieldCSS: string;
  cvvFieldCSS: string;
  reCaptchaFieldCSS: string;
  placeholder: string;
  cvvPlaceholder: string;
  language: 'he' | 'en';
};

export function buildInitMessage(input: { lowProfileCode: string; language?: 'he' | 'en' }): InitMessage {
  if (input.lowProfileCode.trim() === '') throw new Error('Open Fields needs a LowProfile code');
  return {
    action: 'init',
    lowProfileCode: input.lowProfileCode,
    cardFieldCSS: FIELD_CSS,
    cvvFieldCSS: FIELD_CSS,
    reCaptchaFieldCSS: 'body { margin: 0; padding: 0; display: flex; }',
    placeholder: '0000 0000 0000 0000',
    cvvPlaceholder: '123',
    language: input.language ?? 'he',
  };
}

// What the buyer types into OUR fields (the card number and CVV are CardCom's, in their frames).
export type Cardholder = {
  ownerId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  month: string;
  year: string;
};
export type CardholderField = 'ownerId' | 'name' | 'email' | 'phone' | 'address' | 'city' | 'month' | 'year' | 'expiry';
export type CardholderCheck = { ok: true; value: Cardholder } | { ok: false; field: CardholderField };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checks format and checksum, not issuance or ownership.
export function isValidIsraeliId(value: string): boolean {
  if (!/^[0-9]{9}$/.test(value) || value === '000000000') return false;

  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const product = Number(value[index]) * (index % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}

// An Israeli number as typed (spaces, dashes, a +972 prefix) to the plain local form: 0501234567. null when it is not one.
export function normalizeIsraeliPhone(value: string): string | null {
  const digits = value.replace(/[\s\-().]/g, '');
  const local = digits.startsWith('+972') ? `0${digits.slice(4)}` : digits.startsWith('972') ? `0${digits.slice(3)}` : digits;
  return /^0\d{8,9}$/.test(local) ? local : null;
}

// CardCom's limits for the customer fields of a document (its OpenAPI: Name, Email, AddressLine1 and City are at most 50).
const MAX_FIELD = 50;

// A card is valid through the END of its expiry month, so this month's card is still good. Year is two digits, as in
// CardCom's sample. `now` is a parameter so the check is a function of its inputs.
export function validateCardholder(input: Cardholder, now: Date = new Date()): CardholderCheck {
  const ownerId = typeof input.ownerId === 'string' ? input.ownerId.trim() : '';
  if (!isValidIsraeliId(ownerId)) return { ok: false, field: 'ownerId' };
  const name = input.name.trim();
  const email = input.email.trim();
  const address = input.address.trim();
  const city = input.city.trim();
  if (name.length < 2 || name.length > MAX_FIELD) return { ok: false, field: 'name' };
  if (!EMAIL.test(email) || email.length > MAX_FIELD) return { ok: false, field: 'email' };
  const phone = normalizeIsraeliPhone(input.phone);
  if (phone === null) return { ok: false, field: 'phone' };
  if (address.length < 2 || address.length > MAX_FIELD) return { ok: false, field: 'address' };
  if (city.length < 2 || city.length > MAX_FIELD) return { ok: false, field: 'city' };
  if (!/^(0[1-9]|1[0-2])$/.test(input.month)) return { ok: false, field: 'month' };
  if (!/^\d{2}$/.test(input.year)) return { ok: false, field: 'year' };
  const nowYear = now.getUTCFullYear() % 100;
  const nowMonth = now.getUTCMonth() + 1;
  const year = Number(input.year);
  const month = Number(input.month);
  if (year < nowYear || (year === nowYear && month < nowMonth)) return { ok: false, field: 'expiry' };
  return { ok: true, value: { ownerId, name, email, phone, address, city, month: input.month, year: input.year } };
}

// The customer details CardCom's documentation says must accompany the transaction ("user details: name, address, etc."),
// in the shape of the `document` object of CardCom's own sample. ONLY who the customer is: never a product, a price or a
// document type — those were fixed on the server when the session was opened. (Whether CardCom reads this object over the
// one the session was opened with is plan item U13, measured on the first run.)
//
// The one phone number is sent in BOTH `Mobile` and `Phone`: CardCom's two own sources contradict each other. Its OpenAPI says
// Mobile = mobile number and Phone = land line; its "Do Transaction" and "Create" articles say Mobile = land line and
// Phone = mobile (the one a document SMS goes to). The buyer types a mobile number, so it goes where either source wants it.
export type DoTransactionDocument = {
  Name: string;
  Email: string;
  AddressLine1: string;
  City: string;
  Mobile: string;
  Phone: string;
  Language: 'he';
};

export type DoTransactionMessage = {
  action: 'doTransaction';
  cardOwnerId: string;
  cardOwnerName: string;
  cardOwnerEmail: string;
  cardOwnerPhone: string;
  expirationMonth: string;
  expirationYear: string;
  numberOfPayments: string;
  document: DoTransactionDocument;
};

// A valid-format owner ID, phone, address and city are mandatory; never send a placeholder. The buyer's details go to
// CardCom's frame only (postToFrame below), never to our server.
export function buildDoTransactionMessage(input: Cardholder): DoTransactionMessage {
  const ownerId = typeof input.ownerId === 'string' ? input.ownerId.trim() : '';
  if (!isValidIsraeliId(ownerId)) throw new Error('Invalid cardholder ID');
  const phone = normalizeIsraeliPhone(input.phone);
  const address = input.address.trim();
  const city = input.city.trim();
  if (phone === null || address === '' || city === '') throw new Error('Incomplete cardholder details');
  return {
    action: 'doTransaction',
    cardOwnerId: ownerId,
    cardOwnerName: input.name,
    cardOwnerEmail: input.email,
    cardOwnerPhone: phone,
    expirationMonth: input.month,
    expirationYear: input.year,
    numberOfPayments: '1',
    document: { Name: input.name, Email: input.email, AddressLine1: address, City: city, Mobile: phone, Phone: phone, Language: 'he' },
  };
}

// Posts to a CardCom frame, and only to CardCom's origin.
export function postToFrame(frame: Window, message: InitMessage | DoTransactionMessage): void {
  frame.postMessage(message, OPEN_FIELDS_ORIGIN);
}

export type FrameMessage =
  | { kind: 'submit'; success: boolean }
  | { kind: 'error' }
  | { kind: 'validation'; field: string; valid: boolean };

// A message from the frames, or null for anything we should not act on: another origin, 3DS traffic, an unknown action.
// CardCom's own words (Description, message) are dropped on purpose.
export function parseFrameMessage(event: { origin: string; data: unknown }): FrameMessage | null {
  if (event.origin !== OPEN_FIELDS_ORIGIN) return null;
  const data = event.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as { action?: unknown; data?: unknown; field?: unknown; isValid?: unknown };
  if (typeof message.action !== 'string') return null;

  switch (message.action) {
    case 'HandleSubmit': {
      const result = message.data;
      const success = result !== null && typeof result === 'object' && (result as { IsSuccess?: unknown }).IsSuccess === true;
      return { kind: 'submit', success };
    }
    case 'HandleEror': // sic — CardCom's spelling in its article and sample
    case 'HandleError':
      return { kind: 'error' };
    case 'handleValidations':
      return typeof message.field === 'string' ? { kind: 'validation', field: message.field, valid: message.isValid === true } : null;
    default:
      return null;
  }
}
