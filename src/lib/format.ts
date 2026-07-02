const currencyFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
});

/** Formats an amount as Hebrew-locale ILS currency (e.g. "₪1,234.00"). */
export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}
