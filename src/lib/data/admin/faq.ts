import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { PROTECTED_FAQ_ITEM_KEY, type FaqCategory } from '@/lib/faq/page-model';

// Admin editor DAL for /admin/faq (scope-change 16.8.2026 — FAQ copy is
// admin-managed DATA, not hardcoded strings in a page component, the same
// rule the project already applies to business facts). Modeled on
// src/lib/data/admin/channel-catalog.ts: manage_settings gate here, plus the
// admin-only RLS policy (faq_items_admin_all, has_role admin) as the second
// layer. Uses the normal cookie-authenticated client (not service-role), so
// every write is attributable to and re-checked against the signed-in
// admin's own session, not a service-role bypass.
//
// TWO independent protection layers, both enforced here (not in the UI):
//   - `is_structural` (any row whose WORDING carries legal weight — the
//     pricing disclosure AND the §14ג cancellation-rights row): no delete,
//     ever; every edit is written to activity_log. The text itself stays
//     admin-editable — the audit trail IS the protection.
//   - `item_key === 'pricing_no_response'`: a STRICT SUPERSET of the above,
//     specific to the one row with a live-data legal disclosure. `question`
//     and `published` are silently kept at their existing DB values
//     regardless of what is submitted; only `answer` (the optional
//     supplement) and `sort_order` ever apply. This is not "be careful
//     editing this" (that's is_structural) but a hard lockout.

export type AdminFaqItem = {
  id: string;
  item_key: string | null;
  category: FaqCategory;
  question: string;
  answer: string;
  sort_order: number;
  published: boolean;
  is_structural: boolean;
};

// ALL rows, including unpublished drafts — the admin list shows everything;
// only the public page filters to published. Ordered the same way the
// public page reads (category, then sort_order) so the admin list mirrors
// page order.
export async function listAllFaqItems(): Promise<AdminFaqItem[]> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('faq_items')
    .select('id, item_key, category, question, answer, sort_order, published, is_structural')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw new Error('טעינת השאלות הנפוצות נכשלה');
  return (data ?? []) as AdminFaqItem[];
}

export type CreateFaqItemInput = {
  category: FaqCategory;
  question: string;
  answer: string;
  sort_order: number;
  published: boolean;
};

// A newly created row can never carry `item_key` or `is_structural` — both
// protections are applied to specific, pre-existing rows (the migration's
// seed + this file's guards), never something the admin UI itself grants.
export async function createFaqItem(input: CreateFaqItemInput): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();
  const { error } = await supabase.from('faq_items').insert({
    category: input.category,
    question: input.question,
    answer: input.answer,
    sort_order: input.sort_order,
    published: input.published,
  });
  if (error) throw new Error('יצירת השאלה נכשלה');
}

export type UpdateFaqItemInput = {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  published: boolean;
};

// Guards re-read the row's protection flags from the DB by `id` FIRST —
// never trusts a client-submitted item_key/is_structural/published. For the
// Tier-1 protected row (pricing_no_response — the ₪200-unconditional
// disclosure), `question`/`published` are silently kept at their existing
// values regardless of what was posted; only `answer` (the optional
// supplement) and `sort_order` are ever actually applied. `category` is
// never editable for ANY row here (immutable after creation, like
// `channels.key` — a question moves section by being recreated there, not
// by an in-place category change).
//
// Any `is_structural` row (a strict superset that includes the protected
// row above, plus the §14ג cancellation row) gets its edit written to
// activity_log — logActivity() itself is fail-open/best-effort by design
// (see src/lib/data/activity.ts), so a logging hiccup never blocks the save.
export async function updateFaqItem(input: UpdateFaqItemInput): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from('faq_items')
    .select('item_key, question, published, is_structural')
    .eq('id', input.id)
    .maybeSingle();
  if (readError || !existing) throw new Error('השאלה לא נמצאה');

  const isProtected = existing.item_key === PROTECTED_FAQ_ITEM_KEY;
  const patch = {
    question: isProtected ? existing.question : input.question,
    answer: input.answer,
    sort_order: input.sort_order,
    published: isProtected ? true : input.published,
  };
  const { error } = await supabase.from('faq_items').update(patch).eq('id', input.id);
  if (error) throw new Error('עדכון השאלה נכשל');

  if (existing.is_structural) {
    await logActivity({
      action: 'faq_item.update_structural',
      meta: { id: input.id, item_key: existing.item_key },
    });
  }
}

// Refuses any `is_structural` row outright — re-checked here in the DAL, not
// left to the admin UI simply not rendering a delete button for it.
export async function deleteFaqItem(id: string): Promise<void> {
  await requirePlatformPermission('manage_settings');
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from('faq_items')
    .select('is_structural')
    .eq('id', id)
    .maybeSingle();
  if (readError || !existing) throw new Error('השאלה לא נמצאה');
  if (existing.is_structural) {
    throw new Error('לא ניתן למחוק שאלה זו — הניסוח שלה כולל גילוי מחויב על פי דין');
  }

  const { error } = await supabase.from('faq_items').delete().eq('id', id);
  if (error) throw new Error('מחיקת השאלה נכשלה');
}
