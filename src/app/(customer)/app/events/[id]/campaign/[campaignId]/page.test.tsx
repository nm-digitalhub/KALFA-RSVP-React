import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ hasPlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/campaigns', () => ({
  getCampaignDeliveryForAdminView: vi.fn(),
  getCampaignForAdminView: vi.fn(),
  getEventForAdminView: vi.fn(),
  getThankyouScheduleForAdminView: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ getCampaignBillingSummary: vi.fn() }));
vi.mock('@/lib/data/campaign-delivery', () => ({ getCampaignDeliveryBreakdown: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({
  getCampaign: vi.fn(),
  getThankyouSchedule: vi.fn(),
  viewerOwnsCampaignEvent: vi.fn(),
}));
vi.mock('@/lib/data/contacts', () => ({ countAuthorizedContacts: vi.fn(), countUniqueContactsForEvent: vi.fn() }));
vi.mock('@/components/payments/campaign-payments', () => ({ CampaignPayments: () => null }));
vi.mock('@/lib/payments/campaign-payments-view', () => ({ campaignPaymentsView: vi.fn() }));
vi.mock('@/lib/payments/package-paid', () => ({ packagePaymentOf: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/data/event-mode', () => ({ redirectOwnerInSetup: vi.fn() }));
vi.mock('../campaign-actions', () => ({
  cancelCampaignAction: vi.fn(),
  closeCampaignAction: vi.fn(),
  pauseCampaignAction: vi.fn(),
  rescheduleEventAction: vi.fn(),
  sendEventDayReminderAction: vi.fn(),
  sendGiftReminderAction: vi.fn(),
  sendThankyouAction: vi.fn(),
  updateThankyouScheduleAction: vi.fn(),
}));
vi.mock('./manage-client', () => ({ ManageClient: () => null }));

import { hasPlatformPermission } from '@/lib/auth/dal';
import { getCampaignForAdminView, getEventForAdminView } from '@/lib/data/admin/campaigns';
import { getCampaign } from '@/lib/data/campaigns';
import type { EventModeRead } from '@/lib/data/event-mode';
import { redirectOwnerInSetup } from '@/lib/data/event-mode';
import { requireEventAccess } from '@/lib/data/events';
import CampaignManagePage from './page';

// The service results are management (design D2, task 3.6): the owner of an event still in setup is sent to the setup
// flow, so the page is not reachable by URL before payment. Who is redirected, and when, is redirectOwnerInSetup's
// decision (event-mode.test.ts); this pins that the owner path asks it before reading the campaign, and that staff
// (the manage_billing branch) never do.

const EVENT = { id: 'e1', name: 'החתונה', status: 'active', event_date: null };
const props = { params: Promise.resolve({ id: 'e1', campaignId: 'c1' }) };
// The campaign read is where these tests stop: what comes after it is the page's ordinary rendering.
const STOP = new Error('campaign read reached');
const order = (fn: unknown) => (fn as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEventAccess).mockResolvedValue(EVENT as never);
  vi.mocked(getEventForAdminView).mockResolvedValue(EVENT as never);
  vi.mocked(getCampaign).mockRejectedValue(STOP);
  vi.mocked(getCampaignForAdminView).mockRejectedValue(STOP);
});

describe('service results page: the setup gate', () => {
  it('the owner of an event in setup is redirected before the campaign is read', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    vi.mocked(redirectOwnerInSetup).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app/events/e1/setup;307;' }),
    );

    await expect(CampaignManagePage(props)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectOwnerInSetup).toHaveBeenCalledWith(EVENT);
    expect(getCampaign).not.toHaveBeenCalled();
  });

  it('asks with the event its own gate returned, after that gate and before the campaign read', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    vi.mocked(redirectOwnerInSetup).mockResolvedValue({ mode: 'management' } as EventModeRead);

    await expect(CampaignManagePage(props)).rejects.toBe(STOP);

    expect(requireEventAccess).toHaveBeenCalledWith('e1', 'campaigns', 'view');
    expect(order(requireEventAccess)).toBeLessThan(order(redirectOwnerInSetup));
    expect(order(redirectOwnerInSetup)).toBeLessThan(order(getCampaign));
  });

  it('staff are never redirected: the admin branch does not ask for the mode', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);

    await expect(CampaignManagePage(props)).rejects.toBe(STOP);

    expect(getCampaignForAdminView).toHaveBeenCalledWith('c1');
    expect(redirectOwnerInSetup).not.toHaveBeenCalled();
  });
});
