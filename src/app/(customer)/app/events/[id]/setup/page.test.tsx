import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()) }));
vi.mock('@/lib/data/campaigns', () => ({
  getCampaignForEvent: vi.fn(),
  listCampaignsForEvent: vi.fn(),
  listPackageOffers: vi.fn(),
}));
vi.mock('@/lib/data/events', () => ({ getEvent: vi.fn(), canAccessEvent: vi.fn(), eventDatesLocked: vi.fn() }));
vi.mock('@/lib/storage/event-media', () => ({ signedInviteImageUrl: vi.fn() }));
// The real reading by default (vi.fn(impl) survives resetAllMocks); one test answers "paid".
vi.mock('@/lib/payments/package-paid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/package-paid')>();
  return { ...actual, packagePaymentOf: vi.fn(actual.packagePaymentOf) };
});
vi.mock('../campaign/campaign-actions', () => ({
  setupCampaignAction: vi.fn(),
  choosePackageAction: vi.fn(),
  closeEventAction: vi.fn(),
}));
vi.mock('../campaign/[campaignId]/approve/package-terms-step', () => ({ PackageTermsStep: () => <div data-marker="package-terms" /> }));
vi.mock('../edit-event-form', () => ({
  EditEventForm: ({ datesLocked, hasOperationalCampaign }: { datesLocked?: boolean; hasOperationalCampaign?: boolean }) => (
    <div
      data-marker="details-form"
      data-dates-locked={String(datesLocked)}
      data-operational={String(hasOperationalCampaign)}
    />
  ),
}));
vi.mock('../event-status-actions', () => ({
  EventStatusActions: ({ closeAllowed, blockedHint }: { closeAllowed: boolean; blockedHint: string | null }) => (
    <div data-marker="close-control" data-allowed={String(closeAllowed)} data-hint={blockedHint ?? ''} />
  ),
}));
vi.mock('../setup-confirm-form', () => ({ SetupConfirmForm: () => <div data-marker="confirm-form" /> }));
vi.mock('../setup-stepper', () => ({
  SetupStepper: ({ steps, back }: { steps: Array<{ key: string; state: string; label: string }>; back?: { href: string; label: string } | null }) => (
    <div
      data-marker="stepper"
      data-steps={steps.map((s) => `${s.key}:${s.state}`).join(',')}
      data-labels={steps.map((s) => s.label).join('|')}
      data-back-href={back?.href}
      data-back-label={back?.label}
    />
  ),
}));
vi.mock('../package-choice-form', () => ({
  PackageChoiceForm: ({ offers }: { offers: Array<Record<string, unknown>> }) => (
    <div data-marker="package-form" data-offers={JSON.stringify(offers)} />
  ),
}));

import { getCampaignForEvent, listCampaignsForEvent, listPackageOffers } from '@/lib/data/campaigns';
import { CLOSE_BLOCKED_MONEY_ERROR, CLOSE_BLOCKED_PAID_ERROR } from '@/lib/data/event-lifecycle';
import { canAccessEvent, eventDatesLocked, getEvent } from '@/lib/data/events';
import { packagePaymentOf } from '@/lib/payments/package-paid';
import { SERVICE_STARTING } from '@/lib/payments/package-payment-screen';
import SetupPage from './page';

// The setup page decides, on the server, which step is current. With a fixed-price package on offer a "בחירת חבילה"
// step sits between confirming the event and signing: the owner's choice creates the campaign. With nothing on offer
// (the package switch is off — today) the page is exactly what it was.

const EVENT_ID = 'e1';
const confirmedEvent = {
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
};
const OFFER = {
  id: 'pkg-1',
  name: 'זהב',
  price: 150,
  contact_quota: 100,
  description: null,
  includes: ['וואטסאפ'],
  channels: ['whatsapp'],
  outreach_schedule: [{ days_before: 7, channel: 'whatsapp', message_key: 'x' }],
};

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await SetupPage({
    params: Promise.resolve({ id: EVENT_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree);
}
const backOf = (html: string) => ({
  href: /data-back-href="([^"]*)"/.exec(html)?.[1].replaceAll('&amp;', '&') ?? null,
  label: /data-back-label="([^"]*)"/.exec(html)?.[1] ?? null,
});
const stepsOf = (html: string) => /data-steps="([^"]*)"/.exec(html)?.[1].split(',').map((s) => s.split(':')[0]);
const closeOf = (html: string) => {
  const marker = /<div data-marker="close-control"[^>]*>/.exec(html)?.[0];
  if (!marker) return null;
  return {
    allowed: /data-allowed="([^"]*)"/.exec(marker)?.[1] === 'true',
    hint: (/data-hint="([^"]*)"/.exec(marker)?.[1] ?? '').replaceAll('&quot;', '"'),
  };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(getEvent).mockResolvedValue(confirmedEvent as never);
  vi.mocked(getCampaignForEvent).mockResolvedValue(null);
  vi.mocked(listCampaignsForEvent).mockResolvedValue([]);
  vi.mocked(listPackageOffers).mockResolvedValue([]);
  vi.mocked(canAccessEvent).mockResolvedValue(true);
  vi.mocked(eventDatesLocked).mockResolvedValue(false);
});

describe('setup page — nothing on offer (the package switch is off)', () => {
  it('confirmed, no campaign → the package step is current, and its form says no package is available', async () => {
    const html = await render();
    expect(stepsOf(html)).toEqual(['details', 'confirm', 'package', 'sign', 'pay', 'live']);
    expect(html).toContain('package:current');
    // PackageChoiceForm itself shows the "no package" text for an empty list.
    expect(html).toContain('data-marker="package-form"');
    expect(html).toContain('data-offers="[]"');
  });

  it('a PENDING campaign still reads the catalogue — the same step changes the package (5.3)', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'pending_approval' } as never);
    const html = await render();
    expect(listPackageOffers).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-marker="package-terms"');
  });

  it('a campaign past approval never triggers a catalogue read', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'approved' } as never);
    await render();
    expect(listPackageOffers).not.toHaveBeenCalled();
  });
});

describe('setup page — a package is on offer', () => {
  beforeEach(() => {
    vi.mocked(listPackageOffers).mockResolvedValue([OFFER as never]);
  });

  it('confirmed, nothing chosen → the choice step is current and shows the offers; signing waits', async () => {
    const html = await render();
    expect(stepsOf(html)).toEqual(['details', 'confirm', 'package', 'sign', 'pay', 'live']);
    expect(html).toContain('package:current');
    expect(html).toContain('data-marker="package-form"');
    expect(html).not.toContain('data-marker="package-terms"');
  });

  it('hands the form only what the owner reads — never the channels or the outreach schedule', async () => {
    const html = await render();
    const offers = JSON.parse(
      (/data-offers="([^"]*)"/.exec(html)?.[1] ?? '[]').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    );
    expect(offers).toEqual([
      { id: 'pkg-1', name: 'זהב', price: 150, contact_quota: 100, description: null, includes: ['וואטסאפ'] },
    ]);
  });

  it('after the choice (a package campaign exists) → the terms are approved, not signed: no signature step, no signing form', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'pending_approval', package_price: 150 } as never);
    const html = await render();
    expect(html).toContain('package:done');
    expect(html).toContain('sign:current');
    expect(html).toContain('data-marker="package-terms"');
    expect(html).not.toContain('data-marker="package-form"');
    // the step is named for what the owner does
    expect(html).toContain('אישור תנאי החבילה');
    expect(html).not.toContain('קריאת ההסכם וחתימה');
  });

  it('a draft event that is not confirmed yet does not offer the choice: confirm comes first', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...confirmedEvent, status: 'draft' } as never);
    const html = await render();
    expect(html).toContain('confirm:current');
    expect(html).toContain('package:pending');
    expect(html).toContain('data-marker="confirm-form"');
    expect(html).not.toContain('data-marker="package-form"');
  });

  it('a catalogue that cannot be read does not take the page down (the action refuses to create anything)', async () => {
    vi.mocked(listPackageOffers).mockRejectedValue(new Error('טעינת החבילות נכשלה'));
    const html = await render();
    expect(html).toContain('data-marker="stepper"');
    expect(console.error).toHaveBeenCalled();
  });
});

// "Back" on the stepper: the server says where it leads, and only to a step whose page can still be used.
describe('setup page — the way back', () => {
  it('on the confirm step: back to the details form (the draft is still editable there)', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...confirmedEvent, status: 'draft' } as never);
    expect(backOf(await render())).toEqual({ href: '/app/events/e1/setup?step=details', label: 'פרטי האירוע' });
  });

  it('the details link really lands on the details form, and not on the confirm form (the destination of the back button)', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...confirmedEvent, status: 'draft' } as never);
    const html = await render({ step: 'details' });
    expect(html).toContain('data-marker="details-form"');
    expect(html).not.toContain('data-marker="confirm-form"');
  });

  it('a confirmed event reopens the details inside the flow (D5), with the locks the event page shows', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'pending_approval', price: 150 } as never);
    vi.mocked(listCampaignsForEvent).mockResolvedValue([{ id: 'c1', status: 'pending_approval' }] as never);
    vi.mocked(eventDatesLocked).mockResolvedValue(true);
    const html = await render({ step: 'details' });
    expect(html).toContain('data-marker="details-form"');
    expect(html).not.toContain('data-marker="package-terms"');
    // The same locks as the event page: dates by the first send, and the fields an operational campaign protects.
    expect(eventDatesLocked).toHaveBeenCalledWith(EVENT_ID, 'active');
    expect(html).toContain('data-dates-locked="true"');
    expect(html).toContain('data-operational="true"');
  });

  it('a draft\'s details form keeps the draft defaults (no lock reads)', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...confirmedEvent, status: 'draft' } as never);
    const html = await render({ step: 'details' });
    expect(html).toContain('data-dates-locked="undefined"');
    expect(eventDatesLocked).not.toHaveBeenCalled();
    expect(listCampaignsForEvent).not.toHaveBeenCalled();
  });

  it('not while the details form is already open: that would be a back to where the owner is', async () => {
    vi.mocked(getEvent).mockResolvedValue({ ...confirmedEvent, status: 'draft' } as never);
    expect(backOf(await render({ step: 'details' }))).toEqual({ href: null, label: null });
  });

  it('on the package-choice step: back to the details form inside setup (D5), not out of the flow', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([OFFER as never]);
    expect(backOf(await render())).toEqual({ href: '/app/events/e1/setup?step=details', label: 'פרטי האירוע' });
  });

  it('once the campaign exists there is no back: the choice, the approval and the payment are not undone from here', async () => {
    vi.mocked(listPackageOffers).mockResolvedValue([OFFER as never]);
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'pending_approval', package_price: 150 } as never);
    expect(backOf(await render())).toEqual({ href: null, label: null });
  });
});

// The close inside setup (D5): rendered for a viewer holding events.close, offered while nothing was paid (the event
// lifecycle model). closeEvent and the database decide again on submit.
describe('setup page — closing the event', () => {
  it('asks the customer permission system for events.close', async () => {
    await render();
    expect(canAccessEvent).toHaveBeenCalledWith(EVENT_ID, 'events', 'close');
  });

  it('without events.close there is no close control', async () => {
    vi.mocked(canAccessEvent).mockResolvedValue(false);
    expect(closeOf(await render())).toBeNull();
  });

  it.each([
    ['a draft event, nothing chosen', { status: 'draft' }, null, null],
    ['confirmed, nothing chosen', {}, null, null],
    ['the package chosen, terms not approved', {}, { id: 'c1', status: 'pending_approval', price: 150 }, { status: 'none', collected: 0, credit: 0, committed: 0 }],
    ['terms approved, the payment declined', {}, { id: 'c1', status: 'approved', price: 150 }, { status: 'declined', collected: 0, credit: 0, committed: 0 }],
  ])('%s → the close is offered', async (_name, eventPatch, campaign, payment) => {
    vi.mocked(getEvent).mockResolvedValue({ ...confirmedEvent, ...eventPatch } as never);
    vi.mocked(getCampaignForEvent).mockResolvedValue(campaign as never);
    if (payment) vi.mocked(packagePaymentOf).mockResolvedValue(payment as never);
    expect(closeOf(await render())).toEqual({ allowed: true, hint: '' });
  });

  it('a payment still in flight → not offered, contact support', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'approved', price: 150 } as never);
    vi.mocked(packagePaymentOf).mockResolvedValue({ status: 'pending', collected: 0, credit: 0, committed: 0 });
    expect(closeOf(await render())).toEqual({ allowed: false, hint: CLOSE_BLOCKED_MONEY_ERROR });
  });

  it('paid with test money → not offered (resetting a test run is a staff action)', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'approved', price: 150 } as never);
    vi.mocked(packagePaymentOf).mockResolvedValue({ status: 'collected', collected: 150, credit: 0, committed: 0, testMoney: true });
    expect(closeOf(await render())).toEqual({ allowed: false, hint: CLOSE_BLOCKED_PAID_ERROR });
  });

  it('a ledger that cannot be read → not offered (fail closed)', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'approved', price: 150 } as never);
    vi.mocked(packagePaymentOf).mockResolvedValue(null);
    const close = closeOf(await render());
    expect(close?.allowed).toBe(false);
    expect(close?.hint).not.toBe('');
  });

  it('a past event with nothing paid can still be closed', async () => {
    vi.mocked(getEvent).mockResolvedValue({
      ...confirmedEvent,
      event_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    } as never);
    expect(closeOf(await render())).toEqual({ allowed: true, hint: '' });
  });
});

describe('setup page — paid, not running yet (D23)', () => {
  it('the live step says the service is being started and offers nothing to press', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'approved', price: 150 } as never);
    vi.mocked(packagePaymentOf).mockResolvedValue({ status: 'collected', collected: 150, credit: 0, committed: 0 });
    const html = await render();
    expect(html).toContain('live:current');
    expect(html).toContain(SERVICE_STARTING);
    expect(html).not.toMatch(/הפעלת (ה)?קמפיין/); // neither start label (payment page, manage page)
    expect(html).not.toContain('/payment"');
  });
});
