import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it so a redirect is observable.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }),
}));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForEvent: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ canAccessEvent: vi.fn(), isEventOwner: vi.fn() }));
vi.mock('@/lib/payments/package-paid', () => ({ packagePaymentOf: vi.fn() }));

import { redirect } from 'next/navigation';
import { getCampaignForEvent, type OwnerCampaign } from '@/lib/data/campaigns';
import { canAccessEvent, isEventOwner } from '@/lib/data/events';
import { packagePaymentOf } from '@/lib/payments/package-paid';
import type { PaymentState } from '@/lib/payments/status';
import { readEventMode, redirectOwnerInSetup } from './event-mode';

// The mode a management page (guests, statistics, the service results) reads, from the real event lifecycle model,
// and the redirect of the owner of an event still in setup (design D1/D2/D4, tasks 3.4 and 3.6).

const EVENT = { id: 'e1', status: 'active' as const };
const SETUP_TARGET = '/app/events/e1/setup';

const packageCampaign = (status: OwnerCampaign['status']) => ({ id: 'c1', status, price: 150 }) as OwnerCampaign;
const ledger = (status: PaymentState['status'], over: Partial<PaymentState> = {}): PaymentState => ({
  status,
  collected: status === 'collected' ? 150 : 0,
  credit: 0,
  committed: 0,
  ...over,
});

function given(opts: {
  campaignsVisible?: boolean;
  campaign?: OwnerCampaign | null;
  payment?: PaymentState | null;
  owner?: boolean;
}) {
  vi.mocked(canAccessEvent).mockResolvedValue(opts.campaignsVisible ?? true);
  vi.mocked(getCampaignForEvent).mockResolvedValue(opts.campaign ?? null);
  vi.mocked(packagePaymentOf).mockResolvedValue(opts.payment ?? null);
  vi.mocked(isEventOwner).mockResolvedValue(opts.owner ?? true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readEventMode', () => {
  it('probes campaigns.view first and reads no campaign for a viewer without it: unavailable', async () => {
    given({ campaignsVisible: false });

    const read = await readEventMode(EVENT);

    expect(canAccessEvent).toHaveBeenCalledWith('e1', 'campaigns', 'view');
    expect(getCampaignForEvent).not.toHaveBeenCalled();
    expect(packagePaymentOf).not.toHaveBeenCalled();
    expect(read).toMatchObject({ mode: 'unavailable', campaignsVisible: false, campaign: null, payment: null });
  });

  it('no campaign yet is setup, without a ledger read', async () => {
    given({ campaign: null });

    expect((await readEventMode(EVENT)).mode).toBe('setup');
    expect(packagePaymentOf).not.toHaveBeenCalled();
  });

  it('reads the ledger of the live campaign and returns what it read', async () => {
    const campaign = packageCampaign('approved');
    const payment = ledger('collected');
    given({ campaign, payment });

    const read = await readEventMode(EVENT);

    expect(packagePaymentOf).toHaveBeenCalledWith(campaign);
    expect(read).toMatchObject({ mode: 'management', campaignsVisible: true, campaign, payment });
  });

  it.each([
    ['approved, unpaid', 'approved', ledger('none'), 'setup'],
    ['approved, declined', 'approved', ledger('declined'), 'setup'],
    ['approved, payment in progress', 'approved', ledger('pending'), 'setup'],
    ['approved, paid with real money', 'approved', ledger('collected'), 'management'],
    ['approved, paid with test money', 'approved', ledger('collected', { testMoney: true }), 'management'],
    ['running', 'active', ledger('collected'), 'management'],
    ['approved, refunded', 'approved', ledger('refunded'), 'unavailable'],
    ['approved, unreadable ledger', 'approved', null, 'unavailable'],
  ] as const)('%s → %s', async (_label, status, payment, mode) => {
    given({ campaign: packageCampaign(status), payment });

    expect((await readEventMode(EVENT)).mode).toBe(mode);
  });

  it('a closed event is management', async () => {
    given({ campaign: null });

    expect((await readEventMode({ id: 'e1', status: 'closed' })).mode).toBe('management');
  });
});

describe('redirectOwnerInSetup', () => {
  it('sends the owner of an event in setup to the setup flow', async () => {
    given({ campaign: packageCampaign('approved'), payment: ledger('none'), owner: true });

    await expect(redirectOwnerInSetup(EVENT)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(SETUP_TARGET);
  });

  it('a draft event with no service is setup too', async () => {
    given({ campaign: null, owner: true });

    await expect(redirectOwnerInSetup({ id: 'e1', status: 'draft' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(SETUP_TARGET);
  });

  it('leaves another viewer of an event in setup on the page', async () => {
    given({ campaign: packageCampaign('approved'), payment: ledger('none'), owner: false });

    await expect(redirectOwnerInSetup(EVENT)).resolves.toMatchObject({ mode: 'setup' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['paid', { campaign: packageCampaign('approved'), payment: ledger('collected') }],
    ['an unreadable ledger', { campaign: packageCampaign('approved'), payment: null }],
    ['money that moved', { campaign: packageCampaign('approved'), payment: ledger('refunded') }],
    ['campaigns this viewer cannot see', { campaignsVisible: false }],
  ] as const)('never redirects the owner on %s, and does not ask who owns the event', async (_label, facts) => {
    given({ ...facts, owner: true });

    await expect(redirectOwnerInSetup(EVENT)).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
    expect(isEventOwner).not.toHaveBeenCalled();
  });
});
