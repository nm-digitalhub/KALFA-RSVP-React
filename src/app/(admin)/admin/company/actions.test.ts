import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/settings', () => ({ updateCompanySettings: vi.fn() }));

import { revalidatePath } from 'next/cache';

import { updateCompanySettings } from '@/lib/data/admin/settings';

import { updateCompanyAction } from './actions';

// The permission check and the write live in updateCompanySettings (the data layer); this action turns the form into
// its input and the outcome into a message.

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/access-denied;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const BLANK = {
  company_legal_name: '',
  company_legal_id: '',
  company_legal_address: '',
  company_contact_phone: '',
  company_contact_email: '',
  privacy_url: '',
  terms_url: '',
  warranty_text: '',
  company_instagram_url: '',
};

beforeEach(() => vi.clearAllMocks());

describe('updateCompanyAction', () => {
  it('saves trimmed values, blank and missing fields as blank, and says so', async () => {
    const result = await updateCompanyAction({}, fd({ company_legal_name: ' קאלפא בע״מ ', privacy_url: '' }));

    expect(updateCompanySettings).toHaveBeenCalledWith({ ...BLANK, company_legal_name: 'קאלפא בע״מ' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/company');
    expect(result).toEqual({ data: { notice: 'פרטי החברה נשמרו' } });
  });

  it('refuses an instagram address that is not a profile, with its Hebrew message, and writes nothing', async () => {
    const result = await updateCompanyAction({}, fd({ ...BLANK, company_instagram_url: 'https://x.com/kalfa' }));

    expect(result).toEqual({
      validationErrors: {
        formErrors: [],
        fieldErrors: { company_instagram_url: ['כתובת פרופיל אינסטגרם לא תקינה (https://www.instagram.com/שם_משתמש/)'] },
      },
    });
    expect(updateCompanySettings).not.toHaveBeenCalled();
  });

  it('answers any failure of the write with the fixed line', async () => {
    vi.mocked(updateCompanySettings).mockRejectedValueOnce(new Error('עדכון פרטי החברה נכשל'));

    expect(await updateCompanyAction({}, fd(BLANK))).toEqual({ serverError: 'עדכון פרטי החברה נכשל. נסו שוב.' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lets the permission check's redirect through", async () => {
    vi.mocked(updateCompanySettings).mockRejectedValueOnce(NEXT_REDIRECT);

    await expect(updateCompanyAction({}, fd(BLANK))).rejects.toThrow('NEXT_REDIRECT');
  });
});
