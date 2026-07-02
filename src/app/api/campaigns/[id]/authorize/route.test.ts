import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({
  getCampaignForHold: vi.fn(),
  lockCampaignForHold: vi.fn(),
  prepareCampaignHold: vi.fn(),
  recordCampaignHold: vi.fn(),
  markCampaignHoldFailed: vi.fn(),
}));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getCampaignHoldsEnabled: vi.fn(),
  getSumitServerConfig: vi.fn(),
}));
vi.mock('@/lib/sumit/authorize', () => ({ authorizeHoldSumit: vi.fn() }));

import { POST } from './route';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import {
  getCampaignForHold,
  lockCampaignForHold,
  prepareCampaignHold,
  recordCampaignHold,
} from '@/lib/data/campaigns';
import {
  getPaymentsEnabled,
  getCampaignHoldsEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import { authorizeHoldSumit } from '@/lib/sumit/authorize';

const APP_ORIGIN = 'https://kalfa.test';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function request(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: APP_ORIGIN },
): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request(`${APP_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: form.toString(),
  }) as unknown as NextRequest;
}

function callPost(req: NextRequest) {
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

describe('POST /api/campaigns/[id]/authorize — CSRF origin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requireUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@test.com',
    } as never);
    vi.mocked(getCampaignForHold).mockResolvedValue({
      id: CAMPAIGN_ID,
      event_id: EVENT_ID,
      status: 'approved',
      max_charge_ceiling: 100,
      capture_status: null,
    } as never);
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: EVENT_ID,
      name: 'Test Event',
      status: 'active',
      // Well into the future — never "past" regardless of when this runs.
      event_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      rsvp_deadline: null,
    } as never);
    vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
    vi.mocked(getCampaignHoldsEnabled).mockResolvedValue(true);
    vi.mocked(getSumitServerConfig).mockResolvedValue({
      companyId: 1,
      apiKey: 'k',
    });
    vi.mocked(lockCampaignForHold).mockResolvedValue(true);
    vi.mocked(prepareCampaignHold).mockResolvedValue({
      holdAmount: 80,
      ceiling: 100,
      full: 10,
      covered: 8,
    });
    vi.mocked(authorizeHoldSumit).mockResolvedValue({
      authNumber: 'auth-1',
      cardToken: 'tok-1',
      expMonth: 1,
      expYear: 2030,
      citizenId: '123456789',
    });
    vi.mocked(recordCampaignHold).mockResolvedValue(undefined);
  });

  it('reaches authorizeHoldSumit for a same-origin POST', async () => {
    const res = await callPost(
      request({ 'og-token': 'og-123' }, { Origin: APP_ORIGIN }),
    );
    expect(authorizeHoldSumit).toHaveBeenCalled();
    expect(res.status).toBe(303);
  });

  it('rejects a cross-origin POST with 403, without calling authorizeHoldSumit', async () => {
    const res = await callPost(
      request({ 'og-token': 'og-123' }, { Origin: 'https://evil.test' }),
    );
    expect(res.status).toBe(403);
    expect(authorizeHoldSumit).not.toHaveBeenCalled();
  });

  it('rejects a POST with no Origin and no Referer with 403, without calling authorizeHoldSumit', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }, {}));
    expect(res.status).toBe(403);
    expect(authorizeHoldSumit).not.toHaveBeenCalled();
  });
});
