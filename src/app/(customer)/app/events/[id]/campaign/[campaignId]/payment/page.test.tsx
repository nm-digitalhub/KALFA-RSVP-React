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
vi.mock('@/lib/data/payments', () => ({ getPaymentsEnabled: vi.fn(), getPackageModelEnabled: vi.fn() }));
vi.mock('@/lib/payments/package-paid', () => ({ getPackagePaymentState: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ hasPlatformPermission: vi.fn(), requireUser: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/data/cardcom-config')>()), getCardcomServerConfig: vi.fn() }));
vi.mock('@/lib/payments/cardcom-pending', () => ({ isCardcomPurchasePending: vi.fn() }));
vi.mock('./package-payment-view', () => ({
  PackagePaymentView: (props: {
    screen: { kind: string; activation?: string; testTerminal?: boolean; testMoney?: boolean };
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
import { getPackageModelEnabled, getPaymentsEnabled } from '@/lib/data/payments';
import { hasPlatformPermission, requireUser } from '@/lib/auth/dal';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { isCardcomPurchasePending } from '@/lib/payments/cardcom-pending';
import { getPackagePaymentState } from '@/lib/payments/package-paid';
import CampaignPaymentPage from './page';

// The payment step: a package campaign is paid by one purchase through CardCom, decided from the payment ledger. It is a
// setup step (design D2/D3, task 3.3): it renders inside the setup shell, and once the event is in management the owner
// is sent to the event page.

const EVENT_ID = 'e1';
const CAMPAIGN_ID = 'c1';
const EVENT_PAGE = `/app/events/${EVENT_ID}`;
const EVENT_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const LIVE_TERMINAL = 172204;
const TEST_TERMINAL = 1000;
// The hosted project: a server that runs against a local database opens CardCom's test terminal to every buyer.
const HOSTED_DATABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';

function campaign(over: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    event_id: EVENT_ID,
    status: 'approved',
    price: 120,
    ...over,
  };
}

// The CardCom connection: switched on, on a live terminal, unless a test says otherwise.
function cardcom(over: Record<string, unknown> = {}) {
  return { terminalNumber: LIVE_TERMINAL, apiName: 'kalfa-api', enabled: true, saveCardOnPurchase: false, googlePayMode: 'off', ...over };
}

async function render(): Promise<string> {
  const tree = await CampaignPaymentPage({ params: Promise.resolve({ id: EVENT_ID, campaignId: CAMPAIGN_ID }) });
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
  vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
  vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: 'dana@example.com' } as never);
  vi.mocked(hasPlatformPermission).mockResolvedValue(false);
  vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
  vi.mocked(isCardcomPurchasePending).mockResolvedValue(false);
});


afterEach(() => vi.unstubAllEnvs());

describe('payment page — a package campaign', () => {
  it('shows the package screen decided from the LEDGER', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    const html = await render();
    expect(html).toContain('data-marker="package-view"');
    expect(html).toContain('data-screen="form"');
    expect(html).not.toContain('תפיסה');
    expect(getPackagePaymentState).toHaveBeenCalledWith(CAMPAIGN_ID);
  });

  it('decides "paid" from the ledger: paid is management, so the event page; nothing recorded is the form', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0 });
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(EVENT_PAGE);
    vi.mocked(redirect).mockClear();
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
    expect(await render()).toContain('data-screen="form"');
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['paid, not running yet', 'approved', {}],
    ['paid with test money', 'approved', { testMoney: true }],
    ['running', 'active', {}],
    ['paused', 'paused', {}],
  ] as const)('%s → the event page (D2)', async (_label, status, money) => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120, status }) as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'collected', collected: 120, credit: 0, committed: 0, ...money });
    await expect(render()).rejects.toThrow('NEXT_REDIRECT');
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

  it('a closed gate never produces a form: payments off, the package model off', async () => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
    vi.mocked(getPaymentsEnabled).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="unavailable"');
    vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
    vi.mocked(getPackageModelEnabled).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="unavailable"');
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

// CardCom is the only clearing company. Whether its form is open to this buyer is decided by cardcomTakesPurchase, with
// the same inputs the purchase route uses: closed unless the switch is on, and on CardCom's test terminal open only to
// someone who may configure the integration (or to anyone on a server that runs against a local database).
describe('payment page — who CardCom takes the purchase from', () => {
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
  });

  it('shows no form while CardCom is not configured or not switched on', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
    expect(await render()).toContain('data-screen="unavailable"');
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ enabled: false }) as never);
    expect(await render()).toContain('data-screen="unavailable"');
  });

  it('shows the form when CardCom is on, with the buyer\'s e-mail and phone', async () => {
    const html = await render();
    expect(html).toContain('data-screen="form"');
    expect(html).toContain('data-email="dana@example.com"');
    expect(html).toContain('data-phone="0501234567"');
  });

  it('closes the form to a customer when CardCom is on the TEST terminal against the hosted project; an admin gets it', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED_DATABASE_URL);
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: TEST_TERMINAL }) as never);
    expect(await render()).toContain('data-screen="unavailable"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain('data-screen="form"');
    expect(hasPlatformPermission).toHaveBeenCalledWith('integrations.manage');
  });

  it('puts a customer on CardCom\'s TEST terminal when the server runs against a local database, and says it is a test', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: TEST_TERMINAL }) as never);
    const html = await render();
    expect(html).toContain('data-screen="form"');
    expect(html).toContain('data-test-terminal="yes"');
  });

  it('a pending payment shows the form again when its session can be handed back, and "in progress" otherwise', async () => {
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending', collected: 0, credit: 0, committed: 0 });
    vi.mocked(isCardcomPurchasePending).mockResolvedValue(true);
    expect(await render()).toContain('data-screen="form"');
    vi.mocked(isCardcomPurchasePending).mockResolvedValue(false);
    expect(await render()).toContain('data-screen="in_progress"');
  });

  it('does not even ask about a pending purchase when CardCom is closed to the buyer or nothing is pending', async () => {
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending', collected: 0, credit: 0, committed: 0 });
    vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
    await render();
    expect(isCardcomPurchasePending).not.toHaveBeenCalled();
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none', collected: 0, credit: 0, committed: 0 });
    await render();
    expect(isCardcomPurchasePending).not.toHaveBeenCalled();
  });

  it('says so on the form only when the connection is CardCom\'s TEST terminal', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: TEST_TERMINAL }) as never);
    expect(await render()).toContain('data-test-terminal="yes"');
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom() as never);
    expect(await render()).toContain('data-test-terminal="no"');
  });

  it('never says it while CardCom is switched off, whatever terminal it is configured with', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ terminalNumber: TEST_TERMINAL, enabled: false }) as never);
    expect(await render()).toContain('data-test-terminal="no"');
  });
});

// Google Pay (add-google-pay-cardcom): the PAGE decides whether it is offered, from the server-side setting, the buyer's
// rights, whether CardCom takes the purchase and the save-card setting, and hands the form the terminal of the same
// configuration that opens the session.
describe('payment page — Google Pay', () => {
  beforeEach(() => {
    vi.mocked(getCampaign).mockResolvedValue(campaign({ price: 120 }) as never);
  });

  it('is not offered while the setting is off, to a buyer or to an administrator', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'off' }) as never);
    expect(await render()).toContain('data-google-pay="no"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain('data-google-pay="no"');
  });

  it('is offered to every buyer when the setting is all, with the terminal of the connection', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all' }) as never);
    const html = await render();
    expect(html).toContain('data-screen="form"');
    expect(html).toContain(`data-google-pay="${LIVE_TERMINAL}"`);
  });

  it('is offered only to someone who may configure the integration when the setting is admins', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'admins' }) as never);
    expect(await render()).toContain('data-google-pay="no"');
    vi.mocked(hasPlatformPermission).mockResolvedValue(true);
    expect(await render()).toContain(`data-google-pay="${LIVE_TERMINAL}"`);
    expect(hasPlatformPermission).toHaveBeenCalledWith('integrations.manage');
  });

  it('is never offered while CardCom is switched off, whatever the setting is', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all', enabled: false }) as never);
    const html = await render();
    expect(html).toContain('data-screen="unavailable"');
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

  it('is not offered to an ordinary buyer on CardCom\'s test terminal even when the setting is all (the form is closed to them)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED_DATABASE_URL);
    vi.mocked(getCardcomServerConfig).mockResolvedValue(cardcom({ googlePayMode: 'all', terminalNumber: TEST_TERMINAL }) as never);
    const html = await render();
    expect(html).toContain('data-screen="unavailable"');
    expect(html).toContain('data-google-pay="no"');
  });
});
