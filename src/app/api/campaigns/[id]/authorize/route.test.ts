import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({
  activateCampaign: vi.fn(),
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
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/sumit-customers', () => ({
  getSumitCustomerId: vi.fn(),
  recordSumitCustomerId: vi.fn(),
}));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

import { POST } from './route';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import {
  activateCampaign,
  getCampaignForHold,
  lockCampaignForHold,
  markCampaignHoldFailed,
  prepareCampaignHold,
  recordCampaignHold,
} from '@/lib/data/campaigns';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import {
  getPaymentsEnabled,
  getCampaignHoldsEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import { authorizeHoldSumit } from '@/lib/sumit/authorize';
import { getSumitCustomerId, recordSumitCustomerId } from '@/lib/data/sumit-customers';
import { logActivity } from '@/lib/data/activity';

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

// The happy-path wiring every describe below starts from: same-origin, owner
// session, approved future-dated campaign, all gates on, SUMIT confirms the hold.
function happyPath() {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = APP_ORIGIN;
    vi.mocked(requireUser).mockResolvedValue({
      id: 'user-1',
      email: 'user@test.com',
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      id: 'user-1',
      full_name: 'ישראל ישראלי',
      phone: null,
      updated_at: null,
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
    vi.mocked(getSumitCustomerId).mockResolvedValue(null);
    vi.mocked(recordSumitCustomerId).mockResolvedValue(undefined);
    vi.mocked(logActivity).mockResolvedValue(undefined);
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
      orderDocumentId: 555,
      orderDocumentNumber: 1001,
      orderDocumentUrl: 'https://api.sumit.co.il/docs/555',
      sumitCustomerId: 777,
    });
    vi.mocked(recordCampaignHold).mockResolvedValue(undefined);
    vi.mocked(activateCampaign).mockResolvedValue(undefined);
}

describe('POST /api/campaigns/[id]/authorize — CSRF origin gate', () => {
  beforeEach(happyPath);

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

describe('POST /api/campaigns/[id]/authorize — auto-activation after a confirmed hold (audit §1)', () => {
  beforeEach(happyPath);

  it('activates the campaign right after the hold is persisted and lands on ?held=1', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(recordCampaignHold).toHaveBeenCalledTimes(1);
    expect(activateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID);
    // The hold is the source of truth — it must be persisted BEFORE activation.
    expect(vi.mocked(recordCampaignHold).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(activateCampaign).mock.invocationCallOrder[0],
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `${APP_ORIGIN}/app/events/${EVENT_ID}/campaign/${CAMPAIGN_ID}/payment?held=1`,
    );
  });

  it('keeps the confirmed hold and lands on ?held=1&activate=failed when activation is refused', async () => {
    vi.mocked(activateCampaign).mockRejectedValue(
      new Error('לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי'),
    );

    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location') as string);
    expect(loc.pathname).toBe(`/app/events/${EVENT_ID}/campaign/${CAMPAIGN_ID}/payment`);
    expect(loc.searchParams.get('held')).toBe('1');
    expect(loc.searchParams.get('activate')).toBe('failed');
    // The hold itself is NOT rolled back or marked failed — it is real at SUMIT.
    expect(markCampaignHoldFailed).not.toHaveBeenCalled();
  });

  it('never activates when the card hold was declined', async () => {
    vi.mocked(authorizeHoldSumit).mockRejectedValue(new SumitDeclinedError());

    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(activateCampaign).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location') as string).searchParams.get('error')).toBe(
      'hold_declined',
    );
  });

  it('never activates when persisting the confirmed hold fails', async () => {
    vi.mocked(recordCampaignHold).mockRejectedValue(new Error('שמירת תפיסת המסגרת נכשלה'));

    const res = await callPost(request({ 'og-token': 'og-123' }));

    expect(activateCampaign).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location') as string).searchParams.get('error')).toBe(
      'hold_review',
    );
  });
});
