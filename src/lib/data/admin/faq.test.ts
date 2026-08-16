import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockSupabase,
  type MockQueryBuilder,
  type QueryResult,
} from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { PROTECTED_FAQ_ITEM_KEY } from '@/lib/faq/page-model';
import { createFaqItem, deleteFaqItem, listAllFaqItems, updateFaqItem } from './faq';

// Two independent protection layers on this DAL, both re-checked against a
// fresh DB read BY ID — never trusted from the caller's input:
//   - Tier 1 (item_key === PROTECTED_FAQ_ITEM_KEY): the ₪200-unconditional
//     disclosure row. question/published are locked; only answer/sort_order
//     ever apply.
//   - Tier 2 (is_structural, a superset including Tier 1 plus the §14ג
//     cancellation row): no delete, ever; every edit is audited.
// These tests submit deliberately tampered requests and assert the tamper is
// dropped, not merely that a "clean" request works.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));

type Result = QueryResult<unknown>;
type Builder = MockQueryBuilder<unknown>;

// Yields `results` in order across successive awaits of the SAME table (the
// last entry repeats) — mirrors src/lib/data/orgs-role-permissions.test.ts's
// sequencedBuilder. Needed here because updateFaqItem/deleteFaqItem each
// call `.from('faq_items')` twice (a read-back, then the write).
function sequencedBuilder(results: Result[]): Builder {
  const builder = createMockSupabase(results[0]).builder;
  let i = 0;
  builder.then = ((onFulfilled: (v: Result) => unknown) => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return onFulfilled(r);
  }) as typeof builder.then;
  return builder;
}

function wireClient(results: Result[]): Builder {
  const builder = sequencedBuilder(results);
  const from = vi.fn(() => builder);
  vi.mocked(createClient).mockResolvedValue(
    { from } as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({} as never);
});

const PROTECTED_ROW = {
  item_key: PROTECTED_FAQ_ITEM_KEY,
  question: 'אם אף אחד לא יענה, האם עדיין אני משלם?',
  published: true,
  is_structural: true,
};

const CANCELLATION_ROW = {
  item_key: null,
  question: 'אפשר לבטל אחרי שחתמתי?',
  published: true,
  is_structural: true,
};

describe('updateFaqItem — Tier 1 (protected item_key) guard', () => {
  it('drops a tampered published=false and a tampered question; still applies the supplement + sort_order', async () => {
    const builder = wireClient([
      { data: PROTECTED_ROW, error: null }, // the read-back by id
      { data: null, error: null }, // the update
    ]);

    await updateFaqItem({
      id: 'row-1',
      question: 'ניסוח מזויף', // tampered
      answer: 'הערה משלימה',
      sort_order: 5,
      published: false, // tampered — trying to unpublish the mandated disclosure
    });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        question: PROTECTED_ROW.question, // NOT the tampered value
        published: true, // NOT the tampered value
        answer: 'הערה משלימה', // the optional supplement IS applied
        sort_order: 5, // ordering IS applied
      }),
    );
  });

  it('applies question/published exactly as submitted for an ordinary (non-structural) row', async () => {
    const builder = wireClient([
      { data: { item_key: null, question: 'ישן', published: true, is_structural: false }, error: null },
      { data: null, error: null },
    ]);

    await updateFaqItem({
      id: 'row-2',
      question: 'שאלה חדשה',
      answer: 'תשובה',
      sort_order: 2,
      published: false,
    });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'שאלה חדשה', published: false }),
    );
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('updateFaqItem — Tier 2 (is_structural) audit', () => {
  it('the protected row (Tier 1, also is_structural) is audited on every edit', async () => {
    wireClient([
      { data: PROTECTED_ROW, error: null },
      { data: null, error: null },
    ]);
    await updateFaqItem({ id: 'row-1', question: 'x', answer: 'y', sort_order: 1, published: true });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'faq_item.update_structural' }),
    );
  });

  it('the §14ג cancellation row: content edits ARE applied, but the edit is still audited', async () => {
    const builder = wireClient([
      { data: CANCELLATION_ROW, error: null },
      { data: null, error: null },
    ]);
    await updateFaqItem({
      id: 'row-3',
      question: 'ניסוח מעודכן',
      answer: 'תשובה מעודכנת',
      sort_order: 1,
      published: true,
    });
    // Unlike Tier 1, the wording itself is NOT locked for a Tier-2-only row.
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'ניסוח מעודכן', answer: 'תשובה מעודכנת' }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'faq_item.update_structural' }),
    );
  });
});

describe('deleteFaqItem — is_structural guard', () => {
  it('refuses the protected (Tier 1) row and never calls .delete()', async () => {
    const builder = wireClient([{ data: PROTECTED_ROW, error: null }]);
    await expect(deleteFaqItem('row-1')).rejects.toThrow(/לא ניתן למחוק/);
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('refuses the §14ג cancellation row (is_structural, NOT the protected item_key) too', async () => {
    const builder = wireClient([{ data: CANCELLATION_ROW, error: null }]);
    await expect(deleteFaqItem('row-3')).rejects.toThrow(/לא ניתן למחוק/);
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('deletes an ordinary (non-structural) row', async () => {
    const builder = wireClient([
      { data: { is_structural: false }, error: null },
      { data: null, error: null },
    ]);
    await deleteFaqItem('row-2');
    expect(builder.delete).toHaveBeenCalled();
  });
});

describe('createFaqItem', () => {
  it('never inserts an item_key, regardless of input shape', async () => {
    const builder = wireClient([{ data: null, error: null }]);
    await createFaqItem({
      category: 'about',
      question: 'שאלה',
      answer: 'תשובה',
      sort_order: 1,
      published: true,
    });
    const insertedArg = builder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedArg).not.toHaveProperty('item_key');
  });
});

describe('listAllFaqItems', () => {
  it('is gated by manage_settings', async () => {
    wireClient([{ data: [], error: null }]);
    await listAllFaqItems();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});
