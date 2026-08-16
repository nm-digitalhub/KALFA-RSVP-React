import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      null,
      fd({ category: 'about', question: '  ', answer: 'x', sort_order: '1', published: 'on' }),
    );
    expect(result?.fieldErrors?.question).toBeTruthy();
    expect(createFaqItem).not.toHaveBeenCalled();
  });

  it('rejects a category outside the fixed 4-value set', async () => {
    const result = await createFaqItemAction(
      null,
      fd({ category: 'not_a_real_category', question: 'ש', answer: 'ת', sort_order: '1', published: 'on' }),
    );
    expect(result?.fieldErrors?.category).toBeTruthy();
    expect(createFaqItem).not.toHaveBeenCalled();
  });

  it('an unchecked "published" checkbox (absent from FormData) parses as false, not an error', async () => {
    vi.mocked(createFaqItem).mockResolvedValue(undefined);
    const result = await createFaqItemAction(
      null,
      fd({ category: 'about', question: 'ש', answer: 'ת', sort_order: '1' }),
    );
    expect(result?.error).toBeUndefined();
    expect(createFaqItem).toHaveBeenCalledWith(expect.objectContaining({ published: false }));
  });

  it('on success, calls the DAL with the parsed values and reports a notice', async () => {
    vi.mocked(createFaqItem).mockResolvedValue(undefined);
    const result = await createFaqItemAction(
      null,
      fd({ category: 'pricing', question: 'שאלה', answer: 'תשובה', sort_order: '3', published: 'on' }),
    );
    expect(createFaqItem).toHaveBeenCalledWith({
      category: 'pricing',
      question: 'שאלה',
      answer: 'תשובה',
      sort_order: 3,
      published: true,
    });
    expect(result?.notice).toBeTruthy();
  });
});

describe('updateFaqItemAction', () => {
  it('rejects an invalid id (not a uuid)', async () => {
    const result = await updateFaqItemAction(
      null,
      fd({ id: 'not-a-uuid', question: 'ש', answer: 'ת', sort_order: '1', published: 'on' }),
    );
    expect(result?.fieldErrors?.id).toBeTruthy();
    expect(updateFaqItem).not.toHaveBeenCalled();
  });

  it('surfaces the DAL error message verbatim (e.g. the protected-row refusal)', async () => {
    vi.mocked(updateFaqItem).mockRejectedValue(new Error('לא ניתן למחוק שאלה זו'));
    const result = await updateFaqItemAction(
      null,
      fd({
        id: '11111111-1111-4111-8111-111111111111',
        question: 'ש',
        answer: 'ת',
        sort_order: '1',
        published: 'on',
      }),
    );
    expect(result?.error).toBe('לא ניתן למחוק שאלה זו');
  });

  it('on success, calls the DAL and reports a notice', async () => {
    vi.mocked(updateFaqItem).mockResolvedValue(undefined);
    const result = await updateFaqItemAction(
      null,
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
    expect(result?.notice).toBeTruthy();
  });
});

describe('deleteFaqItemAction', () => {
  it('surfaces the DAL refusal for the protected row instead of throwing', async () => {
    vi.mocked(deleteFaqItem).mockRejectedValue(
      new Error('לא ניתן למחוק שאלה זו — היא כוללת גילוי מחויב על פי חוק הגנת הצרכן'),
    );
    const result = await deleteFaqItemAction('row-1', null, fd({}));
    expect(result?.error).toContain('לא ניתן למחוק');
  });

  it('on success, calls the DAL with the bound id and reports a notice', async () => {
    vi.mocked(deleteFaqItem).mockResolvedValue(undefined);
    const result = await deleteFaqItemAction('row-2', null, fd({}));
    expect(deleteFaqItem).toHaveBeenCalledWith('row-2');
    expect(result?.notice).toBeTruthy();
  });
});
