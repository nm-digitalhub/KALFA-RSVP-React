import { describe, expect, it } from 'vitest';

import { mapSumitChargeResponse } from './charge-response';


// Shape of a live J5 response (field names from SUMIT's swagger). Values are
// fixtures, not real card data.
const J5_RESPONSE = {
  Status: 0,
  UserErrorMessage: null,
  TechnicalErrorDetails: null,
  Data: {
    CustomerID: 2127277236,
    DocumentID: null,
    DocumentNumber: null,
    DocumentDownloadURL: null,
    Payment: {
      ID: 0,
      CustomerID: 2127277236,
      Date: '2026-09-29T20:30:00',
      ValidPayment: true,
      Status: '000',
      StatusDescription: 'מאושר',
      Amount: 2,
      Currency: 0,
      AuthNumber: '0759469',
      FirstPaymentAmount: null,
      NonFirstPaymentAmount: null,
      RecurringCustomerItemIDs: [],
      PaymentMethod: {
        ID: 2127277247,
        CustomerID: 2127277236,
        CreditCard_Number: '4580000000000000',
        CreditCard_LastDigits: '9183',
        CreditCard_ExpirationMonth: 7,
        CreditCard_ExpirationYear: 2031,
        CreditCard_CVV: '123',
        CreditCard_Track2: 'x',
        CreditCard_CitizenID: '000000018',
        CreditCard_CardMask: '458000******9183',
        CreditCard_Token: '11111111-2222-3333-4444-555555555555',
        DirectDebit_Bank: null,
        DirectDebit_Branch: null,
        DirectDebit_Account: null,
        DirectDebit_ExpirationDate: null,
        DirectDebit_MaximumAmount: null,
        Type: 1,
      },
    },
  },
};

describe('mapSumitChargeResponse', () => {
  it('maps every returned field to its own column', () => {
    const row = mapSumitChargeResponse(J5_RESPONSE);
    expect(row).toMatchObject({
      status: '0',
      data_customer_id: 2127277236,
      payment_id: 0,
      payment_customer_id: 2127277236,
      payment_date: '2026-09-29T20:30:00',
      payment_valid_payment: true,
      payment_status: '000',
      payment_status_description: 'מאושר',
      payment_amount: 2,
      payment_currency: '0',
      payment_auth_number: '0759469',
      payment_recurring_customer_item_ids: [],
      payment_method_id: 2127277247,
      payment_method_customer_id: 2127277236,
      payment_method_last_digits: '9183',
      payment_method_expiration_month: 7,
      payment_method_expiration_year: 2031,
      payment_method_citizen_id: '000000018',
      payment_method_card_mask: '458000******9183',
      payment_method_token: '11111111-2222-3333-4444-555555555555',
      payment_method_type: '1',
      response_text: null,
    });
  });

  it('never keeps the full card number, CVV or Track2 — not even in the stored body', () => {
    const row = mapSumitChargeResponse(J5_RESPONSE);
    const stored = JSON.stringify(row.response);
    expect(stored).not.toContain('CreditCard_Number');
    expect(stored).not.toContain('4580000000000000');
    expect(stored).not.toContain('CreditCard_CVV');
    expect(stored).not.toContain('CreditCard_Track2');
    // Everything else is kept.
    expect(stored).toContain('CreditCard_LastDigits');
    expect(stored).toContain('AuthNumber');
  });

  it('keeps enum values as SUMIT sent them (numbers from the live API, strings from the swagger)', () => {
    expect(mapSumitChargeResponse({ Status: 1 }).status).toBe('1');
    expect(mapSumitChargeResponse({ Status: 'BusinessError (1)' }).status).toBe('BusinessError (1)');
  });

  it('keeps the error texts of a rejected call', () => {
    const row = mapSumitChargeResponse({
      Status: 1,
      UserErrorMessage: 'Invalid CreditCard_Token (Guid expected)',
      TechnicalErrorDetails: 'details',
      Data: null,
    });
    expect(row.user_error_message).toBe('Invalid CreditCard_Token (Guid expected)');
    expect(row.technical_error_details).toBe('details');
    expect(row.payment_auth_number).toBeNull();
  });

  it('stores a non-JSON body as text', () => {
    const row = mapSumitChargeResponse('<html>502</html>');
    expect(row.response).toBeNull();
    expect(row.response_text).toBe('<html>502</html>');
  });
});
