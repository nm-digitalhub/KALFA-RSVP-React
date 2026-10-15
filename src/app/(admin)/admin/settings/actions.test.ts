import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/settings', () => ({
  updateAppSettings: vi.fn(),
}));

import { updateAppSettings } from '@/lib/data/admin/settings';
import { updateSettingsAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = { payments_enabled: 'on', billing_exposure_gate: 'on' };

beforeEach(() => vi.clearAllMocks());

describe('updateSettingsAction — Next.js control-flow signals (requirePlatformPermission)', () => {
  it('propagates a NEXT_REDIRECT from updateAppSettings instead of returning { error }', async () => {
    vi.mocked(updateAppSettings).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateSettingsAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateAppSettings).mockRejectedValue(new Error('db down'));

    const result = await updateSettingsAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'עדכון ההגדרות נכשל. נסו שוב.' });
  });
});

describe('updateSettingsAction — what it writes', () => {
  it('a checked box is on and an absent one is off', async () => {
    vi.mocked(updateAppSettings).mockResolvedValue(undefined);

    await updateSettingsAction(null, fd(FIELDS));

    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ payments_enabled: true, billing_exposure_gate: true, monitor_enabled: false }),
    );
  });

  it('writes none of the retired pay-per-result switches, even when a stale form sends them', async () => {
    vi.mocked(updateAppSettings).mockResolvedValue(undefined);

    await updateSettingsAction(
      null,
      fd({ ...FIELDS, close_charge_enabled: 'on', campaign_holds_enabled: 'on', reasonable_coverage_contacts: '300' }),
    );

    const written = vi.mocked(updateAppSettings).mock.calls[0][0];
    for (const retired of ['close_charge_enabled', 'campaign_holds_enabled', 'reasonable_coverage_contacts']) {
      expect(written).not.toHaveProperty(retired);
    }
  });
});
