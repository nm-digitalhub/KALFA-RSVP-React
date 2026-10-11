// Pure arithmetic of a cancellation fee chosen as a PERCENTAGE. No server-only imports: the admin form uses it for the
// live preview and the server (event-cancellation.ts) uses the very same functions to decide the real amount, so the
// preview can never disagree with what is charged or credited.

// The amount a percentage fee is taken of: what the card paid for the package (`packagePaid`, from the payment ledger;
// null for a campaign without a package). Decided on the server, never from anything the browser sends (the browser only
// ever submits the percentage). 0 means "no base": a percentage cannot be applied and the admin must type an amount.
export function cancellationFeeBase(c: { packagePaid: number | null }): number {
  const base = c.packagePaid;
  return base != null && Number.isFinite(base) && base > 0 ? base : 0;
}

// A percentage of a base, in whole agorot, rounded half up: 5% of ₪84 is ₪4.20.
export function feeFromPercent(base: number, percent: number): number {
  return Math.round(base * percent) / 100;
}
