import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it so a redirect is observable.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }),
}));
vi.mock('@/lib/data/events', () => ({
  canAccessEvent: vi.fn(),
  eventDatesLocked: vi.fn(),
  getEvent: vi.fn(),
  getEventClosureReason: vi.fn(),
  isEventOwner: vi.fn(),
}));
vi.mock('@/lib/storage/event-media', () => ({ signedInviteImageUrl: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({
  getCampaignForEvent: vi.fn(),
  getThankyouSchedule: vi.fn(),
  listCampaignsForEvent: vi.fn(),
}));
vi.mock('@/lib/payments/package-paid', () => ({ packagePaymentOf: vi.fn() }));
vi.mock('@/lib/data/event-stats', () => ({ getEventStats: vi.fn() }));
vi.mock('@/lib/data/event-cancellation', () => ({ getCancellationRequestForEvent: vi.fn() }));
vi.mock('./edit-event-form', () => ({ EditEventForm: () => <div data-marker="details-form" /> }));
vi.mock('./event-status-actions', () => ({ EventStatusActions: () => <div data-marker="close-control" /> }));
vi.mock('./event-summary', () => ({ EventSummary: () => <div data-marker="summary" /> }));
vi.mock('./campaign/campaign-actions', () => ({ closeEventAction: vi.fn() }));
vi.mock('./cancellation-request-form', () => ({ CancellationRequestForm: () => <div data-marker="cancellation" /> }));
vi.mock('./actions', () => ({ createCancellationRequestAction: vi.fn() }));

import { redirect } from 'next/navigation';
import { getCampaignForEvent, listCampaignsForEvent } from '@/lib/data/campaigns';
import { getCancellationRequestForEvent } from '@/lib/data/event-cancellation';
import { canAccessEvent, eventDatesLocked, getEvent, isEventOwner } from '@/lib/data/events';
import { packagePaymentOf } from '@/lib/payments/package-paid';
import EventPage from './page';

// The event page routes by the event's mode (design D1/D2, task 3.1), read from the event lifecycle model:
//   setup       - the owner is sent into the setup flow; another viewer gets a read-only card;
//   management  - today's page, with the service card instead of the setup steps;
//   unavailable - rendered in place, never a redirect.

const EVENT_ID = 'e1';
const activeEvent = {
  id: EVENT_ID,
  name: 'החתונה',
  status: 'active',
  event_type: 'wedding',
  event_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  rsvp_deadline: null,
  venue_name: 'אולם',
  venue_address: 'הרצל 1',
  celebrants: { groom: 'דני', bride: 'דנה' },
  invite_image_path: null,
  show_meal_pref: true,
  gift_payment_url: null,
  created_at: '2026-10-01T00:00:00.000Z',
};
const campaign = (status: string) => ({ id: 'c1', status, price: 150, template_id: 'pkg-1' });
const ledger = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  collected: status === 'collected' ? 150 : 0,
  credit: 0,
  committed: 0,
  ...extra,
});

let canViewCampaigns = true;

async function render(): Promise<string> {
  const tree = await EventPage({ params: Promise.resolve({ id: EVENT_ID }) });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  canViewCampaigns = true;
  vi.mocked(getEvent).mockResolvedValue(activeEvent as never);
  vi.mocked(isEventOwner).mockResolvedValue(true);
  vi.mocked(canAccessEvent).mockImplementation(async (_id, resource) =>
    resource === 'campaigns' ? canViewCampaigns : true,
  );
  vi.mocked(eventDatesLocked).mockResolvedValue(false);
  vi.mocked(getCampaignForEvent).mockResolvedValue(null);
  vi.mocked(listCampaignsForEvent).mockResolvedValue([]);
  vi.mocked(getCancellationRequestForEvent).mockResolvedValue(null);
  vi.mocked(packagePaymentOf).mockResolvedValue(null);
});

describe('setup: the owner is sent into the setup flow', () => {
  it.each([
    ['no service chosen yet', null, null],
    ['terms awaiting approval', campaign('pending_approval'), ledger('none')],
    ['approved, not paid', campaign('approved'), ledger('none')],
    ['the payment was declined', campaign('approved'), ledger('declined')],
    ['a payment still in flight', campaign('approved'), ledger('pending')],
  ])('%s → /setup', async (_name, live, payment) => {
    vi.mocked(getCampaignForEvent).mockResolvedValue(live as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(payment as never);

    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}/setup`);
  });

  it('a draft event is setup too', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...activeEvent, status: 'draft' } as never);

    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/app/events/${EVENT_ID}/setup`);
  });
});

describe('setup: another viewer gets a read-only card', () => {
  beforeEach(() => {
    vi.mocked(isEventOwner).mockResolvedValue(false);
  });

  it('shows where the setup stands, with no redirect and no details form', async () => {
    const html = await render();

    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain('בהקמה');
    expect(html).toContain('השלב הנוכחי: בחירת חבילה');
    expect(html).not.toContain('data-marker="details-form"');
    expect(html).not.toContain('data-marker="cancellation"');
  });
});

describe('management: today’s page with the service card', () => {
  it.each([
    ['paid, not yet running', campaign('approved'), ledger('collected')],
    ['paid with test money', campaign('approved'), ledger('collected', { testMoney: true })],
    ['running', campaign('active'), ledger('collected')],
    ['paused', campaign('paused'), ledger('collected')],
  ])('%s → no redirect, the link to the service, the details form', async (_name, live, payment) => {
    vi.mocked(getCampaignForEvent).mockResolvedValue(live as never);
    vi.mocked(listCampaignsForEvent).mockResolvedValue([live] as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(payment as never);

    const html = await render();

    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain(`href="/app/events/${EVENT_ID}/campaign/c1"`);
    expect(html).toContain('data-marker="details-form"');
    expect(html).not.toContain('בהקמה');
  });

  it('a paid service offers the cancellation request', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue(campaign('active') as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(ledger('collected') as never);

    expect(await render()).toContain('data-marker="cancellation"');
  });
});

describe('unavailable: rendered in place, never a redirect', () => {
  it('a ledger that cannot be read → a notice, not /setup', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue(campaign('approved') as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(null);

    const html = await render();

    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain('לא ניתן להציג כרגע את מצב אישורי ההגעה');
    expect(html).toContain('data-marker="details-form"');
  });

  it('money that moved (a refund) → a support notice, not /setup', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue(campaign('approved') as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(ledger('refunded') as never);

    const html = await render();

    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain('תנועת כסף שדורשת בדיקה של התמיכה');
  });

  it('a viewer who cannot see the campaigns → the permission-limited card, even as the owner of the row', async () => {
    canViewCampaigns = false;

    const html = await render();

    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain('אין הרשאה להציג');
    expect(getCampaignForEvent).not.toHaveBeenCalled();
  });
});

describe('the ledger is read once, before the mode decides', () => {
  it('packagePaymentOf runs once per render', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue(campaign('active') as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(ledger('collected') as never);

    await render();

    expect(packagePaymentOf).toHaveBeenCalledTimes(1);
  });
});
