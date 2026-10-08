import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn(), hasPlatformPermission: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForPurchase: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/payments/cardcom-purchase', () => ({ startCardcomPurchase: vi.fn() }));

import { hasPlatformPermission, requireUser } from '@/lib/auth/dal';
import { getCampaignForPurchase } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import { startCardcomPurchase } from '@/lib/payments/cardcom-purchase';

import { POST } from './route';

// The buyer's browser calls this from the payment page, with fetch, to open a CardCom Open Fields session. The route
// is the HTTP shell — origin, session, ownership, the event's state — and hands everything that decides whether a
// session opens to startCardcomPurchase. The browser sends NOTHING that matters: no price, no campaign id in the body.

const APP_ORIGIN = 'https://kalfa.test';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = { id: CAMPAIGN_ID, event_id: EVENT_ID, status: 'approved', package_price: 149, capture_status: null, charge_status: null };

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 30 * 86_400_000).toISOString();

const call = (headers: Record<string, string> = { Origin: APP_ORIGIN }) =>
  POST(new Request(`${APP_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/purchase/cardcom`, { method: 'POST', headers, body: '{}' }) as unknown as NextRequest, {
    params: Promise.resolve({ id: CAMPAIGN_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ORIGIN = APP_ORIGIN;
  vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: 'dana@example.com' } as never);
  vi.mocked(hasPlatformPermission).mockResolvedValue(false);
  vi.mocked(getCampaignForPurchase).mockResolvedValue(CAMPAIGN as never);
  vi.mocked(requireOwnedEvent).mockResolvedValue({ id: EVENT_ID, status: 'active', event_date: FUTURE } as never);
  vi.mocked(getProfile).mockResolvedValue({ full_name: 'דנה כהן' } as never);
  vi.mocked(startCardcomPurchase).mockResolvedValue({ status: 'ready', lowProfileId: 'lp-1' });
});

describe('POST /api/campaigns/[id]/purchase/cardcom', () => {
  it('opens a session for the signed-in owner and returns the outcome', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', lowProfileId: 'lp-1' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('hands over the campaign the SERVER read, and the payer from the session — not from the request', async () => {
    await call();
    expect(startCardcomPurchase).toHaveBeenCalledWith({
      campaign: CAMPAIGN,
      payer: { userId: 'u1', email: 'dana@example.com', name: 'דנה כהן' },
      mayUseTestTerminal: false,
    });
  });

  it('falls back to the e-mail, then a fixed name, when the profile has no name', async () => {
    vi.mocked(getProfile).mockResolvedValue({ full_name: '  ' } as never);
    await call();
    expect(vi.mocked(startCardcomPurchase).mock.calls[0][0].payer.name).toBe('dana@example.com');
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: null } as never);
    await call();
    expect(vi.mocked(startCardcomPurchase).mock.calls[1][0].payer.name).toBe('לקוח KALFA');
  });

  it('lets someone who may configure the integration use the test terminal', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    await call();
    expect(hasPlatformPermission).toHaveBeenCalledWith('integrations.manage');
    expect(vi.mocked(startCardcomPurchase).mock.calls[0][0].mayUseTestTerminal).toBe(true);
  });

  it('refuses a request from another origin', async () => {
    const res = await call({ Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(startCardcomPurchase).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error('NEXT_REDIRECT'));
    expect((await call()).status).toBe(401);
    expect(startCardcomPurchase).not.toHaveBeenCalled();
  });

  it('answers 404 for a campaign that is missing and for one the caller does not own — the same answer', async () => {
    vi.mocked(getCampaignForPurchase).mockResolvedValue(null);
    const missing = await call();
    vi.mocked(getCampaignForPurchase).mockResolvedValue(CAMPAIGN as never);
    vi.mocked(requireOwnedEvent).mockRejectedValue(new Error('not yours'));
    const notOwned = await call();
    expect([missing.status, notOwned.status]).toEqual([404, 404]);
    expect(await missing.json()).toEqual(await notOwned.json());
    expect(startCardcomPurchase).not.toHaveBeenCalled();
  });

  it('does not open a session for an event whose day has passed, or one that is not active', async () => {
    vi.mocked(requireOwnedEvent).mockResolvedValue({ id: EVENT_ID, status: 'active', event_date: PAST } as never);
    const past = await call();
    expect(past.status).toBe(409);
    expect(await past.json()).toEqual({ status: 'event_past' });
    vi.mocked(requireOwnedEvent).mockResolvedValue({ id: EVENT_ID, status: 'cancelled', event_date: FUTURE } as never);
    const inactive = await call();
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toEqual({ status: 'event_not_active' });
    expect(startCardcomPurchase).not.toHaveBeenCalled();
  });

  it('answers with a generic error, never the thrown text, when something unexpected breaks', async () => {
    vi.mocked(startCardcomPurchase).mockRejectedValue(new Error('postgres://user:secret@host'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'error' });
  });
});
