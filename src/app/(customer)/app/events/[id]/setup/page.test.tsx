import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()) }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForEvent: vi.fn(), listPackageOffers: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ getEvent: vi.fn() }));
vi.mock('@/lib/storage/event-media', () => ({ signedInviteImageUrl: vi.fn() }));
vi.mock('../campaign/campaign-actions', () => ({ setupCampaignAction: vi.fn(), choosePackageAction: vi.fn() }));
vi.mock('../campaign/[campaignId]/approve/agreement-step', () => ({ AgreementStep: () => <div data-marker="agreement" /> }));
vi.mock('../campaign/[campaignId]/approve/package-terms-step', () => ({ PackageTermsStep: () => <div data-marker="package-terms" /> }));
vi.mock('../campaign-setup-form', () => ({ CampaignSetupForm: () => <div data-marker="create-campaign" /> }));
vi.mock('../edit-event-form', () => ({ EditEventForm: () => <div data-marker="details-form" /> }));
vi.mock('../setup-confirm-form', () => ({ SetupConfirmForm: () => <div data-marker="confirm-form" /> }));
vi.mock('../setup-stepper', () => ({
  SetupStepper: ({ steps }: { steps: Array<{ key: string; state: string; label: string }> }) => (
    <div
      data-marker="stepper"
      data-steps={steps.map((s) => `${s.key}:${s.state}`).join(',')}
      data-labels={steps.map((s) => s.label).join('|')}
    />
  ),
}));
vi.mock('../package-choice-form', () => ({
  PackageChoiceForm: ({ offers }: { offers: Array<Record<string, unknown>> }) => (
    <div data-marker="package-form" data-offers={JSON.stringify(offers)} />
  ),
}));

import { getCampaignForEvent, listPackageOffers } from '@/lib/data/campaigns';
import { getEvent } from '@/lib/data/events';
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

async function render(): Promise<string> {
  const tree = await SetupPage({
    params: Promise.resolve({ id: EVENT_ID }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(tree);
}
const stepsOf = (html: string) => /data-steps="([^"]*)"/.exec(html)?.[1].split(',').map((s) => s.split(':')[0]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(getEvent).mockResolvedValue(confirmedEvent as never);
  vi.mocked(getCampaignForEvent).mockResolvedValue(null);
  vi.mocked(listPackageOffers).mockResolvedValue([]);
});

describe('setup page — nothing on offer (the package switch is off)', () => {
  it('is the five steps it always was: confirmed, no campaign → the create-campaign form for signing', async () => {
    const html = await render();
    expect(stepsOf(html)).toEqual(['details', 'confirm', 'sign', 'pay', 'live']);
    expect(html).toContain('data-marker="create-campaign"');
    expect(html).not.toContain('data-marker="package-form"');
    // the pay-per-result flow still signs
    expect(html).toContain('קריאת ההסכם וחתימה');
  });

  it('a campaign that already exists never triggers a catalogue read', async () => {
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'pending_approval', capture_status: null, package_price: null } as never);
    const html = await render();
    expect(listPackageOffers).not.toHaveBeenCalled();
    expect(html).toContain('data-marker="agreement"');
    expect(stepsOf(html)).toEqual(['details', 'confirm', 'sign', 'pay', 'live']);
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
    expect(html).not.toContain('data-marker="create-campaign"');
    expect(html).not.toContain('data-marker="agreement"');
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
    vi.mocked(getCampaignForEvent).mockResolvedValue({ id: 'c1', status: 'pending_approval', capture_status: null, package_price: 150 } as never);
    const html = await render();
    expect(html).toContain('package:done');
    expect(html).toContain('sign:current');
    expect(html).toContain('data-marker="package-terms"');
    expect(html).not.toContain('data-marker="agreement"');
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
