'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { addToCallDnc } from '@/lib/data/admin/call-dnc';
import type { FormState } from '@/lib/validation/result';

// Form-friendly: the phone is normalized (E.164) inside the DAL — validate only
// length here. reason is optional free text; '' is mapped to null in the DAL.
const addToCallDncSchema = z.object({
  phone: z.string().trim().min(6).max(32),
  reason: z.string().trim().max(200).default(''),
});

export async function addToCallDncAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = addToCallDncSchema.safeParse({
    phone: formData.get('phone') ?? '',
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let result: Awaited<ReturnType<typeof addToCallDnc>>;
  try {
    result = await addToCallDnc(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'הוספה לרשימת ה-DNC נכשלה. נסו שוב.' };
  }
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath('/admin/dnc');
  return { notice: 'נוסף לרשימת החסימה' };
}
