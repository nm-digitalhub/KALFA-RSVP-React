'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { createFaqItem, deleteFaqItem, updateFaqItem } from '@/lib/data/admin/faq';
import { FAQ_CATEGORIES, type FaqCategory } from '@/lib/faq/page-model';
import { actionClient, returnUserError } from '@/lib/safe-action';

// Server actions for /admin/faq. The protected-row guard (never unpublish or
// reword `pricing_no_response`) lives in the DAL (src/lib/data/admin/faq.ts),
// re-checked there against the DB by row id — not here, and not left to the
// form simply not rendering the fields. Everything here is ordinary Zod
// input validation + the thin call-the-DAL-and-report shape every other
// admin action in this codebase uses.
//
// The form's fields: a missing text field counts as blank (''), a blank
// sort_order as 0, and an unchecked checkbox (absent from FormData) as false.

const categorySchema = z.enum(FAQ_CATEGORIES as [FaqCategory, ...FaqCategory[]]);
const sortOrderField = z.preprocess((v) => v || '0', z.coerce.number().int().min(0).max(9999));
const publishedField = z.preprocess((v) => v === 'on', z.boolean());

const createFaqItemSchema = zfd.formData({
  category: z.preprocess((v) => v ?? '', categorySchema),
  question: z.string().trim().min(1, { error: 'השאלה חובה' }).max(300).prefault(''),
  answer: z.string().trim().max(4000).prefault(''),
  sort_order: sortOrderField,
  published: publishedField,
});

export const createFaqItemAction = actionClient
  .inputSchema(createFaqItemSchema)
  .stateAction(async ({ parsedInput }) => {
    try {
      await createFaqItem(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      returnUserError('יצירת השאלה נכשלה. נסו שוב.');
    }
    revalidatePath('/admin/faq');
    revalidatePath('/faq');
    return { notice: 'השאלה נוספה' };
  });

const updateFaqItemSchema = zfd.formData({
  id: z.uuid().prefault(''),
  question: z.string().trim().min(1, { error: 'השאלה חובה' }).max(300).prefault(''),
  answer: z.string().trim().max(4000).prefault(''),
  sort_order: sortOrderField,
  published: publishedField,
});

// Handles BOTH an ordinary row's full edit AND the protected row's
// answer-only (supplement) + sort_order edit — the DAL is what decides which
// fields actually apply for the protected row; this action just validates
// shape and passes everything through.
export const updateFaqItemAction = actionClient
  .inputSchema(updateFaqItemSchema)
  .stateAction(async ({ parsedInput }) => {
    await updateFaqItem(parsedInput);
    revalidatePath('/admin/faq');
    revalidatePath('/faq');
    return { notice: 'השאלה נשמרה' };
  });

// Bound with `id` (see DeleteFaqItemButton). Inline list delete — no redirect
// (unlike /admin/packages/[id], this isn't a detail page that becomes
// invalid), just revalidate both the admin list and the public page.
export const deleteFaqItemAction = actionClient
  .inputSchema(zfd.formData({}))
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ bindArgsParsedInputs: [id] }) => {
    await deleteFaqItem(id);
    revalidatePath('/admin/faq');
    revalidatePath('/faq');
    return { notice: 'השאלה נמחקה' };
  });
