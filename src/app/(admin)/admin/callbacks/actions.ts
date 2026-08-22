'use server';

import { revalidatePath } from 'next/cache';

import { cancelCallback, rescheduleCallback, updateCallOutcome } from '@/lib/data/admin/callbacks';
import {
  cancelCallbackSchema,
  updateCallOutcomeSchema,
  rescheduleCallbackSchema,
} from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

// Re-thrown so Next.js control-flow signals (e.g. a redirect from an admin
// gate) are never swallowed by a surrounding try/catch.
function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

// Cancel a request outright. Authorization is enforced inside cancelCallback
// (requireAdmin) and by RLS. Returns a typed FormState for useActionState.
export async function cancelCallbackAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = cancelCallbackSchema.safeParse({ id: formData.get('id') });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await cancelCallback(parsed.data.id);
  } catch (err) {
    // Re-throw Next.js control-flow signals (e.g. redirect from requireAdmin);
    // catching them would silently break the redirect.
    if (isNextRedirect(err)) throw err;
    return { error: 'ביטול הבקשה נכשל. נסו שוב.' };
  }

  // Both paths: this form is submitted from the DETAIL page, but only
  // revalidating the list left the detail page serving its stale cached RSC
  // payload until a manual reload (measured 2026-08-20, same shape as
  // packages/fleet's own list+detail revalidation).
  revalidatePath('/admin/callbacks');
  revalidatePath(`/admin/callbacks/${parsed.data.id}`);
  return { notice: 'הבקשה בוטלה' };
}

// Records what happened when the owner made the call. Validates the closed
// outcome vocabulary server-side; authorization is enforced inside
// updateCallOutcome (requireAdmin) and by RLS.
export async function updateCallOutcomeAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateCallOutcomeSchema.safeParse({
    id: formData.get('id'),
    callOutcome: formData.get('callOutcome'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateCallOutcome(parsed.data.id, parsed.data.callOutcome);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: 'עדכון תוצאת השיחה נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/callbacks');
  revalidatePath(`/admin/callbacks/${parsed.data.id}`);
  return { notice: 'תוצאת השיחה נשמרה' };
}

// Reschedules a callback to a new admin-chosen instant — the caller answered
// and asked for a different time, or asked to be called again later.
// Authorization is enforced inside rescheduleCallback (requireAdmin) and by
// RLS, same as updateCallbackStatusAction above.
export async function rescheduleCallbackAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = rescheduleCallbackSchema.safeParse({
    id: formData.get('id'),
    exactAt: formData.get('exactAt'),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let outcome;
  try {
    outcome = await rescheduleCallback(parsed.data.id, parsed.data.exactAt);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: 'תזמון השיחה נכשל. נסו שוב.' };
  }

  if (!outcome.ok) {
    return {
      error:
        outcome.reason === 'old_appointment_not_removed'
          ? 'לא ניתן היה להסיר את הפגישה הקיימת מהיומן. נסו שוב עוד רגע.'
          : 'תזמון השיחה נכשל. נסו שוב.',
    };
  }

  revalidatePath('/admin/callbacks');
  revalidatePath(`/admin/callbacks/${parsed.data.id}`);
  return { notice: 'השיחה תוזמנה מחדש' };
}
