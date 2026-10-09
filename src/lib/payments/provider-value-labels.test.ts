import { describe, expect, it } from 'vitest';

import { PROVIDER_VALUE_ENUMS, providerValueLabel, type ProviderValueField } from './provider-value-labels';

describe('providerValueLabel', () => {
  // The values stored on the live ledger rows of 9.10.2026.
  it.each([
    ['documentType', 'Receipt', 'קבלה'],
    ['documentType', 'ReceiptRefund', 'קבלה זיכוי'],
    ['dealType', 'Debit', 'חיוב'],
    ['paymentType', 'Standard', 'רגיל'],
    ['acquirer', 'CardCom', 'קארדקום'],
    ['cardBrand', 'Visa', 'ויזה'],
    ['cardIssuer', 'Laumicard', 'מקס (לאומי קארד)'],
    ['provider', 'sumit', 'סאמיט'],
    ['source', 'app', 'המערכת'],
    ['source', 'manual_backfill', 'הזנה ידנית'],
  ] as const)('%s %s → %s', (field, value, label) => {
    expect(providerValueLabel(field, value)).toBe(label);
  });

  it.each([
    ['cardBrand', '21'],
    ['cardIssuer', '11'],
    ['dealType', 'SomethingNew'],
    ['documentType', 'a.b'],
    ['source', 'ns:key'],
  ] as const)('a value with no name (%s %s) is shown as stored, never guessed', (field, value) => {
    expect(providerValueLabel(field, value)).toBe(value);
  });

  // Brand names that are written in Latin letters in Hebrew too: their name is the value itself.
  const LATIN_NAMES = new Set(['PayPal', 'Upay', 'PayMe', 'JCB']);

  it('every value of every generated CardCom enum has a name (a missing one would fall back to the raw value)', () => {
    for (const [field, values] of Object.entries(PROVIDER_VALUE_ENUMS)) {
      for (const value of Object.values(values)) {
        const label = providerValueLabel(field as ProviderValueField, value);
        if (!LATIN_NAMES.has(value)) expect(label, `${field}.${value}`).not.toBe(value);
      }
    }
  });
});
