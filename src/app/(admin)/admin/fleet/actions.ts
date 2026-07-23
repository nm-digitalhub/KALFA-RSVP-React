'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { answerFleetRequest } from '@/lib/data/admin/fleet';
import type { FormState } from '@/lib/validation/result';

const PATH = '/admin/fleet';

// One action serves all three request kinds; the verdict arrives from the
// pressed submit button (name="verdict"). Kind<->verdict validity, pending-only
// and expiry are enforced by the fleet_answer_request RPC — this layer only
// validates shape and maps failures to safe Hebrew messages.
const answerSchema = z.object({
  id: z.uuid({ message: 'מזהה פנייה לא תקין' }),
  verdict: z.enum(['approved', 'denied', 'answered'], {
    message: 'סוג מענה לא תקין',
  }),
  answer: z
    .string()
    .trim()
    .max(2000, { message: 'התשובה ארוכה מדי (עד 2000 תווים)' }),
});

export async function answerFleetRequestAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();

  const parsed = answerSchema.safeParse({
    id: formData.get('id') ?? '',
    verdict: formData.get('verdict') ?? '',
    answer: formData.get('answer') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await answerFleetRequest({
      id: parsed.data.id,
      verdict: parsed.data.verdict,
      answer: parsed.data.answer === '' ? null : parsed.data.answer,
    });
    await logActivity({
      action: 'fleet_request.answered',
      meta: { request_id: parsed.data.id, verdict: parsed.data.verdict },
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'שמירת המענה נכשלה' };
  }

  revalidatePath(PATH);
  // The detail page renders the same request — refresh it too so the timeline
  // reflects the verdict without a manual reload.
  revalidatePath(`${PATH}/${parsed.data.id}`);
  return { notice: 'המענה נשמר — הסוכן יקלוט אותו בריצה הבאה' };
}
