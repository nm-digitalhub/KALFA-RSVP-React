import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { summarizeSumitRequest, summarizeSumitResponse } from '@/lib/sumit/safe-preview';

// The admin SUMIT POC must NEVER surface secrets/PII to the browser. These tests
// pin the allow-list PROJECTION contract: approved fields pass through; secret/PII
// fields become booleans or are omitted; and — crucially — any field NOT on the
// allow-list (including a hypothetical future provider field) is dropped.

// Narrow an unknown projection node to an indexable record (no `any`).
function obj(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}
function flatten(v: unknown): string {
  return JSON.stringify(v);
}

// A full, realistic charge response (shape per docs/sumit-response-capture-and-audit.md §7a),
// deliberately including every forbidden field with a real-looking value.
const FULL_RESPONSE = {
  Data: {
    Payment: {
      ID: 0,
      CustomerID: 0,
      Date: '2026-07-01T05:35:04+03:00',
      ValidPayment: true,
      Status: '000',
      StatusDescription: 'מאושר (קוד 000)',
      Amount: 1,
      Currency: 0,
      PaymentMethod: {
        ID: 2078931957,
        CreditCard_Number: '4580000000000000', // PAN — must never surface
        CreditCard_CVV: '123', // SAD — must never surface
        CreditCard_Track2: 'trackdata', // SAD — must never surface
        CreditCard_LastDigits: '9183',
        CreditCard_CardMask: 'XXXXXXXXXXXX9183',
        CreditCard_ExpirationMonth: 7,
        CreditCard_ExpirationYear: 2031,
        CreditCard_CitizenID: '312345678', // PII — must never surface
        CreditCard_Token: 'reusable-secret-token', // secret — must never surface
        Type: 1,
        SecretFutureField: 'leaked?', // unknown field — must be dropped by allow-list
      },
      AuthNumber: '0012345', // must never surface (value)
    },
    DocumentID: null,
    DocumentNumber: null,
    CustomerID: 2078931956,
    DocumentDownloadURL: null,
    SecretFutureDataField: 'leaked?', // unknown — must be dropped
  },
  Status: 0,
  UserErrorMessage: null,
  TechnicalErrorDetails: null,
  SecretFutureTopField: 'leaked?', // unknown — must be dropped
};

describe('summarizeSumitResponse', () => {
  it('never surfaces the raw secret/PII VALUES anywhere in the output', () => {
    const s = flatten(summarizeSumitResponse(FULL_RESPONSE));
    for (const secret of [
      '4580000000000000',
      '312345678',
      'reusable-secret-token',
      '0012345',
      'trackdata',
    ]) {
      expect(s).not.toContain(secret);
    }
  });

  it('reduces AuthNumber to a boolean has_auth_number (never the value, never partial)', () => {
    const payment = obj(obj(obj(summarizeSumitResponse(FULL_RESPONSE)).Data).Payment);
    expect(payment.has_auth_number).toBe(true);
    expect('AuthNumber' in payment).toBe(false);
    // absent AuthNumber → false
    const noAuth = obj(
      obj(obj(summarizeSumitResponse({ Data: { Payment: {} }, Status: 0 })).Data).Payment,
    );
    expect(noAuth.has_auth_number).toBe(false);
  });

  it('reduces token + citizenID to booleans and drops PAN/CVV/Track2 entirely', () => {
    const pm = obj(
      obj(obj(obj(summarizeSumitResponse(FULL_RESPONSE)).Data).Payment).PaymentMethod,
    );
    expect(pm.has_card_token).toBe(true);
    expect(pm.has_citizen_id).toBe(true);
    expect('CreditCard_Token' in pm).toBe(false);
    expect('CreditCard_CitizenID' in pm).toBe(false);
    expect('CreditCard_Number' in pm).toBe(false);
    expect('CreditCard_CVV' in pm).toBe(false);
    expect('CreditCard_Track2' in pm).toBe(false);
  });

  it('keeps the approved safe fields', () => {
    const out = obj(summarizeSumitResponse(FULL_RESPONSE));
    expect(out.Status).toBe(0);
    const data = obj(out.Data);
    expect(data.CustomerID).toBe(2078931956);
    const p = obj(data.Payment);
    expect(p.ValidPayment).toBe(true);
    expect(p.Status).toBe('000');
    expect(p.Amount).toBe(1);
    expect(p.Currency).toBe(0);
    const pm = obj(p.PaymentMethod);
    expect(pm.CreditCard_LastDigits).toBe('9183');
    expect(pm.CreditCard_CardMask).toBe('XXXXXXXXXXXX9183');
    expect(pm.CreditCard_ExpirationMonth).toBe(7);
    expect(pm.CreditCard_ExpirationYear).toBe(2031);
    expect(pm.Type).toBe(1);
  });

  it('drops ANY field not on the allow-list (future provider fields cannot leak)', () => {
    const s = flatten(summarizeSumitResponse(FULL_RESPONSE));
    expect(s).not.toContain('SecretFutureField');
    expect(s).not.toContain('SecretFutureDataField');
    expect(s).not.toContain('SecretFutureTopField');
    expect(s).not.toContain('leaked?');
  });

  it('handles a business-error body (Data: null) and a non-object body safely', () => {
    const err = obj(
      summarizeSumitResponse({ Data: null, Status: 1, UserErrorMessage: 'declined' }),
    );
    expect(err.Status).toBe(1);
    expect(err.UserErrorMessage).toBe('declined');
    expect(err.Data).toBeNull();
    // non-object (e.g. plain-text error body) is not echoed verbatim
    expect(summarizeSumitResponse('unexpected raw text')).toEqual({ non_object_response: true });
    expect(summarizeSumitResponse(null)).toEqual({ non_object_response: true });
  });
});

describe('summarizeSumitRequest', () => {
  const FULL_REQUEST = {
    Credentials: { CompanyID: 7, APIKey: '***' },
    Customer: { EmailAddress: 'owner@example.com', ExternalIdentifier: 'poc-123' },
    VATIncluded: true,
    VATRate: 18,
    Items: [{ Quantity: 1, UnitPrice: 1, Item: { Name: 'POC' }, Description: 'POC' }],
    AutoCapture: false,
    AuthorizeAmount: 50,
    PreventDocumentCreation: true,
    SendDocumentByEmail: false,
    DraftDocument: false,
    SingleUseToken: 'og-single-use-secret',
    PaymentMethod: { CreditCard_Token: 'saved-secret-token', Type: 1 },
    SecretFutureField: 'leaked?',
  };

  it('never surfaces token values or the customer email value', () => {
    const s = flatten(summarizeSumitRequest(FULL_REQUEST));
    expect(s).not.toContain('og-single-use-secret');
    expect(s).not.toContain('saved-secret-token');
    expect(s).not.toContain('owner@example.com');
    expect(s).not.toContain('leaked?');
  });

  it('reduces tokens to booleans, email to has_email, and keeps only CompanyID from Credentials', () => {
    const out = obj(summarizeSumitRequest(FULL_REQUEST));
    expect(out.has_single_use_token).toBe(true);
    const pm = obj(out.PaymentMethod);
    expect(pm.has_card_token).toBe(true);
    expect(pm.Type).toBe(1);
    const cust = obj(out.Customer);
    expect(cust.has_email).toBe(true);
    expect(cust.ExternalIdentifier).toBe('poc-123');
    expect(out.Credentials).toEqual({ CompanyID: 7 });
    expect('APIKey' in obj(out.Credentials)).toBe(false);
  });

  it('keeps the parameters-under-test and item amounts', () => {
    const out = obj(summarizeSumitRequest(FULL_REQUEST));
    expect(out.AutoCapture).toBe(false);
    expect(out.AuthorizeAmount).toBe(50);
    expect(out.PreventDocumentCreation).toBe(true);
    expect(out.VATRate).toBe(18);
    expect(obj(out).Items).toEqual([
      { Quantity: 1, UnitPrice: 1, Item: { Name: 'POC' }, Description: 'POC' },
    ]);
  });

  it('handles a non-object input safely', () => {
    expect(summarizeSumitRequest(undefined)).toEqual({});
    expect(summarizeSumitRequest('x')).toEqual({});
  });
});
