import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn(), isAdmin: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForCharge: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getCloseChargeEnabled: vi.fn(),
  getSumitServerConfig: vi.fn(),
}));
vi.mock('@/lib/data/close-charge', () => ({ closeCampaignAndCharge: vi.fn() }));

import { POST } from './route';
import { requireUser, isAdmin } from '@/lib/auth/dal';
import { getCampaignForCharge } from '@/lib/data/campaigns';
import {
  getPaymentsEnabled,
  getCloseChargeEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';

const APP_ORIGIN = 'https://kalfa.test';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function request(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: APP_ORIGIN },
): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request(
    `${APP_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/close-charge`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: form.toString(),
    },
  ) as unknown as NextRequest;
}

function callPost(req: NextRequest) {
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

describe('POST /api/campaigns/[id]/close-charge — CSRF origin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requireUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getCampaignForCharge).mockResolvedValue({
      id: CAMPAIGN_ID,
      event_id: EVENT_ID,
      status: 'active',
      capture_status: 'authorized',
      charge_status: null,
      card_token_ref: 'tok-1',
      card_exp_month: 1,
      card_exp_year: 2030,
      card_citizen_id: '123456789',
      auth_external_ref: 'auth-1',
      max_charge_ceiling: 100,
    } as never);
    vi.mocked(isAdmin).mockResolvedValue(true);
    vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
    vi.mocked(getCloseChargeEnabled).mockResolvedValue(true);
    vi.mocked(getSumitServerConfig).mockResolvedValue({
      companyId: 1,
      apiKey: 'k',
    });
    vi.mocked(closeCampaignAndCharge).mockResolvedValue({
      outcome: 'charged',
      amount: 80,
    });
  });

  it('reaches closeCampaignAndCharge for a same-origin POST', async () => {
    const res = await callPost(request({}, { Origin: APP_ORIGIN }));
    expect(closeCampaignAndCharge).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(res.status).toBe(303);
  });

  it('rejects a non-admin (owner) with 303 to /app, without calling closeCampaignAndCharge', async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    const res = await callPost(request({}, { Origin: APP_ORIGIN }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${APP_ORIGIN}/app`);
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin POST with 403, without calling closeCampaignAndCharge', async () => {
    const res = await callPost(
      request({}, { Origin: 'https://evil.test' }),
    );
    expect(res.status).toBe(403);
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
  });

  it('rejects a POST with no Origin and no Referer with 403, without calling closeCampaignAndCharge', async () => {
    const res = await callPost(request({}, {}));
    expect(res.status).toBe(403);
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
  });
});
