'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { resolveCancellationRequest } from '@/lib/data/event-cancellation';
import { CancellationResolveError } from '@/lib/data/package-cancellation';
import { actionClient } from '@/lib/safe-action';
import { resolveCancellationRequestSchema } from '@/lib/validation/event-cancellation';

// The form's fields in the shape the shared schema parses. An empty amount or percentage box is "not chosen" (the form
// shows one of the two inputs at a time, but never trust that).
function readResolveForm(formData: FormData) {
  return {
    resolution: formData.get('resolution'),
    resolutionAmount: formData.get('resolutionAmount') || undefined,
    resolutionPercent: formData.get('resolutionPercent') || undefined,
    resolutionNote: formData.get('resolutionNote'),
  };
}

const resolveInput = z.instanceof(FormData).pipe(z.preprocess(readResolveForm, resolveCancellationRequestSchema));

// Authorization is enforced inside resolveCancellationRequest
// (requirePlatformPermission('manage_billing')) — this action just parses
// and delegates.
export const resolveCancellationRequestAction = actionClient
  .inputSchema(resolveInput)
  .bindArgsSchemas([z.uuid()])
  .stateAction(async ({ parsedInput, bindArgsParsedInputs: [requestId] }) => {
    try {
      await resolveCancellationRequest(requestId, parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      // Whether approving again is safe, when the resolver knew (a refund that did not go through, an e-mail that failed
      // after the money went back, a request already resolved elsewhere). The form shows each differently. Any other
      // failure is the action's server error.
      if (err instanceof CancellationResolveError) return { error: err.message, retry: err.retry };
      throw err;
    }

    revalidatePath('/admin/cancellations');
    revalidatePath(`/admin/cancellations/${requestId}`);
    return { notice: 'הבקשה טופלה — עדכון נשלח ללקוח' };
  });
