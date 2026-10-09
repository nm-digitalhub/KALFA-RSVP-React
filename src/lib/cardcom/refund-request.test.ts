import { describe, expect, it } from 'vitest';

import { documentTypeOfReportNumber, refundDocumentFor } from './document-types';
import { buildRefundTransaction, expiryMMYY, type CardcomRefundInput } from './refund-request';

// The refund request (Do Transaction with Advanced.IsRefund) and the credit document it issues. Pure: every rule from
// CardCom's OpenAPI and its "Do Transaction" article is pinned here.

const TOKEN = '4cf8e168-261e-4613-8d20-000332986b24';
const input = (over: Partial<CardcomRefundInput> = {}): CardcomRefundInput => ({
  terminalNumber: 172204,
  apiName: 'kalfa-api',
  apiPassword: 'secret',
  operationId: '01a120cb-3c91-7333-8c69-c9933843db5c',
  amount: 105,
  token: TOKEN,
  expMonth: 9,
  expYear: 2031,
  document: refundDocumentFor('Receipt')!,
  holder: { name: 'דנה כהן', email: 'dana@example.test' },
  line: 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע',
  ...over,
});

describe('refundDocumentFor — the credit document of a payment\'s document, by CardCom\'s own names', () => {
  it('a receipt is credited by a receipt refund; a tax invoice + receipt by its refund', () => {
    expect(refundDocumentFor('Receipt')).toEqual({ create: 'ReceiptRefund', answered: 'ReceiptRefund' });
    expect(refundDocumentFor('TaxInvoiceAndReceipt')).toEqual({ create: 'TaxInvoiceAndReceiptRefund', answered: 'TaxInvoiceAndReceiptRefund' });
  });

  it.each([undefined, null, '', 'SiteCustomerOrder', 'Quote', 'ReceiptRefund', 3, 'toString', '__proto__'])(
    'anything else (%s) has no counterpart: nothing is issued by guess',
    (issued) => {
      expect(refundDocumentFor(issued)).toBeNull();
    },
  );
});

describe('documentTypeOfReportNumber — the report\'s type number, by CardCom\'s documented list', () => {
  it.each([
    ['1', 'TaxInvoiceAndReceipt'],
    ['2', 'TaxInvoiceAndReceiptRefund'],
    ['3', 'Receipt'],
    ['4', 'ReceiptRefund'],
    ['305', 'TaxInvoice'],
    ['410', 'ReceiptForTaxInvoiceRefund'],
  ])('%s is %s', (n, name) => {
    expect(documentTypeOfReportNumber(n)).toBe(name);
  });

  it.each([null, '', '0', '101', '102', '303', '304', '3 ', 'toString'])('%s is not a type we can name', (n) => {
    expect(documentTypeOfReportNumber(n)).toBeNull();
  });
});

describe('expiryMMYY', () => {
  it.each([
    [9, 2031, '0931'],
    [12, 2030, '1230'],
    [1, 31, '0131'],
  ])('%i/%i → %s', (m, y, out) => {
    expect(expiryMMYY(m, y)).toBe(out);
  });

  it.each([[0, 2031], [13, 2031], [9.5, 2031], [9, -1], [9, Number.NaN]])('%s/%s is not an expiry', (m, y) => {
    expect(expiryMMYY(m, y)).toBeNull();
  });
});

describe('buildRefundTransaction', () => {
  it('a refund to the token, with the password, our row id as the idempotency key, and the credit document', () => {
    expect(buildRefundTransaction(input())).toEqual({
      TerminalNumber: 172204,
      ApiName: 'kalfa-api',
      Amount: 105,
      Token: TOKEN,
      CardExpirationMMYY: '0931',
      ExternalUniqTranId: '01a120cb-3c91-7333-8c69-c9933843db5c',
      ExternalUniqUniqTranIdResponse: true,
      NumOfPayments: 1,
      ISOCoinId: 1,
      Advanced: { IsRefund: true, ApiPassword: 'secret' },
      Document: {
        DocumentTypeToCreate: 'ReceiptRefund',
        Name: 'דנה כהן',
        Email: 'dana@example.test',
        Languge: 'he',
        Products: [{ Description: 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע', Quantity: 1, UnitCost: 105 }],
      },
    });
  });

  it('the document line is the amount that goes back, so the credit document adds up to it', () => {
    const r = buildRefundTransaction(input({ amount: 12.5 }));
    expect(r.Amount).toBe(12.5);
    expect(r.Document?.Products?.[0]?.UnitCost).toBe(12.5);
  });

  it('no email: the document carries none (CardCom then sends it nowhere)', () => {
    expect(buildRefundTransaction(input({ holder: { name: 'דנה', email: null } })).Document).not.toHaveProperty('Email');
  });

  it('names and emails longer than CardCom accepts (50) are cut, never refused', () => {
    const r = buildRefundTransaction(input({ holder: { name: 'א'.repeat(60), email: `${'a'.repeat(60)}@x.test` } }));
    expect(r.Document?.Name).toHaveLength(50);
    expect(r.Document?.Email).toHaveLength(50);
  });

  it.each([
    ['an empty API name', { apiName: '  ' }],
    ['an empty password', { apiPassword: '' }],
    ['a token that is not a guid', { token: 'tok-1' }],
    ['an impossible expiry', { expMonth: 13 }],
    ['no cardholder name', { holder: { name: ' ', email: null } }],
    ['an amount of zero', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['more than whole agorot', { amount: 1.005 }],
    ['an empty document line', { line: ' ' }],
  ])('refuses %s: nothing is sent that CardCom would have to guess at', (_label, over) => {
    expect(() => buildRefundTransaction(input(over as Partial<CardcomRefundInput>))).toThrow();
  });
});
