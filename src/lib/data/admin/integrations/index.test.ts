// The index's job is to be honest about what the viewer may do, and the two ways it
// could lie are: showing a link that ejects them, or hiding a provider they can use.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformStaff: vi.fn(),
  hasPlatformPermission: vi.fn(),
  isPlatformOwner: vi.fn(),
}));
vi.mock('@/lib/ops/db-health', () => ({ getJobHealth: vi.fn() }));
vi.mock('@/lib/ops/integrations', () => ({ getIntegrationsStatus: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { hasPlatformPermission, isPlatformOwner, requirePlatformStaff } from '@/lib/auth/dal';
import { getJobHealth } from '@/lib/ops/db-health';
import { getIntegrationsStatus } from '@/lib/ops/integrations';
import { createClient } from '@/lib/supabase/server';

import { getIntegrationsIndex } from './index';

const STATUS = [
  { key: 'elevenlabs', label: 'ElevenLabs', configured: true, enabled: true, lastCheckedAt: 'T1', healthCheckAvailable: true },
  { key: 'voximplant', label: 'Voximplant', configured: true, enabled: true, lastCheckedAt: 'T2', healthCheckAvailable: true },
  { key: 'slack', label: 'Slack', configured: true, enabled: true, lastCheckedAt: null, healthCheckAvailable: true },
  { key: 'whatsapp', label: 'WhatsApp', configured: true, enabled: false, lastCheckedAt: null, healthCheckAvailable: false },
  { key: 'sumit', label: 'SUMIT', configured: true, enabled: true, lastCheckedAt: null, healthCheckAvailable: false },
  { key: 'extra-sms', label: 'ExtrA SMS', configured: true, enabled: false, lastCheckedAt: null, healthCheckAvailable: false },
  { key: 'resend-email', label: 'דואר יוצא', configured: true, enabled: true, lastCheckedAt: null, healthCheckAvailable: false },
  { key: 'ga4', label: 'Google Analytics 4', configured: true, enabled: true, lastCheckedAt: null, healthCheckAvailable: false },
];

function mockPermissionLabels(rows: Array<{ key: string; label: string }> | null) {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ in: inFn });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
}

/** `keys` = the permissions this viewer holds. */
function viewer(keys: string[], { owner = false } = {}) {
  vi.mocked(isPlatformOwner).mockResolvedValue(owner);
  vi.mocked(hasPlatformPermission).mockImplementation(async (k: string) => keys.includes(k));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformStaff).mockResolvedValue({ id: 'u1' } as never);
  vi.mocked(getIntegrationsStatus).mockResolvedValue(STATUS as never);
  vi.mocked(getJobHealth).mockResolvedValue({ ok: true, data: [] } as never);
  mockPermissionLabels([
    { key: 'manage_settings', label: 'ניהול הגדרות מערכת' },
    { key: 'manage_voice', label: 'ניהול מוקד שיחות AI' },
  ]);
  viewer([]);
});

const byKey = async () => {
  const idx = await getIntegrationsIndex();
  return { idx, cards: Object.fromEntries(idx.cards.map((c) => [c.key, c])) };
};

describe('getIntegrationsIndex', () => {
  it('gates on the STAFF FLOOR, not on manage_settings', async () => {
    // The page is navigation + read-only status. Gating the whole thing on the
    // permission that opens most destinations would hide the status from staff who
    // legitimately need to see it, and would make the gate a function of who happens
    // to be employed rather than of what the page contains.
    await getIntegrationsIndex();
    expect(requirePlatformStaff).toHaveBeenCalledTimes(1);
  });

  it('shows every provider to a viewer with NO permissions, all locked', async () => {
    const { cards } = await byKey();
    expect(Object.keys(cards)).toHaveLength(7);
    for (const card of Object.values(cards)) {
      expect(card.canOpen).toBe(false);
      expect(card.href).toBeNull(); // "no permission", never a link that redirects
    }
  });

  it('opens exactly the cards the viewer\'s permission covers', async () => {
    viewer(['manage_voice']); // the ops shape: voice but not settings
    const { cards } = await byKey();
    expect(cards.voximplant.canOpen).toBe(true);
    expect(cards.elevenlabs.canOpen).toBe(true);
    expect(cards['meta-whatsapp'].canOpen).toBe(false);
    expect(cards.slack.canOpen).toBe(false);
  });

  it('opens the six settings cards for a manage_settings holder', async () => {
    viewer(['manage_settings']);
    const { cards } = await byKey();
    expect(cards['meta-whatsapp'].canOpen).toBe(true);
    expect(cards.slack.canOpen).toBe(true);
    expect(cards['extra-sms'].canOpen).toBe(true);
    expect(cards.voximplant.canOpen).toBe(false); // manage_voice, not settings
  });

  it('an owner opens everything without holding a single key', async () => {
    viewer([], { owner: true });
    const { idx, cards } = await byKey();
    expect(Object.values(cards).every((c) => c.canOpen)).toBe(true);
    expect(idx.canManageSettings).toBe(true);
  });

  it('shows the write surfaces only to manage_settings', async () => {
    viewer(['manage_voice']);
    expect((await getIntegrationsIndex()).canManageSettings).toBe(false);
    viewer(['manage_settings']);
    expect((await getIntegrationsIndex()).canManageSettings).toBe(true);
  });

  // ops_job_health raises 'platform owner only' INSIDE the function (verified live).
  // Asking for it as a non-owner would return a soft failure every time; asking at
  // all is the mistake.
  it('does not even ask for job health unless the viewer is an owner', async () => {
    viewer(['manage_settings']);
    const { idx } = await byKey();
    expect(getJobHealth).not.toHaveBeenCalled();
    expect(idx.showsLastChecked).toBe(false);
    expect(vi.mocked(getIntegrationsStatus).mock.calls[0][0]).toEqual([]);
  });

  it('asks for it, and reports it, for an owner', async () => {
    viewer([], { owner: true });
    const { idx, cards } = await byKey();
    expect(getJobHealth).toHaveBeenCalledTimes(1);
    expect(idx.showsLastChecked).toBe(true);
    expect(cards.voximplant.lastCheckedAt).toBe('T2');
  });

  it('degrades rather than throwing when job health fails for an owner', async () => {
    vi.mocked(getJobHealth).mockResolvedValue({ ok: false, reason: 'boom' } as never);
    viewer([], { owner: true });
    const { idx } = await byKey();
    expect(idx.showsLastChecked).toBe(false);
    expect(idx.cards).toHaveLength(7);
  });

  it('leaves GA4 out — nobody connects it from the panel', async () => {
    const { cards } = await byKey();
    expect(cards.ga4).toBeUndefined();
  });

  it('never invents a card the shared status source stopped returning', async () => {
    vi.mocked(getIntegrationsStatus).mockResolvedValue(
      STATUS.filter((s) => s.key !== 'slack') as never,
    );
    const { cards } = await byKey();
    expect(cards.slack).toBeUndefined();
    expect(Object.keys(cards)).toHaveLength(6);
  });

  it('carries configured and enabled through separately', async () => {
    // The ExtrA bug in miniature: configured and switched-off is not "not configured".
    viewer(['manage_settings']);
    const { cards } = await byKey();
    expect(cards['extra-sms']).toMatchObject({ configured: true, enabled: false });
    expect(cards['meta-whatsapp']).toMatchObject({ configured: true, enabled: false });
  });

  it('resolves each distinct permission once, not once per card', async () => {
    viewer(['manage_settings']);
    await getIntegrationsIndex();
    // Two distinct keys across seven cards.
    expect(vi.mocked(hasPlatformPermission).mock.calls.map((c) => c[0]).sort()).toEqual([
      'manage_settings',
      'manage_voice',
    ]);
  });

  it('labels the missing permission from the database, not a hardcoded map', async () => {
    const { cards } = await byKey();
    expect(cards.voximplant.permissionLabel).toBe('ניהול מוקד שיחות AI');
    expect(cards.slack.permissionLabel).toBe('ניהול הגדרות מערכת');
  });

  it('falls back to the raw key rather than blanking the hint', async () => {
    mockPermissionLabels(null);
    const { cards } = await byKey();
    expect(cards.voximplant.permissionLabel).toBe('manage_voice');
  });
});
