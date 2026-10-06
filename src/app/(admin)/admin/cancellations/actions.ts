'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { resolveCancellationRequest } from '@/lib/data/event-cancellation';
import { resolveCancellationRequestSchema } from '@/lib/validation/event-cancellation';
import type { FormState } from '@/lib/validation/result';

// Authorization is enforced inside resolveCancellationRequest
// (requirePlatformPermission('manage_billing')) — this action just parses
// and delegates.
export async function resolveCancellationRequestAction(
  requestId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resolveCancellationRequestSchema.safeParse({
    resolution: formData.get('resolution'),
    resolutionAmount: formData.get('resolutionAmount') || undefined,
    // An empty box is "not chosen" (the form shows one of the two inputs at a time, but never trust that).
    resolutionPercent: formData.get('resolutionPercent') || undefined,
    resolutionNote: formData.get('resolutionNote'),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    await resolveCancellationRequest(requestId, parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return {
      error: err instanceof Error ? err.message : 'טיפול בבקשת הביטול נכשל. נסו שוב.',
    };
  }

  revalidatePath('/admin/cancellations');
  revalidatePath(`/admin/cancellations/${requestId}`);
  return { notice: 'הבקשה טופלה — עדכון נשלח ללקוח' };
}
