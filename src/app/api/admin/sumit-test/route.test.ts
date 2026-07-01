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

function request(fields: Record<string, string>): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request(`${APP_ORIGIN}/api/admin/sumit-test`, {
    method: 'POST',
    headers: {
      Origin: APP_ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }) as unknown as NextRequest;
}

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
      }),
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
