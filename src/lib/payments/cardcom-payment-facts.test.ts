import { describe, expect, it } from 'vitest';

import { paymentFactsFromCardcom } from './cardcom-payment-facts';

// The rest of what CardCom says about a payment, mapped onto the payment row. Each field is checked on its own: an unusable one
// becomes null and the others are kept, so none of it can stand in the way of recording a payment CardCom confirmed.

// The shape CardCom really returned on the first run (terminal 1000, 7.10.2026).
const MEASURED = {
  CardOwnerName: 'Dana Cohen', CardOwnerEmail: 'dana@example.com', CardOwnerPhone: '0501234567',
  CardName: 'ויזה זהב', CardInfo: 'Israeli', FirstCardDigits: 458028, IsAbroadCard: false, NumberOfPayments: 1,
  CouponNumber: '74002281', Uid: '21121517002429612920744', Rrn: '', Acquire: 'Laumicard', PaymentType: 'Standard',
  CardNumberEntryMode: 'Phone', DealType: 'Debit', AccountId: 0, IssuerAuthCodeDescription: 'אושר ע"י החברה המנפיקה',
};
const MAPPED = {
  cardOwnerName: 'Dana Cohen', cardOwnerEmail: 'dana@example.com', cardOwnerPhone: '0501234567',
  cardName: 'ויזה זהב', cardInfo: 'Israeli', cardFirstDigits: '458028', cardIsAbroad: false, numberOfPayments: 1,
  couponNumber: '74002281', uniqueId: '21121517002429612920744', rrn: null, acquirer: 'Laumicard', paymentType: 'Standard',
  entryMode: 'Phone', dealType: 'Debit', accountId: null, authDescription: 'אושר ע"י החברה המנפיקה',
};

describe('paymentFactsFromCardcom', () => {
  it('maps the answer CardCom really gave, field by field', () => {
    expect(paymentFactsFromCardcom(MEASURED, null)).toEqual(MAPPED);
  });

  it('keeps the first digits as text, so a number type cannot lose anything', () => {
    expect(paymentFactsFromCardcom({ FirstCardDigits: 458028 }, null)?.cardFirstDigits).toBe('458028');
  });

  it('keeps `false` for a card from Israel: "not from abroad" is an answer, not an absence', () => {
    expect(paymentFactsFromCardcom({ IsAbroadCard: false }, null)?.cardIsAbroad).toBe(false);
    expect(paymentFactsFromCardcom({ IsAbroadCard: true }, null)?.cardIsAbroad).toBe(true);
  });

  it('reads 0 as "no customer card was opened" (nothing to keep) and a real number as the card\'s id', () => {
    expect(paymentFactsFromCardcom({ AccountId: 0 }, null)).toBeNull();
    expect(paymentFactsFromCardcom({ AccountId: 8539 }, null)?.accountId).toBe(8539);
  });

  it('turns an empty string (CardCom\'s RRN came back empty) into nothing, not into an empty value', () => {
    expect(paymentFactsFromCardcom({ Rrn: '', Uid: '  ' }, null)).toBeNull();
  });

  it('takes the cardholder from UIValues when TranzactionInfo lacks a field, and TranzactionInfo first when both have it', () => {
    const ui = { CardOwnerName: 'From UI', CardOwnerEmail: 'ui@example.com', CardOwnerPhone: '0521111111' };
    expect(paymentFactsFromCardcom({ CardOwnerName: 'From Info' }, ui)).toMatchObject({ cardOwnerName: 'From Info', cardOwnerEmail: 'ui@example.com', cardOwnerPhone: '0521111111' });
  });

  it.each([
    ['a name that is not text', { CardOwnerName: 42 }, 'cardOwnerName'],
    ['an over-long name', { CardOwnerName: 'x'.repeat(301) }, 'cardOwnerName'],
    ['first digits that are text', { FirstCardDigits: '458028' }, 'cardFirstDigits'],
    ['first digits with a fraction', { FirstCardDigits: 4580.5 }, 'cardFirstDigits'],
    ['a flag that is text', { IsAbroadCard: 'false' }, 'cardIsAbroad'],
    ['zero payments', { NumberOfPayments: 0 }, 'numberOfPayments'],
    ['an absurd number of payments', { NumberOfPayments: 100000 }, 'numberOfPayments'],
    ['a coupon number that is an object', { CouponNumber: { n: 1 } }, 'couponNumber'],
    ['an account id beyond the database\'s range', { AccountId: 2 ** 40 }, 'accountId'],
    ['an enum that arrives as a number', { Acquire: 3 }, 'acquirer'],
  ])('drops %s — that field only, and the rest is kept', (_name, bad, field) => {
    expect(paymentFactsFromCardcom({ ...MEASURED, ...bad }, null)).toEqual({ ...MAPPED, [field]: null });
  });

  it('is null when CardCom says nothing usable, so nothing is written', () => {
    expect(paymentFactsFromCardcom(null, null)).toBeNull();
    expect(paymentFactsFromCardcom(undefined, undefined)).toBeNull();
    expect(paymentFactsFromCardcom({}, {})).toBeNull();
    expect(paymentFactsFromCardcom({ NumberOfPayments: 0, AccountId: 0, Rrn: '', IsAbroadCard: 'x' }, null)).toBeNull();
  });
});
