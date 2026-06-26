'use server';

import { revalidatePath } from 'next/cache';

import { updateCallbackStatus } from '@/lib/data/admin/callbacks';
import { updateCallbackStatusSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Update a single callback request's status. Validates the closed status
// vocabulary server-side; authorization is enforced inside updateCallbackStatus
// (requireAdmin) and by RLS. Returns a typed FormState for useActionState.
export async function updateCallbackStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateCallbackStatusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateCallbackStatus(parsed.data.id, parsed.data.status);
  } catch (err) {
    // Re-throw Next.js control-flow signals (e.g. redirect from requireAdmin);
    // catching them would silently break the redirect.
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err;
    }
    return { error: 'עדכון הסטטוס נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/callbacks');
  return { notice: 'הסטטוס עודכן' };
}
