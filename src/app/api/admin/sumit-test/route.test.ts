import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/sumit/raw-charge', () => ({ chargeRaw: vi.fn() }));

import { POST } from './route';
import { requireAdmin } from '@/lib/auth/dal';
import { getSumitServerConfig } from '@/lib/data/payments';
import { chargeRaw } from '@/lib/sumit/raw-charge';

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
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
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
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
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
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
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
});
