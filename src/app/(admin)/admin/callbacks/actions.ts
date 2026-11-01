'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { zfd } from 'zod-form-data';

import { cancelCallback, rescheduleCallback, updateCallOutcome } from '@/lib/data/admin/callbacks';
import { actionClient, returnUserError } from '@/lib/safe-action';
import {
  cancelCallbackSchema,
  updateCallOutcomeSchema,
  rescheduleCallbackSchema,
} from '@/lib/validation/admin';

// Cancel a request outright. Authorization is enforced inside cancelCallback
// (requirePlatformPermission). Used with useActionState.
export const cancelCallbackAction = actionClient
  .inputSchema(zfd.formData(cancelCallbackSchema))
  .stateAction(async ({ parsedInput: { id } }) => {
    let outcome;
    try {
      outcome = await cancelCallback(id);
    } catch (err) {
      // Re-throw Next.js control-flow signals (e.g. redirect from requirePlatformPermission);
      // catching them would silently break the redirect.
      unstable_rethrow(err);
      return returnUserError('ביטול הבקשה נכשל. נסו שוב.');
    }

    // A refused cancellation is not a failure to retry — the same shape as
    // rescheduleCallbackAction below. "נסו שוב" would be false advice here:
    // retrying a terminal request can never succeed.
    if (!outcome.ok) {
      if (outcome.reason === 'already_cancelled') return returnUserError('הבקשה כבר בוטלה.');
      if (outcome.reason === 'already_closed') {
        return returnUserError(
          'לא ניתן לבטל בקשה שכבר הסתיימה. אפשר לשנות את תוצאת השיחה או לתאם מועד חדש.',
        );
      }
      return returnUserError('ביטול הבקשה נכשל. נסו שוב.');
    }

    // Both paths: this form is submitted from the DETAIL page, but only
    // revalidating the list left the detail page serving its stale cached RSC
    // payload until a manual reload (measured 2026-08-20, same shape as
    // packages/fleet's own list+detail revalidation).
    revalidatePath('/admin/callbacks');
    revalidatePath(`/admin/callbacks/${id}`);
    return { notice: 'הבקשה בוטלה' };
  });

// Records what happened when the owner made the call. Validates the closed
// outcome vocabulary server-side; authorization is enforced inside
// updateCallOutcome (requirePlatformPermission).
export const updateCallOutcomeAction = actionClient
  .inputSchema(zfd.formData(updateCallOutcomeSchema))
  .stateAction(async ({ parsedInput: { id, callOutcome } }) => {
    try {
      await updateCallOutcome(id, callOutcome);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון תוצאת השיחה נכשל. נסו שוב.');
    }

    revalidatePath('/admin/callbacks');
    revalidatePath(`/admin/callbacks/${id}`);
    return { notice: 'תוצאת השיחה נשמרה' };
  });

// Reschedules a callback to a new admin-chosen instant — the caller answered
// and asked for a different time, or asked to be called again later.
// Authorization is enforced inside rescheduleCallback
// (requirePlatformPermission).
export const rescheduleCallbackAction = actionClient
  .inputSchema(zfd.formData(rescheduleCallbackSchema))
  .stateAction(async ({ parsedInput: { id, exactAt } }) => {
    let outcome;
    try {
      outcome = await rescheduleCallback(id, exactAt);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('תזמון השיחה נכשל. נסו שוב.');
    }

    if (!outcome.ok) {
      return returnUserError(
        outcome.reason === 'old_appointment_not_removed'
          ? 'לא ניתן היה להסיר את הפגישה הקיימת מהיומן. נסו שוב עוד רגע.'
          : 'תזמון השיחה נכשל. נסו שוב.',
      );
    }

    revalidatePath('/admin/callbacks');
    revalidatePath(`/admin/callbacks/${id}`);
    return { notice: 'השיחה תוזמנה מחדש' };
  });
