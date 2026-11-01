import { beforeEach, describe, expect, it, vi } from 'vitest';

// The SUMIT connection form: the gate lives in updateSumitCredentials, so these tests cover the wrapper — an absent
// field reaches the data layer as '' (a blank key is a value, never null), the company id keeps its Hebrew message, a
// failure keeps its fixed message, and nothing typed into the form comes back to the browser.

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/admin/settings', () => ({ updateSumitCredentials: vi.fn() }));

import { revalidatePath } from 'next/cache';

import { updateSumitCredentials } from '@/lib/data/admin/settings';

import { updateSumitCredentialsAction } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe('updateSumitCredentialsAction', () => {
  it('saves the trimmed fields and returns only the notice — no secret travels back', async () => {
    const result = await updateSumitCredentialsAction(
      {},
      fd({ sumit_company_id: ' 123456 ', sumit_api_public_key: 'pub', sumit_api_key: ' secret-key ' }),
    );

    expect(updateSumitCredentials).toHaveBeenCalledWith({
      sumit_company_id: '123456',
      sumit_api_public_key: 'pub',
      sumit_api_key: 'secret-key',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/integrations/sumit');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/integrations');
    expect(result).toEqual({ data: { notice: 'פרטי SUMIT נשמרו' } });
  });

  it('reads an absent field as empty', async () => {
    await updateSumitCredentialsAction({}, fd({}));

    expect(updateSumitCredentials).toHaveBeenCalledWith({
      sumit_company_id: '',
      sumit_api_public_key: '',
      sumit_api_key: '',
    });
  });

  it('refuses a non-numeric company id in Hebrew, before anything is saved', async () => {
    const result = await updateSumitCredentialsAction({}, fd({ sumit_company_id: 'abc' }));

    expect(result.validationErrors?.fieldErrors?.sumit_company_id).toEqual(['מזהה חברה חייב להכיל ספרות בלבד']);
    expect(updateSumitCredentials).not.toHaveBeenCalled();
  });

  it('keeps its fixed message when the save fails', async () => {
    vi.mocked(updateSumitCredentials).mockRejectedValue(new Error('db down'));

    expect(await updateSumitCredentialsAction({}, fd({ sumit_company_id: '1' }))).toEqual({
      serverError: 'עדכון פרטי SUMIT נכשל. נסו שוב.',
    });
  });
});
