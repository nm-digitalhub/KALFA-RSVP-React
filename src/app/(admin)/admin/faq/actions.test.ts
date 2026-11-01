import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual };
});
vi.mock('@/lib/data/admin/faq', () => ({
  createFaqItem: vi.fn(),
  updateFaqItem: vi.fn(),
  deleteFaqItem: vi.fn(),
}));

import { createFaqItem, deleteFaqItem, updateFaqItem } from '@/lib/data/admin/faq';
import {
  createFaqItemAction,
  deleteFaqItemAction,
  updateFaqItemAction,
} from './actions';

// The bound row id is validated (bindArgsSchemas: z.uuid()).
const ROW_1 = '33333333-3333-4333-8333-333333333333';
const ROW_2 = '44444444-4444-4444-8444-444444444444';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createFaqItemAction', () => {
  it('rejects a blank question with a field error, never calling the DAL', async () => {
    const result = await createFaqItemAction(
      {},
      fd({ category: 'about', question: '  ', answer: 'x', sort_order: '1', published: 'on' }),
    );
    expect(result.validationErrors?.fieldErrors?.question).toBeTruthy();
    expect(createFaqItem).not.toHaveBeenCalled();
  });

  it('rejects a category outside the fixed 4-value set', async () => {
    const result = await createFaqItemAction(
      {},
      fd({ category: 'not_a_real_category', question: 'ש', answer: 'ת', sort_order: '1', published: 'on' }),
    );
    expect(result.validationErrors?.fieldErrors?.category).toBeTruthy();
    expect(createFaqItem).not.toHaveBeenCalled();
  });

  it('an unchecked "published" checkbox (absent from FormData) parses as false, not an error', async () => {
    vi.mocked(createFaqItem).mockResolvedValue(undefined);
    const result = await createFaqItemAction(
      {},
      fd({ category: 'about', question: 'ש', answer: 'ת', sort_order: '1' }),
    );
    expect(result.serverError).toBeUndefined();
    expect(createFaqItem).toHaveBeenCalledWith(expect.objectContaining({ published: false }));
  });

  it('on success, calls the DAL with the parsed values and reports a notice', async () => {
    vi.mocked(createFaqItem).mockResolvedValue(undefined);
    const result = await createFaqItemAction(
      {},
      fd({ category: 'pricing', question: 'שאלה', answer: 'תשובה', sort_order: '3', published: 'on' }),
    );
    expect(createFaqItem).toHaveBeenCalledWith({
      category: 'pricing',
      question: 'שאלה',
      answer: 'תשובה',
      sort_order: 3,
      published: true,
    });
    expect(result.data?.notice).toBeTruthy();
  });
});

describe('updateFaqItemAction', () => {
  it('rejects an invalid id (not a uuid)', async () => {
    const result = await updateFaqItemAction(
      {},
      fd({ id: 'not-a-uuid', question: 'ש', answer: 'ת', sort_order: '1', published: 'on' }),
    );
    expect(result.validationErrors?.fieldErrors?.id).toBeTruthy();
    expect(updateFaqItem).not.toHaveBeenCalled();
  });

  it('surfaces the DAL error message verbatim (e.g. the protected-row refusal)', async () => {
    vi.mocked(updateFaqItem).mockRejectedValue(new Error('לא ניתן למחוק שאלה זו'));
    const result = await updateFaqItemAction(
      {},
      fd({
        id: '11111111-1111-4111-8111-111111111111',
        question: 'ש',
        answer: 'ת',
        sort_order: '1',
        published: 'on',
      }),
    );
    expect(result.serverError).toBe('לא ניתן למחוק שאלה זו');
  });

  it('on success, calls the DAL and reports a notice', async () => {
    vi.mocked(updateFaqItem).mockResolvedValue(undefined);
    const result = await updateFaqItemAction(
      {},
      fd({
        id: '11111111-1111-4111-8111-111111111111',
        question: 'ש',
        answer: 'ת',
        sort_order: '4',
        published: 'on',
      }),
    );
    expect(updateFaqItem).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      question: 'ש',
      answer: 'ת',
      sort_order: 4,
      published: true,
    });
    expect(result.data?.notice).toBeTruthy();
  });
});

describe('deleteFaqItemAction', () => {
  it('surfaces the DAL refusal for the protected row instead of throwing', async () => {
    vi.mocked(deleteFaqItem).mockRejectedValue(
      new Error('לא ניתן למחוק שאלה זו — היא כוללת גילוי מחויב על פי חוק הגנת הצרכן'),
    );
    const result = await deleteFaqItemAction(ROW_1, {}, fd({}));
    expect(result.serverError).toContain('לא ניתן למחוק');
  });

  it('on success, calls the DAL with the bound id and reports a notice', async () => {
    vi.mocked(deleteFaqItem).mockResolvedValue(undefined);
    const result = await deleteFaqItemAction(ROW_2, {}, fd({}));
    expect(deleteFaqItem).toHaveBeenCalledWith(ROW_2);
    expect(result.data?.notice).toBeTruthy();
  });
});
