'use server';

import { revalidatePath } from 'next/cache';

import { updateContactStatus } from '@/lib/data/admin/contacts';
import { updateContactStatusSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Update a single contact message's status. Validates the closed status
// vocabulary server-side; authorization is enforced inside
// updateContactStatus (requirePlatformPermission).
export async function updateContactStatusAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateContactStatusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateContactStatus(parsed.data.id, parsed.data.status);
  } catch (err) {
    // Re-throw Next.js control-flow signals (e.g. redirect from the DAL gate);
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

  revalidatePath('/admin/contacts');
  return { notice: 'הסטטוס עודכן' };
}
