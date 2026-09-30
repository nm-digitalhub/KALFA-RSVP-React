import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/sumit/raw-charge', () => ({ chargeRaw: vi.fn() }));
vi.mock('@/lib/data/admin/sumit-test-transactions', () => ({
  recordSumitTestTransaction: vi.fn(),
  getTestHoldForCapture: vi.fn(),
}));

import { POST } from './route';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getSumitServerConfig } from '@/lib/data/payments';
import { chargeRaw } from '@/lib/sumit/raw-charge';
import {
  getTestHoldForCapture,
  recordSumitTestTransaction,
} from '@/lib/data/admin/sumit-test-transactions';

const APP_ORIGIN = 'https://kalfa.test';

function request(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: APP_ORIGIN },
): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request(`${APP_ORIGIN}/api/admin/sumit-test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: form.toString(),
  }) as unknown as NextRequest;
}

describe('POST /api/admin/sumit-test — CSRF origin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requirePlatformPermission).mockResolvedValue(undefined as never);
    vi.mocked(getSumitServerConfig).mockResolvedValue({
      companyId: 1,
      apiKey: 'k',
    });
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: {} },
    });
  });

  it('reaches chargeRaw for a same-origin POST', async () => {
    await POST(request({ 'og-token': 'og-123', amount: '1' }, { Origin: APP_ORIGIN }));
    expect(chargeRaw).toHaveBeenCalled();
  });

  it('rejects a cross-origin POST with 403, without calling chargeRaw', async () => {
    const res = await POST(
      request({ 'og-token': 'og-123', amount: '1' }, { Origin: 'https://evil.test' }),
    );
    expect(res.status).toBe(403);
    expect(chargeRaw).not.toHaveBeenCalled();
  });

  it('rejects a POST with no Origin and no Referer with 403, without calling chargeRaw', async () => {
    const res = await POST(request({ 'og-token': 'og-123', amount: '1' }, {}));
    expect(res.status).toBe(403);
    expect(chargeRaw).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/sumit-test — route B (saved-token) mandatory fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requirePlatformPermission).mockResolvedValue(undefined as never);
    vi.mocked(getSumitServerConfig).mockResolvedValue({
      companyId: 1,
      apiKey: 'k',
    });
  });

  // Israeli card issuers require CitizenID (verified: swagger.json's own
  // CreditCard_CitizenID description — "Required when Citizen ID is required
  // by credit company" — is conditional text, but is TRUE for Israel; treat it
  // as a hard requirement here rather than let a malformed request reach SUMIT.
  it('rejects a saved-token charge missing CitizenID, without calling chargeRaw', async () => {
    const res = await POST(
      request({
        saved_token: 'saved-abc',
        amount: '3',
        route_b_exp_month: '7',
        route_b_exp_year: '2031',
        // route_b_citizen_id intentionally omitted
      }),
    );
    const html = await res.text();
    expect(html).toContain('ת״ז');
    expect(chargeRaw).not.toHaveBeenCalled();
  });

  it('rejects a saved-token charge missing expiry, without calling chargeRaw', async () => {
    const res = await POST(
      request({
        saved_token: 'saved-abc',
        amount: '3',
        route_b_citizen_id: '316125434',
        // route_b_exp_month / route_b_exp_year intentionally omitted
      }),
    );
    const html = await res.text();
    expect(html).toContain('תוקף');
    expect(chargeRaw).not.toHaveBeenCalled();
  });

  it('passes exp/citizenId through to chargeRaw when all route-B fields are present', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: {} },
    });

    await POST(
      request({
        saved_token: 'saved-abc',
        amount: '3',
        route_b_exp_month: '7',
        route_b_exp_year: '2031',
        route_b_citizen_id: '316125434',
      }),
    );

    expect(chargeRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        savedCardToken: 'saved-abc',
        savedCardExpMonth: 7,
        savedCardExpYear: 2031,
        savedCardCitizenId: '316125434',
        // Route B IS J4 by design (its form has no auto_capture field at all).
        // Verified live 2026-07-02: omitting this defaulted to AutoCapture:false
        // (a hold) while SUMIT still tried to create a real document, producing
        // "mismatch between items sold and payments received" on every attempt.
        autoCapture: true,
      }),
    );
  });

  it('defaults AutoCapture to true for route B even though its form sends no auto_capture field at all', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: {} },
    });

    await POST(
      request({
        saved_token: 'saved-abc',
        route_b_exp_month: '7',
        route_b_exp_year: '2031',
        route_b_citizen_id: '316125434',
        amount: '3',
        // auto_capture intentionally NOT sent — matches the real route-B form.
      }),
    );

    expect(chargeRaw).toHaveBeenCalledWith(
      expect.objectContaining({ autoCapture: true }),
    );
  });

  it('still defaults AutoCapture to false for a new-card charge when the field is absent (unchanged J5-by-default behavior)', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: {} },
    });

    await POST(request({ 'og-token': 'og-123', amount: '1' }));

    expect(chargeRaw).toHaveBeenCalledWith(
      expect.objectContaining({ autoCapture: false }),
    );
  });

  it('does NOT require route-B fields for a new-card (og-token) charge', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: {} },
    });

    await POST(
      request({
        'og-token': 'og-123',
        amount: '1',
      }),
    );

    expect(chargeRaw).toHaveBeenCalled();
  });
});

describe('POST /api/admin/sumit-test — success/failure banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requirePlatformPermission).mockResolvedValue(undefined as never);
    vi.mocked(getSumitServerConfig).mockResolvedValue({
      companyId: 1,
      apiKey: 'k',
    });
  });

  // The page's outer NextResponse is always HTTP 200 (the diagnostic page
  // itself rendered fine), and SUMIT's own httpStatus is ALSO 200 even for a
  // declined/failed business outcome (verified live 2026-07-02 — SUMIT signals
  // outcome via the JSON body's Status/ValidPayment, not the HTTP status). A
  // reader could mistake "HTTP status: 200" for success; the banner makes the
  // real outcome unambiguous, mirroring the same Status===0 && ValidPayment
  // check authorize.ts/capture.ts already use.
  it('shows a success banner when Status is 0 and ValidPayment is true', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: { Payment: { ValidPayment: true } } },
    });

    const res = await POST(request({ 'og-token': 'og-123', amount: '1' }));
    const html = await res.text();
    expect(html).toContain('אושרה');
    expect(html).not.toContain('נדחתה');
  });

  it('shows a failure banner when ValidPayment is false (business decline, HTTP 200)', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: { Payment: { ValidPayment: false } } },
    });

    const res = await POST(request({ 'og-token': 'og-123', amount: '1' }));
    const html = await res.text();
    expect(html).toContain('נדחתה');
    expect(html).not.toContain('>✅');
  });

  it('shows a failure banner when Status is a business error (Data null, HTTP 200)', async () => {
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 1, Data: null, UserErrorMessage: 'declined' },
    });

    const res = await POST(request({ 'og-token': 'og-123', amount: '1' }));
    const html = await res.text();
    expect(html).toContain('נדחתה');
  });

  // A diagnostic that says "rejected" without saying why is not a diagnosis.
  // The first live itemised charge came back Status 1 with every other field
  // null, and the reason was only findable in SUMIT's own request log. SUMIT's
  // payments.js shows exactly this pair, in this order.
  describe('the failure reason is shown with the banner, not buried in the JSON', () => {
    it("shows SUMIT's UserErrorMessage", async () => {
      vi.mocked(chargeRaw).mockResolvedValue({
        httpStatus: 200,
        ok: true,
        sentBody: {},
        raw: {
          Status: 1,
          UserErrorMessage: 'Invalid CreditCard_Token (Guid expected)',
        },
      });

      const html = await (
        await POST(request({ 'og-token': 'og-123', amount: '1' }))
      ).text();
      expect(html).toContain('הסיבה מ-SUMIT');
      expect(html).toContain('Invalid CreditCard_Token (Guid expected)');
    });

    it('falls back to TechnicalErrorDetails when there is no user-facing message', async () => {
      vi.mocked(chargeRaw).mockResolvedValue({
        httpStatus: 200,
        ok: true,
        sentBody: {},
        raw: { Status: 1, TechnicalErrorDetails: 'ItemsValidation.Failed' },
      });

      const html = await (
        await POST(request({ 'og-token': 'og-123', amount: '1' }))
      ).text();
      expect(html).toContain('ItemsValidation.Failed');
    });

    it('says plainly that SUMIT gave no reason, rather than showing an empty banner', async () => {
      vi.mocked(chargeRaw).mockResolvedValue({
        httpStatus: 200,
        ok: true,
        sentBody: {},
        raw: { Status: 1 },
      });

      const html = await (
        await POST(request({ 'og-token': 'og-123', amount: '1' }))
      ).text();
      expect(html).toContain('לא החזירה נימוק');
    });

    it('escapes the provider string — it is rendered into HTML', async () => {
      vi.mocked(chargeRaw).mockResolvedValue({
        httpStatus: 200,
        ok: true,
        sentBody: {},
        raw: { Status: 1, UserErrorMessage: '<img src=x onerror=alert(1)>' },
      });

      const html = await (
        await POST(request({ 'og-token': 'og-123', amount: '1' }))
      ).text();
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    });

    it('shows no reason block on a successful charge', async () => {
      vi.mocked(chargeRaw).mockResolvedValue({
        httpStatus: 200,
        ok: true,
        sentBody: {},
        raw: {
          Status: 0,
          Data: { Payment: { ValidPayment: true } },
          UserErrorMessage: 'stale',
        },
      });

      const html = await (
        await POST(request({ 'og-token': 'og-123', amount: '1' }))
      ).text();
      expect(html).toContain('אושרה');
      expect(html).not.toContain('הסיבה מ-SUMIT');
    });
  });
});

describe('POST /api/admin/sumit-test — persistence and J5 capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requirePlatformPermission).mockResolvedValue(undefined as never);
    vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    vi.mocked(chargeRaw).mockResolvedValue({
      httpStatus: 200,
      ok: true,
      sentBody: {},
      raw: { Status: 0, Data: { Payment: { ValidPayment: true, AuthNumber: '0759469' } } },
    });
    vi.mocked(recordSumitTestTransaction).mockResolvedValue('row-1');
  });

  it('saves every J5 hold with the raw response', async () => {
    await POST(request({ 'og-token': 'og-1', amount: '2', auto_capture: 'false' }));
    expect(recordSumitTestTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'hold',
        requestAutoCapture: false,
        raw: { Status: 0, Data: { Payment: { ValidPayment: true, AuthNumber: '0759469' } } },
      }),
    );
  });

  it('still shows the live result when saving fails', async () => {
    vi.mocked(recordSumitTestTransaction).mockRejectedValue(new Error('db down'));
    const res = await POST(request({ 'og-token': 'og-1', amount: '2', auto_capture: 'false' }));
    const html = await res.text();
    expect(html).toContain('עסקה אושרה');
    expect(html).toContain('שמירת התוצאה בטבלת הבדיקות נכשלה');
  });

  it('captures a hold by its AuthNumber, resolved server-side, without AutoCapture', async () => {
    vi.mocked(getTestHoldForCapture).mockResolvedValue({
      id: 'hold-1',
      authNumber: '0759469',
      cardToken: 'tok',
      expMonth: 7,
      expYear: 2031,
      citizenId: '000000018',
      customerId: 2127277236,
      externalIdentifier: 'poc-1759178413000',
      holdAmount: 2,
      capturedAmount: 0,
    });
    await POST(request({ mode: 'capture', hold_id: 'hold-1', amount: '1' }));
    const params = vi.mocked(chargeRaw).mock.calls[0][0];
    expect(params.creditCardAuthNumber).toBe('0759469');
    expect(params.autoCapture).toBeUndefined();
    expect(params.customerId).toBe(2127277236);
    expect(params.savedCardToken).toBe('tok');
    expect(params.externalId).toBe('poc-1759178413000');
    expect(recordSumitTestTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'capture', parentId: 'hold-1', requestAmount: 1 }),
    );
  });

  it('does not call SUMIT when the chosen hold is not capturable', async () => {
    vi.mocked(getTestHoldForCapture).mockResolvedValue(null);
    const res = await POST(request({ mode: 'capture', hold_id: 'hold-1', amount: '1' }));
    expect(chargeRaw).not.toHaveBeenCalled();
    expect(await res.text()).toContain('תפיסת המסגרת שנבחרה לא תקינה');
  });

  it('refuses to capture more than what is left on the hold, without calling SUMIT', async () => {
    vi.mocked(getTestHoldForCapture).mockResolvedValue({
      id: 'hold-1',
      authNumber: '0759469',
      cardToken: 'tok',
      expMonth: 7,
      expYear: 2031,
      citizenId: '000000018',
      customerId: 2127277236,
      externalIdentifier: 'poc-1',
      holdAmount: 1,
      capturedAmount: 1,
    });
    const res = await POST(request({ mode: 'capture', hold_id: 'hold-1', amount: '1' }));
    expect(chargeRaw).not.toHaveBeenCalled();
    expect(await res.text()).toContain('המסגרת כבר מומשה במלואה');
  });
});
