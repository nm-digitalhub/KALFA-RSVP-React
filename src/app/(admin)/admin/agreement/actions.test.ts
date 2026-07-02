import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/agreements', () => ({
  updateAgreement: vi.fn(),
  approveAgreement: vi.fn(),
  revertAgreementToTemplate: vi.fn(),
}));

import { updateAgreement } from '@/lib/data/admin/agreements';
import { saveAgreementAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = { version: '2026-01-01', body_html: '<p>text</p>' };

beforeEach(() => vi.clearAllMocks());

describe('saveAgreementAction — Next.js control-flow signals (requireAdmin)', () => {
  it('propagates a NEXT_REDIRECT from updateAgreement instead of returning { error }', async () => {
    vi.mocked(updateAgreement).mockRejectedValue(NEXT_REDIRECT);

    await expect(saveAgreementAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('surfaces a genuine domain error message, not a thrown error', async () => {
    vi.mocked(updateAgreement).mockRejectedValue(new Error('גרסה כפולה'));

    const result = await saveAgreementAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'גרסה כפולה' });
  });

  it('falls back to the generic message for a non-Error rejection', async () => {
    vi.mocked(updateAgreement).mockRejectedValue('boom');

    const result = await saveAgreementAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'שמירת החוזה נכשלה' });
  });
});
