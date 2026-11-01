import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permissionMock, updateMock, eqMock, revalidateMock } = vi.hoisted(() => ({
  permissionMock: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permissionMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ update: updateMock }) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

import { saveAgreementConfigAction } from './config-actions';

// The agreement-config section of /admin/agreement: free-form values the terms read live. Empty means an intentional
// unset (NULL); the write runs under manage_settings through the cookie client, and any failure is one fixed sentence.

const VALUES = {
  serviceActivationWindow: ' 5 ימי עסקים ',
  offerValidityDays: '14',
  liabilityCap: '',
  retentionDays: '24 חודשים',
  recordRetentionMonths: '84',
};

function form(values: Record<string, string> = VALUES) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  permissionMock.mockResolvedValue({ id: 'staff-1' });
  updateMock.mockReturnValue({ eq: eqMock });
  eqMock.mockResolvedValue({ error: null });
});

describe('saveAgreementConfigAction', () => {
  it('saves trimmed values, an empty one as NULL, under manage_settings, and says so', async () => {
    expect(await saveAgreementConfigAction({}, form())).toEqual({ data: { notice: 'הגדרות החוזה נשמרו' } });
    expect(permissionMock).toHaveBeenCalledWith('manage_settings');
    expect(updateMock).toHaveBeenCalledWith({
      agr_service_activation_window: '5 ימי עסקים',
      agr_offer_validity_days: '14',
      agr_liability_cap: null,
      agr_retention_days: '24 חודשים',
      agr_record_retention_months: '84',
    });
    expect(eqMock).toHaveBeenCalledWith('id', true);
    expect(revalidateMock).toHaveBeenCalledWith('/admin/agreement');
  });

  it('a field the form did not send is stored as NULL, like an empty one', async () => {
    await saveAgreementConfigAction({}, form({ offerValidityDays: '14' }));
    expect(updateMock).toHaveBeenCalledWith({
      agr_service_activation_window: null,
      agr_offer_validity_days: '14',
      agr_liability_cap: null,
      agr_retention_days: null,
      agr_record_retention_months: null,
    });
  });

  it('a refused write gets the fixed sentence and refreshes nothing', async () => {
    eqMock.mockResolvedValue({ error: { code: '42501', message: 'permission denied for table app_settings' } });
    const result = await saveAgreementConfigAction({}, form());
    expect(result).toEqual({ serverError: 'עדכון הגדרות החוזה נכשל. נסו שוב.' });
    expect(JSON.stringify(result)).not.toContain('permission denied');
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('a thrown failure gets the same sentence', async () => {
    eqMock.mockRejectedValue(new Error('fetch failed'));
    expect(await saveAgreementConfigAction({}, form())).toEqual({ serverError: 'עדכון הגדרות החוזה נכשל. נסו שוב.' });
  });

  it('lets the permission gate’s redirect through and writes nothing', async () => {
    permissionMock.mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/access-denied;307;' }),
    );
    await expect(saveAgreementConfigAction({}, form())).rejects.toMatchObject({
      digest: expect.stringContaining('/access-denied'),
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
