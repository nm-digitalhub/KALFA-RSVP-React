'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { createFaqItem, deleteFaqItem, updateFaqItem } from '@/lib/data/admin/faq';
import { FAQ_CATEGORIES, type FaqCategory } from '@/lib/faq/page-model';
import type { FormState } from '@/lib/validation/result';

// Server actions for /admin/faq. The protected-row guard (never unpublish or
// reword `pricing_no_response`) lives in the DAL (src/lib/data/admin/faq.ts),
// re-checked there against the DB by row id — not here, and not left to the
// form simply not rendering the fields. Everything here is ordinary Zod
// input validation + the thin call-the-DAL-and-report shape every other
// admin action in this codebase uses (see channels/actions.ts).

const categorySchema = z.enum(FAQ_CATEGORIES as [FaqCategory, ...FaqCategory[]]);

const createFaqItemSchema = z.object({
  category: categorySchema,
  question: z.string().trim().min(1, { error: 'השאלה חובה' }).max(300),
  answer: z.string().trim().max(4000).default(''),
  sort_order: z.coerce.number().int().min(0).max(9999),
  published: z.boolean(),
});

export async function createFaqItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createFaqItemSchema.safeParse({
    category: formData.get('category') ?? '',
    question: formData.get('question') ?? '',
    answer: formData.get('answer') ?? '',
    sort_order: (formData.get('sort_order') || '0') as string,
    // Unchecked checkboxes are absent from FormData → false.
    published: formData.get('published') === 'on',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await createFaqItem(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'יצירת השאלה נכשלה. נסו שוב.' };
  }
  revalidatePath('/admin/faq');
  revalidatePath('/faq');
  return { notice: 'השאלה נוספה' };
}

const updateFaqItemSchema = z.object({
  id: z.uuid(),
  question: z.string().trim().min(1, { error: 'השאלה חובה' }).max(300),
  answer: z.string().trim().max(4000).default(''),
  sort_order: z.coerce.number().int().min(0).max(9999),
  published: z.boolean(),
});

// Handles BOTH an ordinary row's full edit AND the protected row's
// answer-only (supplement) + sort_order edit — the DAL is what decides which
// fields actually apply for the protected row; this action just validates
// shape and passes everything through.
export async function updateFaqItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateFaqItemSchema.safeParse({
    id: formData.get('id') ?? '',
    question: formData.get('question') ?? '',
    answer: formData.get('answer') ?? '',
    sort_order: (formData.get('sort_order') || '0') as string,
    published: formData.get('published') === 'on',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateFaqItem(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'עדכון השאלה נכשל. נסו שוב.' };
  }
  revalidatePath('/admin/faq');
  revalidatePath('/faq');
  return { notice: 'השאלה נשמרה' };
}

// Bound with `id` (see DeleteFaqItemForm). Inline list delete — no redirect
// (unlike /admin/packages/[id], this isn't a detail page that becomes
// invalid), just revalidate both the admin list and the public page.
export async function deleteFaqItemAction(
  id: string,
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _prevState;
  void _formData;
  try {
    await deleteFaqItem(id);
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'מחיקת השאלה נכשלה. נסו שוב.' };
  }
  revalidatePath('/admin/faq');
  revalidatePath('/faq');
  return { notice: 'השאלה נמחקה' };
}
