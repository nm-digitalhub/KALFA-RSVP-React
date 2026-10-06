import { describe, expect, it } from 'vitest';
import { formatAmount, formatCurrency } from './format';

// Intl.NumberFormat('he-IL', ...) surrounds the output with invisible
// bidi marks (RLM, U+200F) whose exact placement is an ICU implementation
// detail, not something worth pinning byte-for-byte. Assert on the visible
// content instead: the digits/decimals and the ₪ symbol must be present,
// in that order.
describe('formatCurrency', () => {
  it('formats a whole-shekel amount with the ILS symbol and two decimals', () => {
    expect(formatCurrency(1234)).toMatch(/1,234\.00.*₪/);
  });

  it('formats a fractional amount, rounding to two decimals', () => {
    expect(formatCurrency(88.5)).toMatch(/88\.50.*₪/);
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toMatch(/0\.00.*₪/);
  });
});

// The price a customer is shown: whole shekels without agorot, anything else with both digits.
describe('formatAmount', () => {
  it('shows a whole-shekel amount without agorot', () => {
    expect(formatAmount(120)).toMatch(/120/);
    expect(formatAmount(120)).not.toMatch(/[.,]\d/);
  });

  it('keeps both agorot digits on a fractional price — a price is never rounded on the way to the customer', () => {
    expect(formatAmount(149.9)).toContain('149.90');
    expect(formatAmount(149.9)).not.toContain('150');
  });
});
