import { describe, expect, it } from 'vitest';

import { documentTypeOfReportNumber, refundDocumentFor } from './document-types';
import { buildCreditDocument, buildRefundByTransactionId, type CardcomCreditDocumentInput, type CardcomRefundInput } from './refund-request';

// The two requests of a refund, pure: the money (Transactions/RefundByTransactionId, owner 18.10.2026) and its credit document
// (Documents/CreateDocument, linked to the refund's deal by DealNumbers). Every rule is pinned here, from CardCom's OpenAPI.

const input = (over: Partial<CardcomRefundInput> = {}): CardcomRefundInput => ({
  apiName: 'kalfa-api',
  apiPassword: 'secret',
  operationId: '01a120cb-3c91-7333-8c69-c9933843db5c',
  transactionId: 555,
  amount: 105,
  paidAmount: 105,
  earlierRefund: false,
  ...over,
});

const docInput = (over: Partial<CardcomCreditDocumentInput> = {}): CardcomCreditDocumentInput => ({
  apiName: 'kalfa-api',
  apiPassword: 'secret',
  refundTransactionId: 777,
  amount: 105,
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

describe('buildRefundByTransactionId', () => {
  it('a WHOLE refund of the payment\'s own transaction: its id, the password, our row id — no partial sum, no document', () => {
    expect(buildRefundByTransactionId(input())).toEqual({
      ApiName: 'kalfa-api',
      ApiPassword: 'secret',
      TransactionId: 555,
      ExternalRefundDealId: '01a120cb-3c91-7333-8c69-c9933843db5c',
    });
  });

  it('a PARTIAL refund names its sum', () => {
    expect(buildRefundByTransactionId(input({ amount: 12.5 })).PartialSum).toBe(12.5);
  });

  it('a refund after an earlier one tells CardCom another refund of the transaction is allowed', () => {
    expect(buildRefundByTransactionId(input({ amount: 50, earlierRefund: true }))).toMatchObject({ PartialSum: 50, AllowMultipleRefunds: true });
    expect(buildRefundByTransactionId(input())).not.toHaveProperty('AllowMultipleRefunds');
  });

  it('sends no card and no document: no token, no expiry, no card number', () => {
    expect(Object.keys(buildRefundByTransactionId(input())).sort()).toEqual(['ApiName', 'ApiPassword', 'ExternalRefundDealId', 'TransactionId']);
  });

  it.each([
    ['an empty API name', { apiName: '  ' }],
    ['an empty password', { apiPassword: '' }],
    ['no transaction id', { transactionId: 0 }],
    ['a transaction id that is not a whole number', { transactionId: 55.5 }],
    ['an amount of zero', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['more than whole agorot', { amount: 1.005 }],
    ['more than the payment took', { amount: 106 }],
  ])('refuses %s: nothing is sent that CardCom would have to guess at', (_label, over) => {
    expect(() => buildRefundByTransactionId(input(over as Partial<CardcomRefundInput>))).toThrow();
  });
});

describe('buildCreditDocument', () => {
  it('the credit document of the refund, linked to the REFUND\'s deal, in shekels and Hebrew, for the amount that went back', () => {
    expect(buildCreditDocument(docInput())).toEqual({
      ApiName: 'kalfa-api',
      ApiPassword: 'secret',
      Document: {
        DocumentTypeToCreate: 'ReceiptRefund',
        Name: 'דנה כהן',
        Email: 'dana@example.test',
        Languge: 'he',
        ISOCoinID: 1,
        Products: [{ Description: 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע', Quantity: 1, UnitCost: 105 }],
      },
      DealNumbers: [{ DealNumber: 777 }],
    });
  });

  it('a partial refund\'s document adds up to the amount that went back', () => {
    expect(buildCreditDocument(docInput({ amount: 12.5 })).Document?.Products?.[0]?.UnitCost).toBe(12.5);
  });

  it('a tax invoice + receipt is credited by its own counterpart', () => {
    expect(buildCreditDocument(docInput({ document: refundDocumentFor('TaxInvoiceAndReceipt')! })).Document?.DocumentTypeToCreate).toBe('TaxInvoiceAndReceiptRefund');
  });

  it('no email: the document carries none (CardCom then sends it nowhere)', () => {
    expect(buildCreditDocument(docInput({ holder: { name: 'דנה', email: null } })).Document).not.toHaveProperty('Email');
  });

  it('names and emails longer than CardCom accepts (50) are cut, never refused', () => {
    const r = buildCreditDocument(docInput({ holder: { name: 'א'.repeat(60), email: `${'a'.repeat(60)}@x.test` } }));
    expect(r.Document?.Name).toHaveLength(50);
    expect(r.Document?.Email).toHaveLength(50);
  });

  it.each([
    ['an empty API name', { apiName: '  ' }],
    ['an empty password', { apiPassword: '' }],
    ['no refund transaction id', { refundTransactionId: 0 }],
    ['a refund transaction id that is not a whole number', { refundTransactionId: 7.5 }],
    ['no cardholder name', { holder: { name: ' ', email: null } }],
    ['an amount of zero', { amount: 0 }],
    ['more than whole agorot', { amount: 1.005 }],
    ['an empty document line', { line: ' ' }],
  ])('refuses %s: no tax document is asked for that CardCom would have to guess at', (_label, over) => {
    expect(() => buildCreditDocument(docInput(over as Partial<CardcomCreditDocumentInput>))).toThrow();
  });
});
