import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn(), hasPlatformPermission: vi.fn(async () => false) }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForPurchase: vi.fn() }));
vi.mock('@/lib/payments/activate-paid-package', () => ({ startPaidPackageNow: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/payments/package-purchase', () => ({ purchasePackage: vi.fn() }));

import { POST } from './route';
import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getCampaignForPurchase } from '@/lib/data/campaigns';
import { startPaidPackageNow } from '@/lib/payments/activate-paid-package';
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
// A recorded payment ends setup: the owner lands on the event page, the management page from then on (design D2).
const EVENT_PATH = `/app/events/${EVENT_ID}`;
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
      // Decided from the session, never from the form.
      mayUseTestTerminal: false,
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
  it.each<[PurchaseOutcome, string, string | null]>([
    ['paid', EVENT_PATH, null],
    ['already_paid', EVENT_PATH, null],
    ['in_progress', PAY_PATH, 'purchase_in_progress'],
    ['review', PAY_PATH, 'purchase_review'],
    ['declined', PAY_PATH, 'purchase_declined'],
    ['disabled', PAY_PATH, 'purchase_disabled'],
    ['not_purchasable', PAY_PATH, 'bad_state'],
    ['credit_unsupported', PAY_PATH, 'credit_unsupported'],
    ['error', PAY_PATH, 'purchase_failed'],
  ])('%s → %s, error=%s', async (outcome, path, error) => {
    vi.mocked(purchasePackage).mockResolvedValue(outcome);
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(res.status).toBe(303);
    const loc = location(res);
    expect(loc.origin).toBe(APP_ORIGIN);
    expect(loc.pathname).toBe(path);
    expect(loc.searchParams.get('error')).toBe(error);
    // The landing after a payment carries nothing the page could mistake for the payment's state.
    if (path === EVENT_PATH) expect(loc.search).toBe('');
  });

  it.each<[PurchaseOutcome]>([['already_paid'], ['in_progress'], ['review'], ['declined'], ['disabled'], ['not_purchasable'], ['credit_unsupported'], ['error']])(
    'a %s outcome never activates anything',
    async (outcome) => {
      vi.mocked(purchasePackage).mockResolvedValue(outcome);
      await callPost(request({ 'og-token': 'og-123' }));
      expect(startPaidPackageNow).not.toHaveBeenCalled();
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
  it('the service is started inline, and the customer lands on the event page', async () => {
    vi.mocked(purchasePackage).mockResolvedValue('paid');
    vi.mocked(startPaidPackageNow).mockResolvedValue('started');
    const res = await callPost(request({ 'og-token': 'og-123' }));
    expect(startPaidPackageNow).toHaveBeenCalledWith(CAMPAIGN_ID);
    const loc = location(res);
    expect(loc.pathname).toBe(EVENT_PATH);
    expect(loc.search).toBe('');
  });

  // purchasePackage already queued the start (D23): the worker retries it and alerts only on its final delivery, so the
  // route itself raises no alert. The customer sees the same landing: the purchase ended setup either way.
  it('an inline start not done yet keeps the payment: the same landing, and no alert from the route', async () => {
    vi.mocked(purchasePackage).mockResolvedValue('paid');
    vi.mocked(startPaidPackageNow).mockResolvedValue('failed');
    const res = await callPost(request({ 'og-token': 'og-123' }));
    const loc = location(res);
    expect(loc.pathname).toBe(EVENT_PATH);
    expect(loc.search).toBe('');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
