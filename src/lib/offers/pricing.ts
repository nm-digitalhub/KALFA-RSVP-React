// The one place an offer's discount becomes a price (personal-coupons D14): the admin screen's
// positive-price refusal (task 5.1) and the assign path's frozen option prices (task 5.2) both call
// this, so what the screen refuses and what an assignment freezes can never drift apart.
//
// Money is shekels with agorot precision (two decimals) — the unit CardCom settles in (MEASURED on
// the real ₪1.00 session of terminal 172204: Amount: 1 = one shekel). The whole computation runs in
// decimal.js (owner, 12.10.2026): binary floats may not represent values like 100.50 exactly, and
// the database's own numeric math is exact decimal — the two must agree digit for digit. The
// discount is rounded first and the final price is derived from the ROUNDED discount, so
// list - discount = final always holds exactly — the same identity campaign_pricing enforces as a
// check constraint on every row.
//
// Callers get plain numbers back and must NOT run further money arithmetic on them in binary
// floats expecting exact decimals — compare/derive in Decimal or in whole agorot.

import Decimal from 'decimal.js';

const PricingDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export type OfferKind = 'percent' | 'amount';

export type OfferOptionPricing = {
  discountAmount: number;
  finalPrice: number;
};

/**
 * The price an offer gives one package. `value` is the offer's value already resolved for the
 * package (its `value_override` when set, the offer's own `value` otherwise).
 */
export function computeOfferOption(
  listPrice: number,
  kind: OfferKind,
  value: number,
): OfferOptionPricing {
  if (!Number.isFinite(listPrice) || !Number.isFinite(value)) {
    throw new Error('Invalid pricing input');
  }
  const price = new PricingDecimal(String(listPrice));
  const offerValue = new PricingDecimal(String(value));
  const discount = (
    kind === 'percent' ? price.times(offerValue).dividedBy(100) : offerValue
  ).toDecimalPlaces(2, PricingDecimal.ROUND_HALF_UP);
  const finalPrice = price.minus(discount).toDecimalPlaces(2, PricingDecimal.ROUND_HALF_UP);
  return {
    discountAmount: discount.toNumber(),
    finalPrice: finalPrice.toNumber(),
  };
}
