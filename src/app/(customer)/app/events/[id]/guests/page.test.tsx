import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/data/events', () => ({ requireEventAccess: vi.fn() }));
vi.mock('@/lib/data/event-mode', () => ({ redirectOwnerInSetup: vi.fn() }));
vi.mock('@/lib/data/guests', () => ({
  listGuests: vi.fn(),
  listGroups: vi.fn(),
  getGuestTotals: vi.fn(),
  countGuestsMissingExpectedCount: vi.fn(),
}));
vi.mock('@/lib/data/whatsapp-import-channel', () => ({ getWhatsAppImportChannel: vi.fn() }));
vi.mock('./guests-actions', () => ({ fillMissingExpectedCountAction: vi.fn() }));
vi.mock('./add-guests-onboarding', () => ({
  AddGuestsOnboarding: ({ stage }: { stage: string | null }) => <div data-marker="onboarding" data-stage={stage ?? 'none'} />,
}));
vi.mock('./fill-expected-count', () => ({ FillExpectedCount: () => null }));
vi.mock('./guest-list-controls', () => ({ GuestListControls: () => null }));
vi.mock('./groups-manager', () => ({ GroupsManager: () => null }));
vi.mock('./guest-row-actions', () => ({ GuestRowActions: () => null }));
vi.mock('./contact-status-cell', () => ({ ContactStatusCell: () => null }));

import type { EventModeRead } from '@/lib/data/event-mode';
import { redirectOwnerInSetup } from '@/lib/data/event-mode';
import { requireEventAccess } from '@/lib/data/events';
import { getGuestTotals, listGroups, listGuests } from '@/lib/data/guests';
import { getWhatsAppImportChannel } from '@/lib/data/whatsapp-import-channel';
import GuestsPage from './page';

// Guests are managed after payment (design D4, task 3.4): the page hands the owner of an event still in setup to the
// setup flow before it reads any guest. Who is redirected, and when, is redirectOwnerInSetup's decision
// (event-mode.test.ts); this pins that the page asks it, with the event its own gate returned, and first.

const EVENT = { id: 'e1', name: 'החתונה', status: 'active' };
const props = { params: Promise.resolve({ id: 'e1' }), searchParams: Promise.resolve({}) };

const modeRead = (over: Partial<EventModeRead> = {}) =>
  ({ mode: 'management', campaignsVisible: true, campaign: null, payment: null, ...over }) as EventModeRead;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireEventAccess).mockResolvedValue(EVENT as never);
  vi.mocked(listGuests).mockResolvedValue({ items: [], total: 0, pageSize: 50 } as never);
  vi.mocked(listGroups).mockResolvedValue([]);
  vi.mocked(getGuestTotals).mockResolvedValue({ rows: 0 } as never);
  vi.mocked(getWhatsAppImportChannel).mockResolvedValue(null as never);
});

describe('guests page: the setup gate', () => {
  it('asks for the mode with the event its own gate returned, before any guest is read', async () => {
    vi.mocked(redirectOwnerInSetup).mockResolvedValue(modeRead());

    await GuestsPage(props);

    expect(requireEventAccess).toHaveBeenCalledWith('e1', 'guests', 'view');
    expect(redirectOwnerInSetup).toHaveBeenCalledWith(EVENT);
    const order = (fn: unknown) => (fn as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];
    expect(order(requireEventAccess)).toBeLessThan(order(redirectOwnerInSetup));
    expect(order(redirectOwnerInSetup)).toBeLessThan(order(listGuests));
  });

  it('the owner of an event in setup is redirected: the redirect propagates and no guest is read', async () => {
    vi.mocked(redirectOwnerInSetup).mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/app/events/e1/setup;307;' }),
    );

    await expect(GuestsPage(props)).rejects.toThrow('NEXT_REDIRECT');
    expect(listGuests).not.toHaveBeenCalled();
    expect(getGuestTotals).not.toHaveBeenCalled();
  });

  it('the first-run screen shows the stage of the campaign the mode was read from, with no second read', async () => {
    vi.mocked(redirectOwnerInSetup).mockResolvedValue(
      modeRead({
        campaign: { id: 'c1', status: 'active', price: 150 } as EventModeRead['campaign'],
        payment: { status: 'collected', collected: 150, credit: 0, committed: 0 },
      }),
    );

    const html = renderToStaticMarkup(await GuestsPage(props));

    expect(html).toContain('data-stage="active"');
  });

  it('a viewer who may not see the campaigns gets no stage badge', async () => {
    vi.mocked(redirectOwnerInSetup).mockResolvedValue(modeRead({ mode: 'unavailable', campaignsVisible: false }));

    const html = renderToStaticMarkup(await GuestsPage(props));

    expect(html).toContain('data-stage="none"');
  });

  it('a non-owner of an event in setup stays on the page', async () => {
    vi.mocked(redirectOwnerInSetup).mockResolvedValue(
      modeRead({ mode: 'setup', campaign: { id: 'c1', status: 'approved', price: 150 } as EventModeRead['campaign'] }),
    );

    const html = renderToStaticMarkup(await GuestsPage(props));

    expect(html).toContain('data-marker="onboarding"');
    expect(html).toContain('data-stage="awaiting_payment"');
  });
});
