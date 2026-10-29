import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
// redirect() throws a NEXT_REDIRECT control-flow signal in real Next; model it so a redirect, and its absence, is observable.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }),
}));
vi.mock('@/lib/data/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn(), getEvent: vi.fn(), canAccessEvent: vi.fn() }));
vi.mock('../../campaign-actions', () => ({ closeEventAction: vi.fn() }));
// The setup shell is real; its two client parts are markers, so the page's arrangement is observable.
vi.mock('../../../setup-stepper', () => ({
  SetupStepper: ({ steps }: { steps: Array<{ key: string; state: string }> }) => (
    <div data-marker="stepper" data-steps={steps.map((s) => `${s.key}:${s.state}`).join(',')} />
  ),
}));
vi.mock('../../../event-status-actions', () => ({
  EventStatusActions: ({ closeAllowed, blockedHint }: { closeAllowed: boolean; blockedHint: string | null }) => (
    <div data-marker="close-control" data-allowed={String(closeAllowed)} data-hint={blockedHint ?? ''} />
  ),
}));
vi.mock('@/lib/data/profiles', () => ({ getProfile: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getPackageModelEnabled: vi.fn(),
  getSumitPublicConfig: vi.fn(),
}));
vi.mock('@/lib/payments/package-purchase', () => ({ getPackagePaymentState: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ hasPlatformPermission: vi.fn(), requireUser: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/data/cardcom-config')>()), getCardcomServerConfig: vi.fn() }));
vi.mock('@/lib/payments/cardcom-pending', () => ({ isCardcomPurchasePending: vi.fn() }));
vi.mock('./package-payment-view', () => ({
  PackagePaymentView: (props: {
    screen: { kind: string; activation?: string; testTerminal?: boolean; testMoney?: boolean };
    errorMessage: string | null;
    formConfig: unknown;
    provider?: string;
    googlePayTerminal?: number | null;
    signerEmail?: string;
    signerPhone?: string;
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
      data-google-pay={props.googlePayTerminal == null ? 'no' : String(props.googlePayTerminal)}
      data-email={props.signerEmail ?? ''}
      data-phone={props.signerPhone ?? ''}
    />
  ),
}));

import { redirect } from 'next/navigation';

import { getCampaign } from '@/lib/data/campaigns';
import { canAccessEvent, getEvent, requireOwnedEvent } from '@/lib/data/events';
import { CLOSE_BLOCKED_MONEY_ERROR } from '@/lib/data/event-lifecycle';
import { getProfile } from '@/lib/data/profiles';
import { getPackageModelEnabled, getPaymentsEnabled, getSumitPublicConfig } from '@/lib/data/payments';
import { hasPlatformPermission, requireUser } from '@/lib/auth/dal';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { isCardcomPurchasePending } from '@/lib/payments/cardcom-pending';
import { getPackagePaymentState } from '@/lib/payments/package-purchase';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';
import CampaignPaymentPage from './page';

// The payment step: a package campaign is paid by one purchase, decided from the payment ledger. It is a setup step
// (design D2/D3, task 3.3): it renders inside the setup shell, and once the event is in management the owner is sent to
// the event page.

const EVENT_ID = 'e1';
const CAMPAIGN_ID = 'c1';
const EVENT_PAGE = `/app/events/${EVENT_ID}`;
const EVENT_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function campaign(over: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    event_id: EVENT_ID,
    status: 'approved',
    price: 120,
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
    name: 'החתונה',
    status: 'active',
    event_date: EVENT_DATE,
  } as never);
  vi.mocked(getEvent).mockResolvedValue({
    id: EVENT_ID,
    name: 'החתונה',
    status: 'active',
    event_type: 'wedding',
    event_date: EVENT_DATE,
    venue_name: 'אולם',
    venue_address: 'הרצל 1',
    celebrants: { groom: 'דני', bride: 'דנה' },
  } as never);
  vi.mocked(canAccessEvent).mockResolvedValue(true);
  vi.mocked(getProfile).mockResolvedValue({ id: 'u1', full_name: 'דנה כהן', phone: '0501234567', updated_at: null } as never);
  vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
  vi.mocked(getPackageModelEnabled).mockResolvedValue(true);
  vi.mocked(getSumitPublicConfig).mockResolvedValue({ companyId: 12345, apiPublicKey: 'pub-key' });
  vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
  vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: 'dana@example.com' } as never);
  vi.mocked(hasPlatformPermission).mockResolvedValue(false);
  vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
  vi.mocked(isCardcomPurchasePending).mockResolvedValue(false);
});


afterEach(() => vi.unstubAllEnvs());

describe('payment page — a package campaign', () => {
  it('shows the package screen decided from the LEDGER', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    const html = await render();
    expect(html).toContain('data-marker="package-view"');
    expect(html).toContain('data-screen="form"');
    expect(html).toContain('data-config="yes"');
    expect(html).not.toContain('תפיסה');
    expect(getPackagePaymentState).toHaveBeenCalledWith(CAMPAIGN_ID);
  });

  it('decides "paid" from the ledger, not from a query string: paid is management, so the event page', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0 });
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(EVENT_PAGE);
    // ...and a forged ?paid=1 with nothing recorded does not pretend
    vi.mocked(redirect).mockClear();
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
    expect(await render({ paid: '1' })).toContain('data-screen="form"');
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['paid, not running yet', 'approved', {}],
    ['paid with test money', 'approved', { testMoney: true }],
    ['running', 'active', {}],
    ['paused', 'paused', {}],
  ] as const)('%s → the event page, whatever an older link says (D2)', async (_label, status, money) => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120, status }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0, ...money });
    await expect(render({ paid: '1', activate: 'failed' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(EVENT_PAGE);
  });

  it('a closed event, or a cancelled campaign, is not a payment step: the event page', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(requireOwnedEvent).mockResolvedValue({ id: EVENT_ID, name: 'החתונה', status: 'closed', event_date: EVENT_DATE } as never);
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith(EVENT_PAGE);

    vi.mocked(requireOwnedEvent).mockResolvedValue({ id: EVENT_ID, name: 'החתונה', status: 'active', event_date: EVENT_DATE } as never);
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120, status: 'cancelled' }) as never);
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenLastCalledWith(EVENT_PAGE);
  });

  it('money that support has to look at stays here and says so, with no redirect', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'refunded', collected: 0, credit: 0, committed: 0 });
    expect(await render()).toContain('data-screen="unavailable"');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('an unreadable ledger is "unavailable", not an empty form, and in place: no redirect (task 3.8)', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(getPackagePaymentState).mockRejectedValue(new Error('boom'));
    expect(await render()).toContain('data-screen="unavailable"');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('closed gates, or a missing provider configuration, never produce a form', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="unavailable"');
    vi.mocked(getPackageModelEnabled).mockResolvedValue(true);
    vi.mocked(getSumitPublicConfig).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('data-screen="unavailable"');
    expect(html).toContain('data-config="no"');
  });

  it('turns ?error= into one of OUR sentences only', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    expect(await render({ error: 'purchase_declined' })).toContain(`data-error="${PURCHASE_ERROR_MESSAGES.purchase_declined}"`);
    expect(await render({ error: '<script>alert(1)</script>' })).toContain('data-error=""');
  });

  it('a campaign whose terms are not approved yet goes back to the approval step', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120, status: 'pending_approval' }) as never);
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('payment page — inside the setup shell (task 3.3)', () => {
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
  });

  it('shows the step list once, with the payment as the current step, above the payment screen', async () => {
    const html = await render();
    expect(html.split('data-marker="stepper"').length - 1).toBe(1);
    expect(html).toContain('pay:current');
    expect(html.indexOf('data-marker="stepper"')).toBeLessThan(html.indexOf('data-marker="package-view"'));
    expect(html).toContain('הקמת אישורי הגעה');
  });

  it('offers the close inside the shell, as the event lifecycle model decides, to a viewer who may close', async () => {
    let html = await render();
    expect(html.split('data-marker="close-control"').length - 1).toBe(1);
    expect(html).toContain('data-allowed="true"');
    expect(canAccessEvent).toHaveBeenCalledWith(EVENT_ID, 'events', 'close');

    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending', collected: 0, credit: 0, committed: 0 });
    html = await render();
    expect(html).toContain('data-allowed="false"');
    expect(html).toContain(`data-hint="${CLOSE_BLOCKED_MONEY_ERROR}"`);

    vi.mocked(canAccessEvent).mockResolvedValue(false);
    expect(await render()).not.toContain('data-marker="close-control"');
  });
});

describe('payment page — a campaign without a package', () => {
  it('was created under the earlier model and is sent to its campaign page, without reading the ledger', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: null, status: 'closed' }) as never);
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(getPackagePaymentState).not.toHaveBeenCalled();
  });
});

// Which clearing company's form the package screen shows is decided by resolvePurchaseProvider, with the same inputs the
// purchase routes use. SUMIT unless the CardCom pilot is on; on CardCom's test terminal only for someone who may configure it.
describe('payment page — the CardCom pilot', () => {
  const cardcom = (over: Record<string, unknown> = {}) => ({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true, saveCardOnPurchase: false, googlePayMode: 'off', ...over });
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
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

  it('keeps a customer on SUMIT when the pilot is on the TEST terminal against the hosted project; an admin is on CardCom', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co'); // the hosted project: a local one opens the test terminal
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: 1000 }) as never);
    expect(await render()).toContain('data-provider="sumit"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain('data-provider="cardcom"');
    expect(hasPlatformPermission).toHaveBeenCalledWith('integrations.manage');
  });

  it('puts a customer on CardCom\'s TEST terminal when the server runs against a local database, and says it is a test', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: 1000 }) as never);
    const html = await render();
    expect(html).toContain('data-provider="cardcom"');
    expect(html).toContain('data-test-terminal="yes"');
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

  it('a closed gate still closes the CardCom form', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="unavailable"');
  });
});

// Google Pay (add-google-pay-cardcom): the PAGE decides whether it is offered, from the server-side setting, the buyer's rights,
// the provider and the save-card setting, and hands the form the terminal of the same configuration that opens the session.
describe('payment page — Google Pay', () => {
  const cardcom = (over: Record<string, unknown> = {}) => ({ terminalNumber: 172204, apiName: 'kalfa-api', enabled: true, saveCardOnPurchase: false, googlePayMode: 'off', ...over });
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
  });

  it('is not offered while the setting is off, to a buyer or to an administrator', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'off' }) as never);
    expect(await render()).toContain('data-google-pay="no"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain('data-google-pay="no"');
  });

  it('is offered to every buyer through CardCom when the setting is all, with the terminal of the connection', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all' }) as never);
    const html = await render();
    expect(html).toContain('data-provider="cardcom"');
    expect(html).toContain('data-google-pay="172204"');
  });

  it('is offered only to someone who may configure the integration when the setting is admins', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'admins' }) as never);
    expect(await render()).toContain('data-google-pay="no"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain('data-google-pay="172204"');
    expect(hasPlatformPermission).toHaveBeenCalledWith('integrations.manage');
  });

  it('is never offered on SUMIT\'s form, whatever the setting is', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all', enabled: false }) as never);
    const html = await render();
    expect(html).toContain('data-provider="sumit"');
    expect(html).toContain('data-google-pay="no"');
  });

  it('is withheld while the card must be saved', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all', saveCardOnPurchase: true }) as never);
    expect(await render()).toContain('data-google-pay="no"');
  });

  it('is not offered when the CardCom connection cannot be read', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
    expect(await render()).toContain('data-google-pay="no"');
  });

  it('is not offered to an ordinary buyer on CardCom\'s test terminal even when the setting is all (they stay on SUMIT)', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all', terminalNumber: 1000 }) as never);
    const html = await render();
    expect(html).toContain('data-provider="sumit"');
    expect(html).toContain('data-google-pay="no"');
  });
});
