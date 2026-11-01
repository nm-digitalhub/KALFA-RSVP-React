import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/agreements', () => ({
  updateAgreement: vi.fn(),
  approveAgreement: vi.fn(),
}));

import { approveAgreement, updateAgreement } from '@/lib/data/admin/agreements';
import { approveAgreementAction, saveAgreementAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = { version: '2026-01-01', body_html: '<p>text</p>' };

beforeEach(() => {
  vi.mocked(updateAgreement).mockReset();
  vi.mocked(approveAgreement).mockReset();
});

describe('saveAgreementAction — Next.js control-flow signals (requirePlatformPermission)', () => {
  it('propagates a NEXT_REDIRECT from updateAgreement instead of returning { serverError }', async () => {
    vi.mocked(updateAgreement).mockRejectedValue(NEXT_REDIRECT);

    await expect(saveAgreementAction({}, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('surfaces a genuine domain error message, not a thrown error', async () => {
    vi.mocked(updateAgreement).mockRejectedValue(new Error('גרסה כפולה'));

    const result = await saveAgreementAction({}, fd(FIELDS));

    expect(result).toEqual({ serverError: 'גרסה כפולה' });
  });

  it('falls back to the generic message for a non-Error rejection', async () => {
    vi.mocked(updateAgreement).mockRejectedValue('boom');

    const result = await saveAgreementAction({}, fd(FIELDS));

    expect(result).toEqual({ serverError: 'שמירת החוזה נכשלה' });
  });
});

describe('saveAgreementAction — what it saves', () => {
  it('passes the version and the body to the data layer', async () => {
    vi.mocked(updateAgreement).mockResolvedValue(undefined);
    await saveAgreementAction({}, fd(FIELDS));
    expect(updateAgreement).toHaveBeenCalledWith({ version: '2026-01-01', bodyHtml: '<p>text</p>' });
  });

  it('refuses a missing version before anything is saved', async () => {
    const result = await saveAgreementAction({}, fd({ ...FIELDS, version: '' }));
    expect(result?.validationErrors?.fieldErrors?.version).toEqual(['נא להזין גרסה']);
    expect(updateAgreement).not.toHaveBeenCalled();
  });
});

describe('approveAgreementAction', () => {
  it('approves the named version', async () => {
    vi.mocked(approveAgreement).mockResolvedValue(undefined);
    const result = await approveAgreementAction({}, fd({ version: '2026-10-v6' }));
    expect(approveAgreement).toHaveBeenCalledWith('2026-10-v6');
    expect(result).toEqual({ data: { notice: 'החוזה אושר — תג הטיוטה הוסר' } });
  });

  it('shows the data layer’s reason when approval is refused (an unknown token, a missing price token)', async () => {
    vi.mocked(approveAgreement).mockRejectedValue(new Error('בנוסח יש תחליפים שאינם מוכרים: {{pakagePrice}}'));
    const result = await approveAgreementAction({}, fd({ version: '2026-10-v6' }));
    expect(result).toEqual({ serverError: 'בנוסח יש תחליפים שאינם מוכרים: {{pakagePrice}}' });
  });
});
