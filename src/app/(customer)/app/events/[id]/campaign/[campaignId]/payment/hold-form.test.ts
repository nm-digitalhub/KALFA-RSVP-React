import { describe, expect, it } from 'vitest';

import { formatCardholderName } from './hold-form';

// Card-preview display only — never touches what SUMIT tokenizes or what
// reaches the server. Real embossed cards keep first/last name in full and
// abbreviate middle name(s); matches the convention observed on a real card.
describe('formatCardholderName', () => {
  it('abbreviates a single middle name to 3 letters', () => {
    expect(formatCardholderName('Netanel Mevorach Kalfa')).toBe('NETANEL MEV KALFA');
  });

  it('abbreviates multiple middle names', () => {
    expect(formatCardholderName('Mary Ann Beth O Donnell')).toBe('MARY ANN BET O DONNELL');
  });

  it('leaves a two-part name untouched (first + last only)', () => {
    expect(formatCardholderName('Netanel Kalfa')).toBe('NETANEL KALFA');
  });

  it('leaves a single-word name untouched', () => {
    expect(formatCardholderName('Netanel')).toBe('NETANEL');
  });

  it('uppercases the result', () => {
    expect(formatCardholderName('netanel mevorach kalfa')).toBe('NETANEL MEV KALFA');
  });

  it('collapses extra whitespace between name parts', () => {
    expect(formatCardholderName('  Netanel   Mevorach   Kalfa  ')).toBe('NETANEL MEV KALFA');
  });

  it('handles an empty string', () => {
    expect(formatCardholderName('')).toBe('');
  });
});
