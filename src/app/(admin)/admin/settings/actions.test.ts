import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/settings', () => ({
  updateAppSettings: vi.fn(),
  setBaseOveragePricingEnabled: vi.fn(),
}));
vi.mock('@/lib/data/agreements-doc', () => ({ getActiveAgreementDoc: vi.fn() }));
vi.mock('@/lib/agreements/template', () => ({
  BASE_FEE_AGREEMENT_VERSION: '2026-07-v4',
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import {
  updateAppSettings,
  setBaseOveragePricingEnabled,
} from '@/lib/data/admin/settings';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import {
  updateSettingsAction,
  updateBaseOveragePricingAction,
} from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = {
  sumit_company_id: '',
  sumit_api_public_key: '',
  sumit_api_key: '',
  extra_sms_sender: '',
  extra_sms_token: '',
  smtp_host: '',
  smtp_port: '',
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
};

beforeEach(() => vi.clearAllMocks());

describe('updateSettingsAction — Next.js control-flow signals (requireAdmin)', () => {
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

describe('updateBaseOveragePricingAction — fail-closed pricing gate', () => {
  const V4_APPROVED = {
    version: '2026-07-v4',
    status: 'approved' as const,
    bodyHtml: null,
  };

  it('refuses to ENABLE unless the active agreement is the approved v4 doc, and does NOT write', async () => {
    vi.mocked(getActiveAgreementDoc).mockResolvedValue({
      version: 'draft-2026-07-v3',
      status: 'approved',
      bodyHtml: null,
    });
    const r = await updateBaseOveragePricingAction(
      null,
      fd({ base_overage_pricing_enabled: 'on' }),
    );
    expect(r?.error).toContain('v4');
    expect(setBaseOveragePricingEnabled).not.toHaveBeenCalled();
  });

  it('refuses to ENABLE when the v4 doc is active but still a draft (not approved)', async () => {
    vi.mocked(getActiveAgreementDoc).mockResolvedValue({
      version: '2026-07-v4',
      status: 'draft',
      bodyHtml: null,
    });
    const r = await updateBaseOveragePricingAction(
      null,
      fd({ base_overage_pricing_enabled: 'on' }),
    );
    expect(r?.error).toBeTruthy();
    expect(setBaseOveragePricingEnabled).not.toHaveBeenCalled();
  });

  it('ENABLES when the active agreement is the approved v4 doc', async () => {
    vi.mocked(getActiveAgreementDoc).mockResolvedValue(V4_APPROVED);
    const r = await updateBaseOveragePricingAction(
      null,
      fd({ base_overage_pricing_enabled: 'on' }),
    );
    expect(setBaseOveragePricingEnabled).toHaveBeenCalledWith(true);
    expect(r?.notice).toBeTruthy();
  });

  it('DISABLES without any agreement check (no fail-closed guard on turning off)', async () => {
    const r = await updateBaseOveragePricingAction(null, fd({}));
    expect(getActiveAgreementDoc).not.toHaveBeenCalled();
    expect(setBaseOveragePricingEnabled).toHaveBeenCalledWith(false);
    expect(r?.notice).toBeTruthy();
  });

  it('propagates a framework redirect instead of swallowing it', async () => {
    vi.mocked(getActiveAgreementDoc).mockResolvedValue(V4_APPROVED);
    vi.mocked(setBaseOveragePricingEnabled).mockRejectedValueOnce(NEXT_REDIRECT);
    await expect(
      updateBaseOveragePricingAction(null, fd({ base_overage_pricing_enabled: 'on' })),
    ).rejects.toBe(NEXT_REDIRECT);
  });
});
