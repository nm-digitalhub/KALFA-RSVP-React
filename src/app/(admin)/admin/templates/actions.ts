'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import {
  acknowledgeTemplateCategory,
  updateMessageTemplate,
} from '@/lib/data/message-templates';
import type { FormState } from '@/lib/validation/result';

const schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(200).default(''),
  language: z.string().trim().max(16).default('he'),
  body: z.string().trim().max(4000).default(''),
});

export async function updateTemplateAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse({
    id: formData.get('id'),
    name: formData.get('name') ?? '',
    language: formData.get('language') ?? '',
    body: formData.get('body') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const active = formData.get('active') === 'on';
  // Fail-closed: a template can only be activated once it has content (the
  // Meta-approved WhatsApp template name, or a call script).
  if (active && !parsed.data.name && !parsed.data.body) {
    return {
      error: 'לא ניתן להפעיל תבנית ללא שם תבנית מאושר / תוכן. מלאו תחילה ושמרו.',
    };
  }

  try {
    await updateMessageTemplate(parsed.data.id, {
      name: parsed.data.name,
      language: parsed.data.language,
      body: parsed.data.body,
      active,
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון התבנית נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/templates');
  return { notice: active ? 'נשמר — התבנית פעילה' : 'התבנית נשמרה' };
}

// Accept Meta's category for a template that drifted (D4). Not a fix — Meta
// classifies by message body and the template goes on being billed as MARKETING;
// this records that we expect it, so the badge clears, the nightly alert stops,
// and a LATER move by Meta alerts again as a new transition.
//
// The category the admin was LOOKING AT is posted alongside the id and the DAL
// pins the write to it, so a sync landing between page load and click cannot get a
// different value accepted silently.
const acknowledgeSchema = z.object({
  id: z.uuid(),
  observed_category: z.string().trim().min(1).max(32),
});

export async function acknowledgeTemplateCategoryAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = acknowledgeSchema.safeParse({
    id: formData.get('id'),
    observed_category: formData.get('observed_category') ?? '',
  });
  if (!parsed.success) return { error: 'בקשה לא תקינה' };

  try {
    const result = await acknowledgeTemplateCategory(
      parsed.data.id,
      parsed.data.observed_category,
    );
    if (!result.ok) return { error: result.reason };
    revalidatePath('/admin/templates');
    return {
      notice: `הקטגוריה ${result.to} אושרה — ההתראה על הפער תיפסק. החיוב והמגבלות של הקטגוריה הזו נשארים בתוקף.`,
    };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'אישור הקטגוריה נכשל. נסו שוב.' };
  }
}
