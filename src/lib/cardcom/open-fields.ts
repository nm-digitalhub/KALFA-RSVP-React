// The protocol between our payment page and CardCom's Open Fields iframes (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 1ב; CardCom's article "OPEN FIELDS" and its public sample code). Open Fields puts CardCom's card-number and CVV boxes
// inside OUR form as iframes, so the card number never touches our servers or our DOM.
//
// Pure on purpose — no DOM, no React — so what we send, what we accept and what we refuse are all unit-tested:
//   - we post exactly as CardCom's sample does, with '*' as the target (the owner's instruction of 18.10.2026), and only to the master
//     frame our own form renders from CardCom's address; we accept messages ONLY from CardCom's origin;
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
// Google Pay (openspec/changes/add-google-pay-cardcom) is a fifth frame, `CardComGooglePay`, carrying `allow="payment"`. It pays
// WITHOUT doTransaction and answers through the same HandleSubmit / HandleEror messages as a card, so the settlement path is the
// card's. What it needs first is the cardholder's name, email and phone, which Google Pay does not supply and 3D Secure requires:
// `setCardOwnerDetails`, posted to the MASTER frame (not to the Google Pay frame), as CardCom's own sample does. Not built: the
// "credits" logos frame.

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
  // Optional: only when Google Pay is offered. CardCom's sample uses this id AND name, and its scripts find frames by name.
  googlePay: 'CardComGooglePay',
} as const;

// The Google Pay frame's address: it carries the terminal the payment goes to, so it is built from the SAME configuration object
// that opened the session. Null for anything that is not a positive whole number, so a bad value never becomes an address.
export function googlePayFrameSrc(terminalNumber: number): string | null {
  if (!Number.isInteger(terminalNumber) || terminalNumber <= 0) return null;
  return `${OPEN_FIELDS_ORIGIN}/api/openfields/GooglePay?terminalNumber=${terminalNumber}`;
}

// The `field` of the master frame's `handleValidations` message that says the buyer has solved the captcha.
export const OPEN_FIELDS_CAPTCHA_FIELD = 'reCaptcha';

// Loaded onto the payment page: CardCom's 3D Secure handling.
export const OPEN_FIELDS_3DS_SCRIPT = `${OPEN_FIELDS_ORIGIN}/External/OpenFields/3DS.js`;

// The CSS CardCom injects into each frame. It cannot read our design tokens (a frame is another document), so the
// values below are the LITERALS of the page's own <Input> (src/components/ui/input.tsx: h-8, rounded-lg, border-input,
// bg-transparent, px-2.5, text-base; tokens from globals.css light theme). Owner 12.10: the CVV box visibly mismatched
// the MM/YY inputs beside it — keep these in lockstep with the Input component.
const FIELD_CSS = `
  body { margin: 0; }
  input, #cardNumber, #cvvField {
    box-sizing: border-box;
    width: 100%;
    height: 32px;
    margin: 0;
    padding: 4px 10px;
    border: 1px solid oklch(0.922 0 0);
    border-radius: 10px;
    font-size: 16px;
    background: transparent;
    color: oklch(0.145 0 0);
  }
  input:focus, #cardNumber:focus, #cvvField:focus {
    outline: none;
    border-color: oklch(0.511 0.262 276.97);
    box-shadow: 0 0 0 3px oklch(0.511 0.262 276.97 / 50%);
  }
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

// One definition of a valid name and email, shared by the card form (validateCardholder) and the Google Pay details
// (checkWalletDetails): the buyer's name, email and phone mean the same thing to CardCom whichever way they pay.
export function isValidCardholderName(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= MAX_FIELD;
}

export function isValidCardholderEmail(value: string): boolean {
  const email = value.trim();
  return EMAIL.test(email) && email.length <= MAX_FIELD;
}

// A card is valid through the END of its expiry month, so this month's card is still good. Year is two digits, as in
// CardCom's sample. `now` is a parameter so the check is a function of its inputs.
export function validateCardholder(input: Cardholder, now: Date = new Date()): CardholderCheck {
  const ownerId = typeof input.ownerId === 'string' ? input.ownerId.trim() : '';
  if (!isValidIsraeliId(ownerId)) return { ok: false, field: 'ownerId' };
  const name = input.name.trim();
  const email = input.email.trim();
  const address = input.address.trim();
  const city = input.city.trim();
  if (!isValidCardholderName(name)) return { ok: false, field: 'name' };
  if (!isValidCardholderEmail(email)) return { ok: false, field: 'email' };
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

// The customer details CardCom's documentation says must accompany the transaction ("user details: name, address, etc.").
// `address` and `city` go at the TOP LEVEL of the message: that is where the master frame reads them (its `setTransactionValues`
// takes `data.address`, `data.city` and `data.zipCode`, and its typed request `SubmitPaymentRequest` lists exactly those — read in
// the master script of 18.10.2026). They are NOT read from `document`: the master frame never looks at that object, so what the
// buyer typed there reached CardCom nowhere. `document` stays only because CardCom's own sample sends it (ONLY who the customer
// is: never a product, a price or a document type — those were fixed on the server when the session was opened).
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
  address: string;
  city: string;
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
    address,
    city,
    expirationMonth: input.month,
    expirationYear: input.year,
    numberOfPayments: '1',
    document: { Name: input.name, Email: input.email, AddressLine1: address, City: city, Mobile: phone, Phone: phone, Language: 'he' },
  };
}

// What Google Pay needs from us before the buyer taps it (CardCom's article, "update the cardholder details (mandatory)"): the
// name, email and phone, because Google Pay does not supply them and 3D Secure requires at least the phone or the email. Only
// these three — never an ID, an address, an amount or a document.
export type WalletDetailField = 'name' | 'email' | 'phone';
export type WalletDetails = { name: string; email: string; phone: string };
export type WalletDetailsCheck = { ok: true; value: WalletDetails } | { ok: false; missing: WalletDetailField[] };

// Every detail that is missing or not valid, in a fixed order, so the page can say which one the buyer still has to give.
export function checkWalletDetails(input: { name: string; email: string; phone: string }): WalletDetailsCheck {
  const missing: WalletDetailField[] = [];
  if (!isValidCardholderName(input.name)) missing.push('name');
  if (!isValidCardholderEmail(input.email)) missing.push('email');
  const phone = normalizeIsraeliPhone(input.phone);
  if (phone === null) missing.push('phone');
  if (missing.length > 0 || phone === null) return { ok: false, missing };
  return { ok: true, value: { name: input.name.trim(), email: input.email.trim(), phone } };
}

// The details are sent under BOTH spellings of the three keys. CardCom's article and its public sample write them camelCase
// (`cardOwnerName`), but the scripts that actually run read them PascalCase: the master frame's `setCardOwnerDetails` takes
// `details.CardOwnerName / CardOwnerEmail / CardOwnerPhone` (and its typed `CardOwnerDetails` is PascalCase), and the Google Pay
// frame's own `setCardOwnerDetails` reads `data.CardOwnerName / CardOwnerEmail / CardOwnerPhone` (both read from the live scripts,
// `OpenFields.js` and `GooglePay.js` v5.0.9784.18617, 18.10.2026). Sent camelCase alone, the master stored `undefined` and the
// wallet never saw an edited name, e-mail or phone. Both spellings cost nothing and survive whichever one CardCom settles on.
export type SetCardOwnerDetailsMessage = {
  action: 'setCardOwnerDetails';
  data: {
    CardOwnerName: string;
    CardOwnerEmail: string;
    CardOwnerPhone: string;
    cardOwnerName: string;
    cardOwnerEmail: string;
    cardOwnerPhone: string;
  };
};

// Posted to the MASTER frame with postToFrame (CardCom's sample does the same; the Google Pay frame is not the target). Never built from details
// that do not pass checkWalletDetails: a wallet payment started with half a cardholder would fail at 3D Secure, after the buyer
// has already approved it in their wallet.
export function buildSetCardOwnerDetailsMessage(details: WalletDetails): SetCardOwnerDetailsMessage {
  const checked = checkWalletDetails(details);
  if (!checked.ok) throw new Error('Incomplete wallet details');
  const { name, email, phone } = checked.value;
  return {
    action: 'setCardOwnerDetails',
    data: {
      CardOwnerName: name,
      CardOwnerEmail: email,
      CardOwnerPhone: phone,
      cardOwnerName: name,
      cardOwnerEmail: email,
      cardOwnerPhone: phone,
    },
  };
}

// Posts to CardCom's master frame EXACTLY as CardCom's sample and documentation write every call: `iframe.contentWindow.postMessage(
// message, '*')` — the owner's instruction of 18.10.2026 ("you must work exactly like that"; first for setCardOwnerDetails, then for
// init and doTransaction too). The frame is the master frame our own form renders from CardCom's address.
export function postToFrame(frame: Window, message: InitMessage | DoTransactionMessage | SetCardOwnerDetailsMessage): void {
  frame.postMessage(message, '*');
}

// The three steps of 3D Secure that CardCom's frames announce to our page (read in the master script `OpenFields.js?v=5.0.9784.18617`
// and in `3DS.js`, 18.10.2026): the device check (`StartDeviceFingerPrint`, the page waits up to ~11 s for the issuer), the
// cardholder's own challenge (`CardHolderChallenge`, the bank's one-time-code page) and its closing (`CloseCardHolderChallenge`: `3DS.js`
// acts on it, but none of CardCom's scripts posts it — master, Google Pay and `3DS.js` read again on 18.10.2026, v5.0.9787.22463 — so
// the page never waits for it). Only the NAME of the step is kept: the messages carry the issuer's address and transaction ids, which
// nothing here reads.
export type ThreeDsStep = 'fingerprint' | 'challenge' | 'closed';

// Which of CardCom's own 3D Secure sentences came with an error. Code 333 is posted from several branches of the master frame and the
// sentence is what tells them apart (read in `OpenFields.ts` and `Hebrew.ts` of its script v5.0.9784.18617, 18.10.2026):
//   fail_auth      "3DS אימות נכשל"      the 3D Secure server answered FailAuth or RejectAuth, or an answer the page did not recognise
//                                        after the device check or the challenge — the bank's side refused;
//   auth_error     "3DS שגיאת אימות"     it answered FailError — an error in the authentication itself;
//   general_error  "שגיאה כללית"         its FIRST answer carried a result code the master frame does not know;
//   timeout        "אימות 3D-Secure לא הושלם בזמן…"  the device check did not answer in time (code 408).
// Only the LABEL of a sentence we recognise is ever kept. The sentence itself, and anything the bank or CardCom might put in a message
// we do not recognise, is dropped, so what reaches the ledger is our own fixed vocabulary.
export type ThreeDsReason = 'fail_auth' | 'auth_error' | 'general_error' | 'timeout';

// A Map, not an object: the key comes from a message, and `constructor` or `__proto__` must never match.
const THREE_DS_SENTENCES = new Map<string, ThreeDsReason>([
  ['3DS אימות נכשל', 'fail_auth'],
  ['3DS שגיאת אימות', 'auth_error'],
  ['שגיאה כללית', 'general_error'],
  ['אימות 3D-Secure לא הושלם בזמן, אנא נסה שנית', 'timeout'],
]);

export type FrameMessage =
  | { kind: 'submit'; success: boolean }
  // `code` is the numeric ResponseCode CardCom's master frame puts on an error (never its text): 408 = the 3D Secure device check
  // timed out, 333 = 3D Secure refused or failed, 400 = a detail of the card or the form was not valid. `reason` is the label of
  // the one of its fixed 3D Secure sentences that came with it, or null for anything else.
  | { kind: 'error'; code: number | null; reason: ThreeDsReason | null }
  | { kind: 'validation'; field: string; valid: boolean }
  // The master frame has loaded the session's settings (`initialized`, posted right AFTER `setTerminalValues` — read in `OpenFields.ts`
  // 18.10.2026). Loading them puts the session's own name and e-mail (what the session was opened with) over whatever the page sent
  // before, and hands the wallet frame a snapshot of that state; so what the buyer typed must be sent again after it. Carries nothing.
  | { kind: 'settingsLoaded' }
  | { kind: 'threeDs'; step: ThreeDsStep };

// What an error code means for the buyer, in OUR words (package-purchase-errors.ts): a 3D Secure timeout or refusal is not the card
// issuer declining the card, and saying so sends the buyer to retype a card that was fine. Any other code is not interpreted.
export function threeDsErrorOf(code: number | null): 'three_ds_timeout' | 'three_ds_failed' | null {
  if (code === 408) return 'three_ds_timeout';
  if (code === 333) return 'three_ds_failed';
  return null;
}

// A message from the frames, or null for anything we should not act on: another origin, 3DS traffic, an unknown action.
// CardCom's own words (Description, message) are dropped on purpose.
export function parseFrameMessage(event: { origin: string; data: unknown }): FrameMessage | null {
  if (event.origin !== OPEN_FIELDS_ORIGIN) return null;
  const data = event.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as { action?: unknown; data?: unknown; field?: unknown; isValid?: unknown; ResponseCode?: unknown; message?: unknown };
  if (typeof message.action !== 'string') return null;

  switch (message.action) {
    case 'HandleSubmit': {
      const result = message.data;
      const success = result !== null && typeof result === 'object' && (result as { IsSuccess?: unknown }).IsSuccess === true;
      return { kind: 'submit', success };
    }
    case 'HandleEror': // sic — CardCom's spelling in its article and sample
    case 'HandleError':
      return {
        kind: 'error',
        code: typeof message.ResponseCode === 'number' && Number.isInteger(message.ResponseCode) ? message.ResponseCode : null,
        // An exact match only (the message is a string for a 3D Secure error and an array for an invalid detail): a sentence we do not
        // know, or any text a bank or CardCom added, is not interpreted and not kept.
        reason: typeof message.message === 'string' ? THREE_DS_SENTENCES.get(message.message.trim()) ?? null : null,
      };
    case 'StartDeviceFingerPrint':
      return { kind: 'threeDs', step: 'fingerprint' };
    case 'CardHolderChallenge':
      return { kind: 'threeDs', step: 'challenge' };
    case 'CloseCardHolderChallenge':
      return { kind: 'threeDs', step: 'closed' };
    case 'initialized':
      return { kind: 'settingsLoaded' };
    case 'handleValidations':
      return typeof message.field === 'string' ? { kind: 'validation', field: message.field, valid: message.isValid === true } : null;
    default:
      return null;
  }
}
