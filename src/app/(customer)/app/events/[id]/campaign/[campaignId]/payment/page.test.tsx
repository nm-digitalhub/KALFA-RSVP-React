import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()) }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaign: vi.fn(), previewCampaignHoldSizing: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getCampaignHoldsEnabled: vi.fn(),
  getPackageModelEnabled: vi.fn(),
  getSumitPublicConfig: vi.fn(),
}));
vi.mock('@/lib/payments/package-purchase', () => ({ getPackagePaymentState: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ hasPlatformPermission: vi.fn(), requireUser: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/data/cardcom-config')>()), getCardcomServerConfig: vi.fn() }));
vi.mock('@/lib/payments/cardcom-pending', () => ({ isCardcomPurchasePending: vi.fn() }));
vi.mock('../../campaign-actions', () => ({ activateCampaignAction: vi.fn() }));
vi.mock('./hold-form', () => ({
  CampaignHoldForm: (props: { purpose?: string }) => <div data-marker="hold-form" data-purpose={props.purpose ?? 'hold'} />,
}));
vi.mock('./activate-now-form', () => ({ ActivateNowForm: () => <div data-marker="activate-now" /> }));
vi.mock('./_held-analytics', () => ({ HeldAnalytics: () => <div data-marker="held-analytics" /> }));
vi.mock('./package-payment-view', () => ({
  PackagePaymentView: (props: {
    screen: { kind: string; activation?: string; testTerminal?: boolean; testMoney?: boolean };
    errorMessage: string | null;
    formConfig: unknown;
    provider?: string;
    signerEmail?: string;
    signerPhone?: string;
    activateAction?: unknown;
    activateReason?: string | null;
  }) => (
    <div
      data-marker="package-view"
      data-screen={props.screen.kind}
      data-activation={props.screen.activation ?? ''}
      data-test-terminal={props.screen.testTerminal ? 'yes' : 'no'}
      data-test-money={props.screen.testMoney ? 'yes' : 'no'}
      data-error={props.errorMessage ?? ''}
      data-config={props.formConfig ? 'yes' : 'no'}
      data-provider={props.provider ?? ''}
      data-email={props.signerEmail ?? ''}
      data-phone={props.signerPhone ?? ''}
      data-can-activate={props.activateAction ? 'yes' : 'no'}
      data-activate-reason={props.activateReason ?? ''}
    />
  ),
}));

import { getCampaign, previewCampaignHoldSizing } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { getProfile } from '@/lib/data/profiles';
import { getCampaignHoldsEnabled, getPackageModelEnabled, getPaymentsEnabled, getSumitPublicConfig } from '@/lib/data/payments';
import { hasPlatformPermission, requireUser } from '@/lib/auth/dal';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { isCardcomPurchasePending } from '@/lib/payments/cardcom-pending';
import { getPackagePaymentState } from '@/lib/payments/package-purchase';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';
import CampaignPaymentPage from './page';

// The payment step has two lives. A pay-per-result campaign reserves an amount on the card (the hold form, then
// "activate now"). A fixed-price PACKAGE campaign is paid by one purchase, decided from the payment ledger. The
// property defended here: a package campaign never sees any part of the hold path — a hold form submitted for it
// would reserve money on the card and start outreach with no payment in the ledger.

const EVENT_ID = 'e1';
const CAMPAIGN_ID = 'c1';

function campaign(over: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    event_id: EVENT_ID,
    status: 'approved',
    capture_status: null,
    max_charge_ceiling: 600,
    auth_amount: null,
    base_price: 200,
    included_reached: 200,
    price_per_reached: 4,
    tos_version: '2026-09-v5',
    package_price: null,
    ...over,
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await CampaignPaymentPage({
    params: Promise.resolve({ id: EVENT_ID, campaignId: CAMPAIGN_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requireOwnedEvent).mockResolvedValue({
    id: EVENT_ID,
    status: 'active',
    event_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  } as never);
  vi.mocked(getProfile).mockResolvedValue({ id: 'u1', full_name: 'דנה כהן', phone: '0501234567', updated_at: null } as never);
  vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
  vi.mocked(getCampaignHoldsEnabled).mockResolvedValue(true);
  vi.mocked(getPackageModelEnabled).mockResolvedValue(true);
  vi.mocked(getSumitPublicConfig).mockResolvedValue({ companyId: 12345, apiPublicKey: 'pub-key' });
  vi.mocked(previewCampaignHoldSizing).mockResolvedValue({ holdAmount: 80, ceiling: 600, full: 10, covered: 10 });
  vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
  vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: 'dana@example.com' } as never);
  vi.mocked(hasPlatformPermission).mockResolvedValue(false);
  vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
  vi.mocked(isCardcomPurchasePending).mockResolvedValue(false);
});

describe('payment page — a package campaign', () => {
  it('shows the package screen decided from the LEDGER, and nothing of the hold path', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120 }) as never);
    const html = await render();
    expect(html).toContain('data-marker="package-view"');
    expect(html).toContain('data-screen="form"');
    expect(html).toContain('data-config="yes"');
    for (const hold of ['hold-form', 'activate-now', 'held-analytics']) expect(html).not.toContain(`data-marker="${hold}"`);
    expect(html).not.toContain('תפיסה');
    expect(getPackagePaymentState).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(previewCampaignHoldSizing).not.toHaveBeenCalled();
    expect(getCampaignHoldsEnabled).not.toHaveBeenCalled();
  });

  it('decides "paid" from the ledger, not from a query string', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120 }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0 });
    expect(await render()).toContain('data-screen="paid"');
    // ...and a forged ?paid=1 with nothing recorded does not pretend
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
    expect(await render({ paid: '1' })).toContain('data-screen="form"');
  });

  it('a paid, approved package campaign can be started from here, and the page says why the automatic start did not happen', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120, status: 'approved' }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0 });
    const html = await render({ paid: '1', activate: 'no_contacts' });
    expect(html).toContain('data-screen="paid"');
    expect(html).toContain('data-activation="ready"');
    expect(html).toContain('data-can-activate="yes"');
    expect(html).toContain('data-activate-reason="no_contacts"');
    expect(await render({ activate: 'failed' })).toContain('data-activate-reason="failed"');
    // an `?activate=` value the page does not know is ignored, never echoed
    expect(await render({ activate: '<script>' })).toContain('data-activate-reason=""');
  });

  it('a paid package campaign that is already running says so', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120, status: 'active' }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0 });
    expect(await render()).toContain('data-activation="active"');
  });

  it('a campaign with an old-style hold on it is STILL a package campaign: no hold success screen, no activate-now', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120, capture_status: 'authorized', status: 'approved' }) as never);
    const html = await render();
    expect(html).toContain('data-marker="package-view"');
    expect(html).not.toContain('data-marker="activate-now"');
    expect(html).not.toContain('data-marker="held-analytics"');
  });

  it('an unreadable ledger is "unavailable", not an empty form', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120 }) as never);
    vi.mocked(getPackagePaymentState).mockRejectedValue(new Error('boom'));
    expect(await render()).toContain('data-screen="unavailable"');
  });

  it('closed gates, or a missing provider configuration, never produce a form', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120 }) as never);
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="unavailable"');
    vi.mocked(getPackageModelEnabled).mockResolvedValue(true);
    vi.mocked(getSumitPublicConfig).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('data-screen="unavailable"');
    expect(html).toContain('data-config="no"');
  });

  it('turns ?error= into one of OUR sentences only', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120 }) as never);
    expect(await render({ error: 'purchase_declined' })).toContain(`data-error="${PURCHASE_ERROR_MESSAGES.purchase_declined}"`);
    expect(await render({ error: '<script>alert(1)</script>' })).toContain('data-error=""');
  });

  it('a campaign that is not signed yet goes back to the signing step, as before', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120, status: 'pending_approval' }) as never);
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('payment page — a pay-per-result campaign is unchanged', () => {
  it('still gets the hold form (purpose "hold") and never asks the ledger', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign() as never);
    const html = await render();
    expect(html).toContain('data-marker="hold-form"');
    expect(html).toContain('data-purpose="hold"');
    expect(html).not.toContain('data-marker="package-view"');
    expect(getPackagePaymentState).not.toHaveBeenCalled();
  });

  it('an already-held campaign still offers "activate now"', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ capture_status: 'authorized', auth_amount: 80 }) as never);
    const html = await render({ activate: 'failed' });
    expect(html).toContain('data-marker="activate-now"');
  });
});

// Which clearing company's form the package screen shows is decided by resolvePurchaseProvider, with the same inputs the
// purchase routes use. SUMIT unless the CardCom pilot is on; on CardCom's test terminal only for someone who may configure it.
describe('payment page — the CardCom pilot', () => {
  const cardcom = (over: Record<string, unknown> = {}) => ({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true, ...over });
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ package_price: 120 }) as never);
  });

  it('shows SUMIT\'s form while CardCom is not configured or not switched on', async () => {
    expect(await render()).toContain('data-provider="sumit"');
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ enabled: false }) as never);
    expect(await render()).toContain('data-provider="sumit"');
  });

  it('shows CardCom\'s form when the pilot is on, with the buyer\'s e-mail, and needs no SUMIT public configuration', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(getSumitPublicConfig).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('data-provider="cardcom"');
    expect(html).toContain('data-screen="form"');
    expect(html).toContain('data-email="dana@example.com"');
    expect(html).toContain('data-phone="0501234567"');
  });

  it('keeps a customer on SUMIT when the pilot is on the TEST terminal; an admin is on CardCom', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: 1000 }) as never);
    expect(await render()).toContain('data-provider="sumit"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain('data-provider="cardcom"');
    expect(hasPlatformPermission).toHaveBeenCalledWith('integrations.manage');
  });

  it('a pending CardCom payment shows the form again (the same session is handed back); a pending SUMIT one stays "in progress"', async () => {
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending', collected: 0, credit: 0, committed: 0 });
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(isCardcomPurchasePending).mockResolvedValue(true);
    expect(await render()).toContain('data-screen="form"');
    vi.mocked(isCardcomPurchasePending).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="in_progress"');
  });

  it('does not even ask about a pending CardCom purchase when SUMIT is the provider or nothing is pending', async () => {
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending', collected: 0, credit: 0, committed: 0 });
    await render();
    expect(isCardcomPurchasePending).not.toHaveBeenCalled();
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
    await render();
    expect(isCardcomPurchasePending).not.toHaveBeenCalled();
  });

  it('says so on the form only when the connection is CardCom\'s TEST terminal', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: 1000 }) as never);
    expect(await render()).toContain('data-test-terminal="yes"');
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    expect(await render()).toContain('data-test-terminal="no"');
  });

  it('never says it for SUMIT\'s form, whatever terminal CardCom is configured with', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: 1000, enabled: false }) as never);
    expect(await render()).toContain('data-test-terminal="no"');
  });

  it('a payment that is test money says so on the paid screen; real money does not', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0, testMoney: true });
    expect(await render()).toContain('data-test-money="yes"');
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0 });
    expect(await render()).toContain('data-test-money="no"');
  });

  it('a closed gate still closes the CardCom form', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="unavailable"');
  });
});
