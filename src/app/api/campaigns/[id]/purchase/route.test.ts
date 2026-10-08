import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForPurchase: vi.fn(), activateCampaign: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/payments/package-purchase', () => ({ purchasePackage: vi.fn() }));

import { POST } from './route';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { activateCampaign, getCampaignForPurchase } from '@/lib/data/campaigns';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { getProfile } from '@/lib/data/profiles';
import { purchasePackage, type PurchaseOutcome } from '@/lib/payments/package-purchase';

// The purchase route is the HTTP shell around purchasePackage: it decides WHO may ask (a signed-in owner, from this
// site) and WHAT is on the table (a campaign the server read, the card token), and turns the outcome into a redirect.
// Whether money moves is decided inside purchasePackage and tested there.

const APP_ORIGIN = 'https://kalfa.test';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const PAY_PATH = `/app/events/${EVENT_ID}/campaign/${CAMPAIGN_ID}/payment`;
const CAMPAIGN = { id: CAMPAIGN_ID, event_id: EVENT_ID, status: 'approved', package_price: 120 };

function request(
  fields: Record<string, string>,
  headers: Record<string, string> = { Origin: APP_ORIGIN },
): NextRequest {
  return new Request(`${APP_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  }) as unknown as NextRequest;
}

function callPost(req: NextRequest) {
  return POST(req, { params: Promise.resolve({ id: CAMPAIGN_ID }) });
}

function location(res: Response): URL {
  return new URL(res.headers.get('location') as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.APP_ORIGIN = APP_ORIGIN;
  vi.mocked(requireUser).mockResolvedValue({ id: 'user-1', email: 'user@test.com' } as never);
  vi.mocked(getProfile).mockResolvedValue({ id: 'user-1', full_name: 'ישראל ישראלי', phone: null, updated_at: null } as never);
  vi.mocked(getCampaignForPurchase).mockResolvedValue(CAMPAIGN as never);
  vi.mocked(requireOwnedEvent).mockResolvedValue({
    id: EVENT_ID,
    status: 'active',
    // Well into the future — never "past" regardless of when this runs.
    event_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  } as never);
  vi.mocked(purchasePackage).mockResolvedValue('paid');
});

describe('POST /api/campaigns/[id]/purchase — who may ask', () => {
  it('reaches the purchase for a same-origin POST by the signed-in owner', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(purchasePackage).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
  });

  it('rejects a cross-origin POST with 403 before anything else runs', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }, { Origin: 'https://evil.test' }));
    expect(res.status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('rejects a POST with neither Origin nor Referer with 403', async () => {
    const res = await callPost(request({ 'og-token': 'og-123' }, {}));
    expect(res.status).toBe(403);
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('sends a visitor who is not signed in to the login page', async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error('NEXT_REDIRECT'));
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(location(res).pathname).toBe('/auth/login');
    expect(getCampaignForPurchase).not.toHaveBeenCalled();
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('sends a campaign that does not exist to /app, without saying so', async () => {
    vi.mocked(getCampaignForPurchase).mockResolvedValue(null);
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(location(res).pathname).toBe('/app');
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('sends someone who does not own the event to /app — the same answer as "not found"', async () => {
    vi.mocked(requireOwnedEvent).mockRejectedValue(new Error('NEXT_REDIRECT'));
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(location(res).pathname).toBe('/app');
    expect(requireOwnedEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(purchasePackage).not.toHaveBeenCalled();
  });
});

describe('POST /api/campaigns/[id]/purchase — what is on the table', () => {
  it('hands the purchase the campaign the SERVER read and the card token — nothing the browser sent about money', async () => {
    await callPost(request({ 'og-token': 'og-123', amount: '0.01', package_price: '1', campaign_id: 'other' }));
    expect(purchasePackage).toHaveBeenCalledWith({
      campaign: CAMPAIGN,
      payer: { userId: 'user-1', email: 'user@test.com', name: 'ישראל ישראלי' },
      ogToken: 'og-123',
    });
  });

  it('names the cardholder from the profile, then the email, then a generic label', async () => {
    vi.mocked(getProfile).mockResolvedValue({ id: 'user-1', full_name: '   ', phone: null, updated_at: null } as never);
    await callPost(request({ 'og-token': 'og-123' }));
    expect(vi.mocked(purchasePackage).mock.calls[0][0].payer.name).toBe('user@test.com');

    vi.mocked(requireUser).mockResolvedValue({ id: 'user-1', email: null } as never);
    vi.mocked(getProfile).mockResolvedValue(null as never);
    await callPost(request({ 'og-token': 'og-123' }));
    expect(vi.mocked(purchasePackage).mock.calls[1][0].payer).toEqual({ userId: 'user-1', email: '', name: 'לקוח KALFA' });
  });

  it('a missing or blank token is reported as such, and nothing is charged', async () => {
    const submissions: Record<string, string>[] = [{}, { 'og-token': '' }, { 'og-token': '   ' }];
    for (const fields of submissions) {
      const res = await callPost(request(fields));
      expect(location(res).pathname).toBe(PAY_PATH);
      expect(location(res).searchParams.get('error')).toBe('token_missing');
    }
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('a past event takes no payment', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: EVENT_ID,
      status: 'active',
      event_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    } as never);
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(location(res).searchParams.get('error')).toBe('event_past');
    expect(purchasePackage).not.toHaveBeenCalled();
  });

  it('an event whose details were not confirmed takes no payment', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({
      id: EVENT_ID,
      status: 'draft',
      event_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    } as never);
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(location(res).searchParams.get('error')).toBe('event_not_active');
    expect(purchasePackage).not.toHaveBeenCalled();
  });
});

describe('POST /api/campaigns/[id]/purchase — the answer the customer gets', () => {
  it.each<[PurchaseOutcome, string | null, string | null]>([
    ['paid', null, '1'],
    ['already_paid', null, '1'],
    ['in_progress', 'purchase_in_progress', null],
    ['review', 'purchase_review', null],
    ['declined', 'purchase_declined', null],
    ['disabled', 'purchase_disabled', null],
    ['not_purchasable', 'bad_state', null],
    ['credit_unsupported', 'credit_unsupported', null],
    ['error', 'purchase_failed', null],
  ])('%s → error=%s paid=%s', async (outcome, error, paid) => {
    vi.mocked(purchasePackage).mockResolvedValue(outcome);
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(res.status).toBe(303);
    const loc = location(res);
    expect(loc.origin).toBe(APP_ORIGIN);
    expect(loc.pathname).toBe(PAY_PATH);
    expect(loc.searchParams.get('error')).toBe(error);
    expect(loc.searchParams.get('paid')).toBe(paid);
  });

  it.each<[PurchaseOutcome]>([['already_paid'], ['in_progress'], ['review'], ['declined'], ['disabled'], ['not_purchasable'], ['credit_unsupported'], ['error']])(
    'a %s outcome never activates anything',
    async (outcome) => {
      vi.mocked(purchasePackage).mockResolvedValue(outcome);
      await callPost(request({ 'og-token': 'og-123' }));
      expect(activateCampaign).not.toHaveBeenCalled();
    },
  );

  it('an unexpected throw is a generic failure, never a stack trace and never a success', async () => {
    vi.mocked(purchasePackage).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(res.status).toBe(303);
    expect(location(res).searchParams.get('error')).toBe('purchase_failed');
    expect(location(res).searchParams.get('paid')).toBeNull();
    expect(res.headers.get('location')).not.toContain('ECONNREFUSED');
  });
});

describe('POST /api/campaigns/[id]/purchase — after a payment that was just recorded', () => {
  it('the campaign is activated, and the customer lands on the paid page', async () => {
    vi.mocked(purchasePackage).mockResolvedValue('paid');
    vi.mocked(activateCampaign).mockResolvedValue(undefined);
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(activateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID);
    const loc = location(res);
    expect(loc.pathname).toBe(PAY_PATH);
    expect(loc.searchParams.get('paid')).toBe('1');
    expect(loc.searchParams.get('activate')).toBeNull();
  });

  it('a refused activation keeps the payment: paid, activate=failed, and Slack is told that a paying customer is not live', async () => {
    vi.mocked(purchasePackage).mockResolvedValue('paid');
    vi.mocked(activateCampaign).mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callPost(request({ 'og-token': 'og-123' }));
    const loc = location(res);
    expect(loc.searchParams.get('paid')).toBe('1');
    expect(loc.searchParams.get('activate')).toBe('failed');
    expect(res.headers.get('location')).not.toContain('ECONNREFUSED');
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', category: 'campaign_billing', source: 'package-activation' }),
    );
  });

  it('a successful activation sends no alert', async () => {
    vi.mocked(purchasePackage).mockResolvedValue('paid');
    vi.mocked(activateCampaign).mockResolvedValue(undefined);
    await callPost(request({ 'og-token': 'og-123' }));
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

