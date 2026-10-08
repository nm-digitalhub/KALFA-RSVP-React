import { describe, expect, it } from 'vitest';

import { buildCreateLowProfile, type CardcomCreateInput } from './create-request';

// The request that opens a CardCom payment session (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, 4.3). The
// rules come from CardCom's integration guide: Document.Products add up to Amount, the document is "Auto" and editable,
// a name is required, the operation is ChargeOnly. Everything the buyer could bend (price, products) comes from the
// ledger lines the caller read on the server.

const input = (over: Partial<CardcomCreateInput> = {}): CardcomCreateInput => ({
  terminalNumber: 1001,
  apiName: 'kalfa-api',
  operationId: '0199-op',
  lines: [{ description: 'KALFA — חבילת אישורי הגעה לאירוע', unitPrice: 149 }],
  payer: { name: 'דנה כהן', email: 'dana@example.com', phone: '0501234567' },
  webhookUrl: 'https://beta.kalfa.me/api/cardcom/webhook',
  returnUrl: 'https://beta.kalfa.me/app/events/e1/campaign/c1/payment',
  ...over,
});

describe('buildCreateLowProfile', () => {
  it('opens a ChargeOnly session in shekels, in Hebrew, with the operation id as the reference', () => {
    const r = buildCreateLowProfile(input());
    expect(r).toMatchObject({
      TerminalNumber: 1001,
      ApiName: 'kalfa-api',
      Operation: 'ChargeOnly',
      ReturnValue: '0199-op',
      Amount: 149,
      ISOCoinId: 1,
      Language: 'he',
      WebHookUrl: 'https://beta.kalfa.me/api/cardcom/webhook',
    });
  });

  it('sends the buyer back to the payment page whatever the outcome', () => {
    const r = buildCreateLowProfile(input());
    expect(r.SuccessRedirectUrl).toBe('https://beta.kalfa.me/app/events/e1/campaign/c1/payment');
    expect(r.FailedRedirectUrl).toBe('https://beta.kalfa.me/app/events/e1/campaign/c1/payment');
  });

  it('builds the document the guide demands: Auto, editable, named, in Hebrew, with the lines as products', () => {
    const doc = buildCreateLowProfile(input()).Document;
    expect(doc).toMatchObject({
      DocumentTypeToCreate: 'Auto',
      IsAllowEditDocument: true,
      Name: 'דנה כהן',
      Email: 'dana@example.com',
      Language: 'he',
      Products: [{ Description: 'KALFA — חבילת אישורי הגעה לאירוע', UnitCost: 149, Quantity: 1 }],
    });
  });

  it('prefills what the buyer already told us', () => {
    expect(buildCreateLowProfile(input()).UIDefinition).toMatchObject({
      CardOwnerNameValue: 'דנה כהן',
      CardOwnerEmailValue: 'dana@example.com',
      CardOwnerPhoneValue: '0501234567',
    });
  });

  it('omits the phone prefill when there is none', () => {
    expect(buildCreateLowProfile(input({ payer: { name: 'דנה', email: 'd@e.com' } })).UIDefinition).not.toHaveProperty('CardOwnerPhoneValue');
  });

  it('the amount is the sum of the lines, to the agora, with several lines and quantities', () => {
    const r = buildCreateLowProfile(input({
      lines: [
        { description: 'חבילה', unitPrice: 100.5 },
        { description: 'תוספת', quantity: 2, unitPrice: 24.99 },
      ],
    }));
    expect(r.Amount).toBe(150.48);
    expect(r.Document?.Products).toHaveLength(2);
  });

  it('sums in whole agorot, so ten times 0.10 is exactly 1', () => {
    expect(buildCreateLowProfile(input({ lines: [{ description: 'x', quantity: 10, unitPrice: 0.1 }] })).Amount).toBe(1);
  });

  it.each([
    ['no lines', { lines: [] }],
    ['a deduction (a credit line cannot be a product)', { lines: [{ description: 'a', unitPrice: 100 }, { description: 'קרדיט', unitPrice: -10 }] }],
    ['a zero price', { lines: [{ description: 'a', unitPrice: 0 }] }],
    ['a price in fractions of an agora', { lines: [{ description: 'a', unitPrice: 10.005 }] }],
    ['a blank description', { lines: [{ description: '  ', unitPrice: 10 }] }],
    ['a blank buyer name', { payer: { name: '  ', email: 'a@b.com' } }],
    ['a blank terminal API name', { apiName: ' ' }],
  ])('refuses %s', (_label, over) => {
    expect(() => buildCreateLowProfile(input(over as Partial<CardcomCreateInput>))).toThrow();
  });

  it('never carries the API password: a session is opened with the name only', () => {
    expect(JSON.stringify(buildCreateLowProfile(input()))).not.toMatch(/password/i);
  });
});
