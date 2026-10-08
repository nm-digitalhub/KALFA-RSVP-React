// The rest of what CardCom's GetLpResult says about a payment, mapped field by field onto the payment row
// (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, section 11; the columns are migration 20261007225130).
// Card facts, the card token, the holder ID and the document link are in cardcom-card-facts.ts.
//
// Shaped like it, for the same reason: none of this decides money, so none of it may stand in the way of recording a payment
// CardCom has confirmed. Every field is checked on its own; one that is missing, of the wrong type or absurdly long becomes
// null and the rest is kept. Pure — no server-only, no database.
//
// The cardholder's name, e-mail and phone are personal data. They go to the row (server-only, no screen reads them) and are
// never logged.

export type PaymentFacts = {
  cardOwnerName: string | null;
  cardOwnerEmail: string | null;
  cardOwnerPhone: string | null;
  cardName: string | null;
  cardInfo: string | null;
  cardFirstDigits: string | null;
  cardIsAbroad: boolean | null;
  numberOfPayments: number | null;
  couponNumber: string | null;
  uniqueId: string | null;
  rrn: string | null;
  acquirer: string | null;
  paymentType: string | null;
  entryMode: string | null;
  dealType: string | null;
  accountId: number | null;
  authDescription: string | null;
};

// TranzactionInfo, as far as this module reads it. `unknown` on purpose: a shape CardCom changes must not break a payment.
export type CardcomTransactionFacts = {
  CardOwnerName?: unknown;
  CardOwnerEmail?: unknown;
  CardOwnerPhone?: unknown;
  CardName?: unknown;
  CardInfo?: unknown;
  FirstCardDigits?: unknown;
  IsAbroadCard?: unknown;
  NumberOfPayments?: unknown;
  CouponNumber?: unknown;
  Uid?: unknown;
  Rrn?: unknown;
  Acquire?: unknown;
  PaymentType?: unknown;
  CardNumberEntryMode?: unknown;
  DealType?: unknown;
  AccountId?: unknown;
  IssuerAuthCodeDescription?: unknown;
};

// UIValues repeats the cardholder (CardCom's own answer has it twice); it is the fallback when TranzactionInfo lacks a field.
export type CardcomUiValues = {
  CardOwnerName?: unknown;
  CardOwnerEmail?: unknown;
  CardOwnerPhone?: unknown;
};

const MAX_TEXT = 300;

function text(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed !== '' && trimmed.length <= MAX_TEXT) return trimmed;
  }
  return null;
}

function whole(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// CardCom sends the first digits as a number (458028). Kept as text, so that nothing is lost to a number type.
function firstDigits(value: unknown): string | null {
  const digits = whole(value, 1, 99_999_999);
  return digits === null ? null : String(digits);
}

export function paymentFactsFromCardcom(info: CardcomTransactionFacts | null | undefined, ui: CardcomUiValues | null | undefined): PaymentFacts | null {
  const facts: PaymentFacts = {
    cardOwnerName: text(info?.CardOwnerName, ui?.CardOwnerName),
    cardOwnerEmail: text(info?.CardOwnerEmail, ui?.CardOwnerEmail),
    cardOwnerPhone: text(info?.CardOwnerPhone, ui?.CardOwnerPhone),
    cardName: text(info?.CardName),
    cardInfo: text(info?.CardInfo),
    cardFirstDigits: firstDigits(info?.FirstCardDigits),
    cardIsAbroad: typeof info?.IsAbroadCard === 'boolean' ? info.IsAbroadCard : null,
    numberOfPayments: whole(info?.NumberOfPayments, 1, 999),
    couponNumber: text(info?.CouponNumber),
    uniqueId: text(info?.Uid),
    rrn: text(info?.Rrn),
    acquirer: text(info?.Acquire),
    paymentType: text(info?.PaymentType),
    entryMode: text(info?.CardNumberEntryMode),
    dealType: text(info?.DealType),
    // 0 is how CardCom says "no customer card was opened or matched": there is nothing to keep.
    accountId: whole(info?.AccountId, 1, 2_147_483_647),
    authDescription: text(info?.IssuerAuthCodeDescription),
  };
  return Object.values(facts).every((v) => v === null) ? null : facts;
}
