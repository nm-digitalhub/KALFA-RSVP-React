import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/settings', () => ({ updateAppSettings: vi.fn() }));

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
