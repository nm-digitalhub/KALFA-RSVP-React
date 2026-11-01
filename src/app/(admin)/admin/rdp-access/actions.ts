'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { cancelMyRdpRequest, endMyRdpGrant, submitRdpAccessRequest } from '@/lib/data/admin/rdp-access';
import { socketClientIp } from '@/lib/security/client-ip';
import {
  CANCEL_GONE_TEXT,
  END_GONE_TEXT,
  GENERIC_FAILURE_TEXT,
  REQUEST_REFUSAL_TEXT,
  TOO_MANY_ATTEMPTS_TEXT,
} from '@/lib/rdp-access/copy';
import { notifyOwnersOfRdpRequest } from '@/lib/rdp-access/notify-request';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { rdpRequestFormSchema } from '@/lib/validation/rdp-access';

// The three staff actions of the remote-desktop screen. Each one: the permission gate FIRST (the user id is the
// gate's return value, never form data), then the per-user in-memory limiter (a first line against a stuck client;
// the durable limits are in the database), then Zod, then the data layer. Server Actions get Next's own
// Origin/Host check, which the file route has to do by hand.
//
// Errors the user sees are fixed sentences from rdp-access/copy.ts; a failure of the data layer is logged by
// operation name only and answered with a generic line.
//
// The gate and the limiter are a use() middleware, which runs before input validation, so that order holds.

const PAGE = '/admin/rdp-access';
const PER_USER_LIMIT = { limit: 5, windowMs: 60_000 } as const;

const cancelFormSchema = z.object({ requestId: z.uuid() });

async function limited(userId: string, action: string): Promise<boolean> {
  return !(await rateLimit(`rdp-${action}:${userId}`, PER_USER_LIMIT)).allowed;
}

export const requestRdpAccessAction = actionClient
  .use(async ({ next }) => {
    const user = await requirePlatformPermission('rdp.request');
    if (await limited(user.id, 'request')) returnUserError(TOO_MANY_ATTEMPTS_TEXT);
    return next();
  })
  .inputSchema(zfd.formData(rdpRequestFormSchema))
  .stateAction(async ({ parsedInput }) => {
    const requestHeaders = await headers();
    let result: Awaited<ReturnType<typeof submitRdpAccessRequest>>;
    try {
      result = await submitRdpAccessRequest(parsedInput, socketClientIp((name) => requestHeaders.get(name)));
    } catch (err) {
      unstable_rethrow(err);
      console.error('rdp-access: the request action failed');
      returnUserError(GENERIC_FAILURE_TEXT);
    }

    if (result.outcome !== 'created' || result.requestId === null) {
      // the page may be showing a stale state (an earlier request is already pending, for one): refresh it
      revalidatePath(PAGE);
      returnUserError(REQUEST_REFUSAL_TEXT[result.outcome === 'created' ? 'unexpected' : result.outcome]);
    }

    // The owners learn about the request AFTER the response: a slow Slack or push provider must not make the
    // person wait, and a failure there never undoes a request that already exists.
    const { requestId } = result;
    const { minutes } = parsedInput;
    after(async () => {
      try {
        const notified = await notifyOwnersOfRdpRequest(createAdminClient(), { requestId, minutes });
        if (!notified.slack && notified.pushed === 0) console.error('rdp-access: no owner was notified of a new request');
      } catch {
        console.error('rdp-access: notifying the owners of a new request failed');
      }
    });

    revalidatePath(PAGE);
    return { notice: 'הבקשה נשלחה לאישור' };
  });

export const cancelRdpRequestAction = actionClient
  .use(async ({ next }) => {
    const user = await requirePlatformPermission('rdp.request');
    if (await limited(user.id, 'cancel')) returnUserError(TOO_MANY_ATTEMPTS_TEXT);
    return next();
  })
  .inputSchema(zfd.formData(cancelFormSchema), {
    // A malformed id gets the generic line, as before.
    handleValidationErrorsShape: async () => ({ formErrors: [GENERIC_FAILURE_TEXT], fieldErrors: {} }),
  })
  .stateAction(async ({ parsedInput: { requestId } }) => {
    let outcome: Awaited<ReturnType<typeof cancelMyRdpRequest>>['outcome'];
    try {
      ({ outcome } = await cancelMyRdpRequest(requestId));
    } catch (err) {
      unstable_rethrow(err);
      console.error('rdp-access: the cancel action failed');
      returnUserError(GENERIC_FAILURE_TEXT);
    }

    revalidatePath(PAGE);
    if (outcome === 'cancelled') return { notice: 'הבקשה בוטלה' };
    returnUserError(outcome === 'not_found_or_not_pending' ? CANCEL_GONE_TEXT : GENERIC_FAILURE_TEXT);
  });

// Takes nothing from the form: the grant ended is the caller's own.
export const endRdpGrantAction = actionClient
  .use(async ({ next }) => {
    const user = await requirePlatformPermission('rdp.request');
    if (await limited(user.id, 'end')) returnUserError(TOO_MANY_ATTEMPTS_TEXT);
    return next();
  })
  .inputSchema(zfd.formData({}))
  .stateAction(async () => {
    let outcome: Awaited<ReturnType<typeof endMyRdpGrant>>['outcome'];
    try {
      ({ outcome } = await endMyRdpGrant());
    } catch (err) {
      unstable_rethrow(err);
      console.error('rdp-access: the end-access action failed');
      returnUserError(GENERIC_FAILURE_TEXT);
    }

    revalidatePath(PAGE);
    if (outcome === 'ended') return { notice: 'הגישה הסתיימה' };
    returnUserError(outcome === 'no_active_grant' ? END_GONE_TEXT : GENERIC_FAILURE_TEXT);
  });
