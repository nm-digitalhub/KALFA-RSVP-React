'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { updateMessageTemplate } from '@/lib/data/message-templates';
import type { FormState } from '@/lib/validation/result';

function isNextControlFlow(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
      (err as { digest: string }).digest === 'NEXT_NOT_FOUND')
  );
}

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
    if (isNextControlFlow(err)) throw err;
    return { error: 'עדכון התבנית נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/templates');
  return { notice: active ? 'נשמר — התבנית פעילה' : 'התבנית נשמרה' };
}
