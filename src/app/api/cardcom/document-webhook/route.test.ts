import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { deliveryMock, eventsMock, secretMock } = vi.hoisted(() => ({
  deliveryMock: vi.fn(),
  eventsMock: vi.fn(),
  secretMock: vi.fn(),
}));
vi.mock('@/lib/data/webhooks', () => ({ insertWebhookDelivery: deliveryMock, insertWebhookEvents: eventsMock }));
vi.mock('@/lib/data/cardcom-document-intake', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/cardcom-document-intake')>()),
  readDocumentReportSecret: secretMock,
}));

import { POST } from './route';

// CardCom posts every issued document here as Name=Value pairs (article 360007138014). The route checks the shared secret,
// stores the report without it through the webhook intake, and answers 200 — the worker decides what the document means.

const APP_ORIGIN = 'https://kalfa.test';
const SECRET = 'A1b2C3d4E5f6G7h8I9j0K1l2';
const REPORT = {
  BillGoldCompID: 'b31cff41-4f38-433a-b8bc-cf5461e9ae5e',
  DocType: '3',
  DocNumber: '1006',
  'ExtReadInvoiceHead.TotalIncludeVAT': '1',
  'ExtShvaParams.CardHolderIdentityNumber': '040000000',
};

let ipCounter = 0;
function post(fields: Record<string, string>, query = '', headers: Record<string, string> = {}) {
  ipCounter += 1;
  return POST(
    new Request(`${APP_ORIGIN}/api/cardcom/document-webhook${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `10.0.0.${ipCounter}`, ...headers },
      body: new URLSearchParams(fields).toString(),
    }) as unknown as NextRequest,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ORIGIN = APP_ORIGIN;
  secretMock.mockResolvedValue(SECRET);
  deliveryMock.mockResolvedValue('delivery-1');
  eventsMock.mockResolvedValue(undefined);
});

describe('POST /api/cardcom/document-webhook', () => {
  it('stores the whole report, ID number included, but never the secret — and answers 200', async () => {
    const res = await post({ ...REPORT, secret: SECRET });
    expect(res.status).toBe(200);
    const stored = { ...REPORT };
    expect(deliveryMock).toHaveBeenCalledWith({ provider: 'cardcom', raw: JSON.stringify(stored), body: stored });
    expect(eventsMock).toHaveBeenCalledWith([
      { provider: 'cardcom', event_kind: 'cardcom_document', dedupe_key: '3:1006', payload: stored, delivery_id: 'delivery-1' },
    ]);
    expect(JSON.stringify([deliveryMock.mock.calls, eventsMock.mock.calls])).not.toContain(SECRET);
  });

  it('accepts the secret in the URL query as well as in the body', async () => {
    expect((await post(REPORT, `?secret=${SECRET}`)).status).toBe(200);
    expect(JSON.stringify(eventsMock.mock.calls)).not.toContain(SECRET);
  });

  it.each([
    ['no secret', {}],
    ['a wrong secret', { secret: 'B1b2C3d4E5f6G7h8I9j0K1l2' }],
    ['a secret of another length', { secret: 'short' }],
  ])('refuses %s with 401 and stores nothing', async (_label, extra) => {
    expect((await post({ ...REPORT, ...extra })).status).toBe(401);
    expect(deliveryMock).not.toHaveBeenCalled();
    expect(eventsMock).not.toHaveBeenCalled();
  });

  it('refuses every report while no secret is saved', async () => {
    secretMock.mockResolvedValue(null);
    expect((await post({ ...REPORT, secret: SECRET })).status).toBe(401);
    expect(eventsMock).not.toHaveBeenCalled();
  });

  it('answers 400 to a post that names no document', async () => {
    expect((await post({ BillGoldCompID: REPORT.BillGoldCompID, secret: SECRET })).status).toBe(400);
    expect(eventsMock).not.toHaveBeenCalled();
  });

  it('falls back to the document head fields for the duplicate key', async () => {
    await post({ 'ExtReadInvoiceHead.InvoiceType': '4', 'ExtReadInvoiceHead.InvoiceNumber': '77', secret: SECRET });
    expect(eventsMock.mock.calls[0][0][0].dedupe_key).toBe('4:77');
  });

  it('still stores the event when the diagnostic copy could not be kept', async () => {
    deliveryMock.mockResolvedValue(null);
    expect((await post({ ...REPORT, secret: SECRET })).status).toBe(200);
    expect(eventsMock.mock.calls[0][0][0].delivery_id).toBeNull();
  });

  it('answers 500 when the event cannot be stored, so CardCom posts again — and logs no report data', async () => {
    eventsMock.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post({ ...REPORT, secret: SECRET })).status).toBe(500);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('040000000');
  });

  it('refuses a body larger than a report can be', async () => {
    expect((await post({ ...REPORT, secret: SECRET, filler: 'x'.repeat(70_000) })).status).toBe(413);
    expect(eventsMock).not.toHaveBeenCalled();
  });
});
