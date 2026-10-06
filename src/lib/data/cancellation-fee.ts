// Pure arithmetic of a cancellation fee chosen as a PERCENTAGE. No server-only imports: the admin form uses it for the
// live preview and the server (event-cancellation.ts) uses the very same functions to decide the real amount, so the
// preview can never disagree with what is charged or credited.

// The amount a percentage fee is taken of. Decided from the campaign's own data, never from anything the browser sends
// (the browser only ever submits the percentage). A campaign that was already charged: what it was actually charged
// (net of credits already given back). One that was not: its frozen ceiling (agreements up to v4 state a number; an
// open-ceiling agreement has none). A fixed-price PACKAGE has no ceiling and no final charge: its base is what the card
// paid (`packagePaid`, from the payment ledger; null/absent for every other campaign). 0 means "no base": a percentage
// cannot be applied and the admin must type an amount.
export function cancellationFeeBase(c: {
  chargeStatus: string | null;
  finalChargeAmount: number | null;
  maxChargeCeiling: number | null;
  packagePaid?: number | null;
}): number {
  const base = c.packagePaid != null ? c.packagePaid : c.chargeStatus === 'charged' ? c.finalChargeAmount : c.maxChargeCeiling;
  return base != null && Number.isFinite(base) && base > 0 ? base : 0;
}

// A percentage of a base, in whole agorot, rounded half up: 5% of ₪84 is ₪4.20.
export function feeFromPercent(base: number, percent: number): number {
  return Math.round(base * percent) / 100;
}
