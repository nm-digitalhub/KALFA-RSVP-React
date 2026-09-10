// The regression this file exists for is a SILENT DELETION, not a broken render.
//
// This branch has already lost a component in a move once — b09240b, "restore the
// auto-save that replacing the TopBar silently removed" — and the consolidation plan's
// own readiness review found that the WhatsApp consent toggle fell outside every copy
// range in Task 0.3 and would have vanished with it. The Voximplant panel carries the
// same class of surface: a §30א consent gate and three kill switches that permit real,
// paid dialing. A test is the difference between a move and a deletion.
//
// It also pins the two things this page must NEVER do:
//   1. call getOutreachMasterState() for a viewer without manage_settings — that
//      function redirects, so the call itself ejects them from the admin area;
//   2. put the service-account JSON in the page tree.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformPermission: vi.fn(),
  hasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/admin/voximplant-channel', () => ({ getVoximplantChannelConfig: vi.fn() }));
vi.mock('@/lib/data/admin/outreach-master', () => ({ getOutreachMasterState: vi.fn() }));
vi.mock('@/lib/data/admin/voice-ops', () => ({
  getVoiceBalanceTile: vi.fn(),
  getVoximplantWiringTile: vi.fn(),
}));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn() }));

import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { getVoximplantChannelConfig } from '@/lib/data/admin/voximplant-channel';
import { getOutreachMasterState } from '@/lib/data/admin/outreach-master';
import { getVoiceBalanceTile, getVoximplantWiringTile } from '@/lib/data/admin/voice-ops';
import { getAppUrl } from '@/lib/url';

import VoximplantIntegrationPage from './page';

/** Flattens the element tree into its props, so text/href assertions need no DOM. */
function collect(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (el.props) out.push({ ...el.props, __type: el.type });
  collect(el.props?.children, out);
  return out;
}

const textOf = (tree: unknown) =>
  collect(tree)
    .map((p) => (typeof p.children === 'string' ? p.children : ''))
    .join(' ');

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

/** Every string that appears anywhere in the tree's props, as values not as markup.
 *  JSON.stringify cannot be used here — React elements carry circular references. */
function allStrings(tree: unknown): string[] {
  const out: string[] = [];
  for (const props of collect(tree)) {
    for (const [key, value] of Object.entries(props)) {
      if (key === '__type' || key === 'children') continue;
      if (typeof value === 'string') out.push(value);
    }
    if (typeof props.children === 'string') out.push(props.children);
  }
  return out;
}

const SERVICE_ACCOUNT_JSON = '{"account_id":1,"private_key":"SERVICE-ACCOUNT-KEY"}';

async function render({ manageSettings = true }: { manageSettings?: boolean } = {}) {
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'u1' } as never);
  vi.mocked(hasPlatformPermission).mockResolvedValue(manageSettings as never);
  vi.mocked(getVoximplantChannelConfig).mockResolvedValue({
    // Presence only — the DAL never returns the JSON itself. The literal below stands
    // in for "a value that must not reach the tree by any route".
    serviceAccountConfigured: true,
    voximplant_rule_id: '1494311',
    voximplant_caller_id: '+97237219347',
    voximplant_callback_secret: 'CALLBACK-SECRET',
    voximplant_low_balance_threshold: '5',
    voximplant_min_call_reserve: '0.1',
    voximplant_max_concurrent_calls: '5',
    voximplant_max_calls_per_campaign_hour: '200',
    configured: true,
    fullyConfigured: true,
    liveCalls: true,
    liveEnabled: true,
    callConsentRequired: true,
    meetingConfirmRuleId: '1523903',
    meetingConfirmEnabled: false,
    meetingConfirmFullyConfigured: true,
    salesCallRuleId: '1523906',
    salesCallsEnabled: false,
    salesCallFullyConfigured: true,
  } as never);
  vi.mocked(getOutreachMasterState).mockResolvedValue({
    enabled: true,
    anyChannelReady: true,
  } as never);
  vi.mocked(getVoiceBalanceTile).mockResolvedValue({
    status: 'ok',
    balance: 12.34,
    currency: 'USD',
    lowBalanceThreshold: 5,
    minCallReserve: 0.1,
    callbackUrlEcho: null,
  } as never);
  vi.mocked(getVoximplantWiringTile).mockResolvedValue({
    state: 'wired',
    tokenSet: true,
    wiredAt: '2026-09-01T10:00:00Z',
    lastCallbackAt: '2026-09-10T10:00:00Z',
  } as never);
  vi.mocked(getAppUrl).mockImplementation((async (path: string) =>
    `https://beta.kalfa.me${path}`) as never);
  return VoximplantIntegrationPage();
}

describe('/admin/integrations/voximplant', () => {
  it('gates on manage_voice, not manage_settings', async () => {
    await render();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_voice');
    expect(requirePlatformPermission).not.toHaveBeenCalledWith('manage_settings');
  });

  it('renders every moved control — none silently dropped', async () => {
    const names = componentNames(await render());
    expect(names).toContain('VoximplantStatusCard');
    expect(names).toContain('VoximplantLiveCallsToggle');
    expect(names).toContain('VoximplantMeetingConfirmToggle');
    expect(names).toContain('VoximplantSalesCallToggle');
    // The §30א gate. Its WhatsApp twin is the component the plan's copy ranges missed.
    expect(names).toContain('VoximplantConsentToggle');
    expect(names).toContain('VoximplantCredentialsForm');
    expect(names).toContain('VoximplantConnectionTest');
  });

  it('never reads the master switch without manage_settings — the call itself redirects', async () => {
    vi.mocked(getOutreachMasterState).mockClear();
    const tree = await render({ manageSettings: false });
    expect(getOutreachMasterState).not.toHaveBeenCalled();
    expect(componentNames(tree)).not.toContain('OutreachMasterSwitch');
  });

  it('passes the master state as null — not false — when it cannot be read', async () => {
    // "switched off" and "you may not see whether it is switched off" are different
    // facts. Collapsing them sends an operator to debug a switch that is actually on.
    const card = collect(await render({ manageSettings: false })).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'VoximplantStatusCard',
    );
    expect(card?.outreachEnabled).toBeNull();
  });

  it('shows the master switch to a viewer who may operate it', async () => {
    expect(componentNames(await render())).toContain('OutreachMasterSwitch');
  });

  it('never puts the service-account JSON in the page tree', async () => {
    // The callback secret IS returned to the form, masked with a reveal toggle (owner
    // ruling 2026-08-24). The service-account private key is presence-only and must not
    // appear at all — a different and worse regression, so it gets its own assertion.
    const strings = allStrings(await render()).join(' ');
    expect(strings).not.toContain('SERVICE-ACCOUNT-KEY');
    expect(strings).not.toContain(SERVICE_ACCOUNT_JSON);
  });

  it('never renders a credential as page text', async () => {
    const text = textOf(await render());
    expect(text).not.toContain('CALLBACK-SECRET');
  });

  it('states the three gates a live call has to pass', async () => {
    const text = textOf(await render());
    expect(text).toContain('מתג הפנייה הראשי');
    expect(text).toContain('VOXIMPLANT_LIVE_CALLS');
  });

  it('distinguishes the on-demand test from the scheduled balance check', async () => {
    const text = textOf(await render());
    expect(text).toContain('בדיקת חיבור');
    expect(text).toContain('לא מתבצעת שיחה');
  });

  it('links back to the index and out to the surfaces that kept their content', async () => {
    const hrefs = collect(await render())
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
    expect(hrefs).toContain('/admin/voice/platform');
    expect(hrefs).toContain('/admin/settings');
  });

  it('passes both scenario base URLs through to the credentials form', async () => {
    const form = collect(await render()).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'VoximplantCredentialsForm',
    );
    expect(form?.voxCtxBase).toBe('https://beta.kalfa.me/api/voximplant/ctx');
    expect(form?.voxCbBase).toBe('https://beta.kalfa.me/api/voximplant/cb');
  });
});
