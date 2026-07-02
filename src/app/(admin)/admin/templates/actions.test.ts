import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/message-templates', () => ({ updateMessageTemplate: vi.fn() }));

import { updateMessageTemplate } from '@/lib/data/message-templates';
import { updateTemplateAction } from './actions';

const NEXT_REDIRECT = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/app;307;',
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FIELDS = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'תבנית',
  language: 'he',
  body: 'שלום',
};

beforeEach(() => vi.clearAllMocks());

describe('updateTemplateAction — Next.js control-flow signals (requireAdmin)', () => {
  it('propagates a NEXT_REDIRECT from updateMessageTemplate instead of returning { error }', async () => {
    vi.mocked(updateMessageTemplate).mockRejectedValue(NEXT_REDIRECT);

    await expect(updateTemplateAction(null, fd(FIELDS))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
  });

  it('converts a genuine (non-framework) error into the existing friendly message, not a thrown error', async () => {
    vi.mocked(updateMessageTemplate).mockRejectedValue(new Error('db down'));

    const result = await updateTemplateAction(null, fd(FIELDS));

    expect(result).toEqual({ error: 'עדכון התבנית נכשל. נסו שוב.' });
  });
});
