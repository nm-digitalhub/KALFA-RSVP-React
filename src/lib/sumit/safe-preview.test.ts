import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { summarizeSumitRequest, summarizeSumitResponse } from '@/lib/sumit/safe-preview';

// The admin SUMIT POC must NEVER surface secrets/PII to the browser. These tests
// pin the STRICT explicit-projection contract: the output is a flat object with a
// fixed, known set of keys. Every secret/identifier is either reduced to a boolean
// or never emitted. Sentinel values are planted in every forbidden field and must
// not appear anywhere in the serialized output. Any unknown/future key is dropped
// (enforced by an exact allow-list key-set assertion).

function obj(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}
function flat(v: unknown): string {
  return JSON.stringify(v);
}

// Sentinels that must NEVER appear in any projected output.
const SENTINELS = [
  'EXTERNAL-ID-MUST-NOT-LEAK',
  'COMPANY-ID-MUST-NOT-LEAK',
  'EMAIL-MUST-NOT-LEAK',
  'STATUS-DESCRIPTION-MUST-NOT-LEAK',
  'APIKEY-MUST-NOT-LEAK',
  'TOKEN-MUST-NOT-LEAK',
  'OGTOKEN-MUST-NOT-LEAK',
  'CITIZENID-MUST-NOT-LEAK',
  'PAN-MUST-NOT-LEAK',
  'CVV-MUST-NOT-LEAK',
  'TRACK2-MUST-NOT-LEAK',
  'AUTHNUMBER-MUST-NOT-LEAK',
  'UNKNOWN-MUST-NOT-LEAK',
];

const RESPONSE_ALLOWED_KEYS = [
  'status',
  'valid_payment',
  'amount',
  'currency',
  'document_id',
  'document_number',
  'payment_id',
  'provider_error_code',
  'card_last_digits',
  'card_mask',
  'has_auth_number',
  'has_card_token',
].sort();

const REQUEST_ALLOWED_KEYS = [
  'company_id_present',
  'amount',
  'vat_rate',
  'auto_capture',
  'authorize_amount',
  'prevent_document_creation',
  'card_token_present',
  'og_token_present',
  'customer_email_present',
  'external_id_present',
  'payment_method_type',
].sort();

const RESPONSE = {
  Data: {
    Payment: {
      ID: 55,
      CustomerID: 999,
      Date: '2026-07-01T05:35:04+03:00',
      ValidPayment: true,
      Status: '000',
      StatusDescription: 'STATUS-DESCRIPTION-MUST-NOT-LEAK',
      Amount: 12.5,
      Currency: 0,
      PaymentMethod: {
        ID: 2078931957,
        CreditCard_Number: 'PAN-MUST-NOT-LEAK',
        CreditCard_CVV: 'CVV-MUST-NOT-LEAK',
        CreditCard_Track2: 'TRACK2-MUST-NOT-LEAK',
        CreditCard_LastDigits: '9183',
        CreditCard_CardMask: 'XXXXXXXXXXXX9183',
        CreditCard_ExpirationMonth: 7,
        CreditCard_ExpirationYear: 2031,
        CreditCard_CitizenID: 'CITIZENID-MUST-NOT-LEAK',
        CreditCard_Token: 'TOKEN-MUST-NOT-LEAK',
        Type: 1,
        SecretFutureField: 'UNKNOWN-MUST-NOT-LEAK',
      },
      AuthNumber: 'AUTHNUMBER-MUST-NOT-LEAK',
    },
    DocumentID: 4001,
    DocumentNumber: 27,
    CustomerID: 999,
    DocumentDownloadURL: 'https://example/doc',
    ExternalIdentifier: 'EXTERNAL-ID-MUST-NOT-LEAK',
    SecretFutureDataField: 'UNKNOWN-MUST-NOT-LEAK',
  },
  Status: 0,
  UserErrorMessage: null,
  TechnicalErrorDetails: null,
  SecretFutureTopField: 'UNKNOWN-MUST-NOT-LEAK',
};

describe('summarizeSumitResponse', () => {
  it('emits EXACTLY the allow-listed keys (no unknown/future keys)', () => {
    const out = summarizeSumitResponse(RESPONSE);
    expect(Object.keys(out).sort()).toEqual(RESPONSE_ALLOWED_KEYS);
  });

  it('never leaks any sentinel value', () => {
    const s = flat(summarizeSumitResponse(RESPONSE));
    for (const sentinel of SENTINELS) expect(s).not.toContain(sentinel);
  });

  it('keeps the approved safe values, and AuthNumber/token only as booleans', () => {
    const out = obj(summarizeSumitResponse(RESPONSE));
    expect(out.status).toBe(0);
    expect(out.valid_payment).toBe(true);
    expect(out.amount).toBe(12.5);
    expect(out.currency).toBe(0);
    expect(out.document_id).toBe(4001);
    expect(out.document_number).toBe(27);
    expect(out.payment_id).toBe(55);
    expect(out.provider_error_code).toBe('000');
    expect(out.card_last_digits).toBe('9183');
    expect(out.card_mask).toBe('XXXXXXXXXXXX9183');
    expect(out.has_auth_number).toBe(true);
    expect(out.has_card_token).toBe(true);
  });

  it('has_auth_number/has_card_token are false when absent', () => {
    const out = obj(summarizeSumitResponse({ Data: { Payment: { PaymentMethod: {} } }, Status: 0 }));
    expect(out.has_auth_number).toBe(false);
    expect(out.has_card_token).toBe(false);
  });

  it('handles a non-object body without echoing it', () => {
    expect(summarizeSumitResponse('unexpected raw text')).toEqual({ non_object_response: true });
    expect(summarizeSumitResponse(null)).toEqual({ non_object_response: true });
  });
});

const REQUEST = {
  Credentials: { CompanyID: 'COMPANY-ID-MUST-NOT-LEAK', APIKey: 'APIKEY-MUST-NOT-LEAK' },
  Customer: { EmailAddress: 'EMAIL-MUST-NOT-LEAK', ExternalIdentifier: 'EXTERNAL-ID-MUST-NOT-LEAK' },
  VATIncluded: true,
  VATRate: 18,
  Items: [{ Quantity: 1, UnitPrice: 12.5, Item: { Name: 'POC' }, Description: 'POC' }],
  AutoCapture: false,
  AuthorizeAmount: 50,
  PreventDocumentCreation: true,
  SendDocumentByEmail: false,
  DraftDocument: false,
  SingleUseToken: 'OGTOKEN-MUST-NOT-LEAK',
  PaymentMethod: { CreditCard_Token: 'TOKEN-MUST-NOT-LEAK', Type: 1 },
  SecretFutureField: 'UNKNOWN-MUST-NOT-LEAK',
};

describe('summarizeSumitRequest', () => {
  it('emits EXACTLY the allow-listed keys (no unknown/future keys)', () => {
    const out = summarizeSumitRequest(REQUEST);
    expect(Object.keys(out).sort()).toEqual(REQUEST_ALLOWED_KEYS);
  });

  it('never leaks any sentinel value (CompanyID, email, external id, API key, tokens)', () => {
    const s = flat(summarizeSumitRequest(REQUEST));
    for (const sentinel of SENTINELS) expect(s).not.toContain(sentinel);
  });

  it('projects the approved values, identifiers only as booleans', () => {
    const out = obj(summarizeSumitRequest(REQUEST));
    expect(out.company_id_present).toBe(true);
    expect(out.amount).toBe(12.5);
    expect(out.vat_rate).toBe(18);
    expect(out.auto_capture).toBe(false);
    expect(out.authorize_amount).toBe(50);
    expect(out.prevent_document_creation).toBe(true);
    expect(out.card_token_present).toBe(true);
    expect(out.og_token_present).toBe(true);
    expect(out.customer_email_present).toBe(true);
    expect(out.external_id_present).toBe(true);
    expect(out.payment_method_type).toBe(1);
  });

  it('handles a non-object input safely', () => {
    expect(summarizeSumitRequest(undefined)).toEqual({});
    expect(summarizeSumitRequest('x')).toEqual({});
  });
});
