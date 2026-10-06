const currencyFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
});

/** Formats an amount as Hebrew-locale ILS currency (e.g. "₪1,234.00"). */
export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

/**
 * Formats a price for a customer: a whole-shekel amount shows no agorot ("₪150"), anything else shows both digits
 * ("₪99.90"), so a fractional price is never rounded on its way to the screen.
 */
export function formatAmount(amount: number): string {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return amount.toLocaleString('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
