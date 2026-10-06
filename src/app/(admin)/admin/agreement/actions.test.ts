import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/agreements', () => ({
  getAgreementStarterBody: vi.fn(),
  updateAgreement: vi.fn(),
  approveAgreement: vi.fn(),
  revertAgreementToTemplate: vi.fn(),
}));

import { approveAgreement, getAgreementStarterBody, updateAgreement } from '@/lib/data/admin/agreements';
import { approveAgreementAction, loadAgreementStarterAction, saveAgreementAction } from './actions';

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
  vi.mocked(getAgreementStarterBody).mockReset();
});

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

describe('saveAgreementAction — which contract it edits', () => {
  it('defaults to the pay-per-result contract when the form names no model', async () => {
    vi.mocked(updateAgreement).mockResolvedValue(undefined);
    await saveAgreementAction(null, fd(FIELDS));
    expect(updateAgreement).toHaveBeenCalledWith({ model: 'per_result', version: '2026-01-01', bodyHtml: '<p>text</p>' });
  });

  it('passes the package model through', async () => {
    vi.mocked(updateAgreement).mockResolvedValue(undefined);
    await saveAgreementAction(null, fd({ ...FIELDS, model: 'package' }));
    expect(updateAgreement).toHaveBeenCalledWith(expect.objectContaining({ model: 'package' }));
  });

  it('rejects a model it does not know, before anything is saved', async () => {
    const result = await saveAgreementAction(null, fd({ ...FIELDS, model: 'subscription' }));
    expect(result?.fieldErrors?.model).toEqual(['מודל חוזה לא מוכר']);
    expect(updateAgreement).not.toHaveBeenCalled();
  });
});

describe('approveAgreementAction', () => {
  it('approves the named model', async () => {
    vi.mocked(approveAgreement).mockResolvedValue(undefined);
    const result = await approveAgreementAction(null, fd({ version: '2026-10-v6', model: 'package' }));
    expect(approveAgreement).toHaveBeenCalledWith('2026-10-v6', 'package');
    expect(result).toEqual({ notice: 'החוזה אושר — תג הטיוטה הוסר' });
  });

  it('shows the data layer’s reason when approval is refused (an unknown token, a missing price token)', async () => {
    vi.mocked(approveAgreement).mockRejectedValue(new Error('בנוסח יש תחליפים שאינם מוכרים: {{pakagePrice}}'));
    const result = await approveAgreementAction(null, fd({ version: '2026-10-v6', model: 'package' }));
    expect(result).toEqual({ error: 'בנוסח יש תחליפים שאינם מוכרים: {{pakagePrice}}' });
  });
});

describe('loadAgreementStarterAction', () => {
  it('returns the current text as a template', async () => {
    vi.mocked(getAgreementStarterBody).mockResolvedValue('<h1>{{eventName}}</h1>');
    expect(await loadAgreementStarterAction()).toEqual({ body: '<h1>{{eventName}}</h1>' });
  });

  it('propagates a NEXT_REDIRECT (the permission gate) instead of returning an error', async () => {
    vi.mocked(getAgreementStarterBody).mockRejectedValue(NEXT_REDIRECT);
    await expect(loadAgreementStarterAction()).rejects.toThrow('NEXT_REDIRECT');
  });

  it('returns a safe error otherwise', async () => {
    vi.mocked(getAgreementStarterBody).mockRejectedValue('boom');
    expect(await loadAgreementStarterAction()).toEqual({ error: 'טעינת הנוסח הנוכחי נכשלה' });
  });
});
