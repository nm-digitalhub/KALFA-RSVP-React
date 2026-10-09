'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { cancelMyRdpRequest, endMyRdpGrant, submitRdpAccessRequest } from '@/lib/data/admin/rdp-access';
import { rdpClientIp } from '@/lib/rdp-access/client-ip';
import {
  CANCEL_GONE_TEXT,
  END_GONE_TEXT,
  GENERIC_FAILURE_TEXT,
  REQUEST_REFUSAL_TEXT,
  TOO_MANY_ATTEMPTS_TEXT,
} from '@/lib/rdp-access/copy';
import { notifyOwnersOfRdpRequest } from '@/lib/rdp-access/notify-request';
import { rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { rdpRequestFormSchema } from '@/lib/validation/rdp-access';
import type { FormState } from '@/lib/validation/result';

// The three staff actions of the remote-desktop screen. Each one: the permission gate FIRST (the user id is the
// gate's return value, never form data), then the per-user in-memory limiter (a first line against a stuck client;
// the durable limits are in the database), then Zod, then the data layer. Server Actions get Next's own
// Origin/Host check, which the file route has to do by hand.
//
// Errors the user sees are fixed sentences from rdp-access/copy.ts; a failure of the data layer is logged by
// operation name only and answered with a generic line.

const PAGE = '/admin/rdp-access';
const PER_USER_LIMIT = { limit: 5, windowMs: 60_000 } as const;

const cancelFormSchema = z.object({ requestId: z.uuid() });

async function limited(userId: string, action: string): Promise<boolean> {
  return !(await rateLimit(`rdp-${action}:${userId}`, PER_USER_LIMIT)).allowed;
}

export async function requestRdpAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePlatformPermission('rdp.request');
  if (await limited(user.id, 'request')) return { error: TOO_MANY_ATTEMPTS_TEXT };

  const parsed = rdpRequestFormSchema.safeParse({
    reason: formData.get('reason'),
    minutes: formData.get('minutes'),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const requestHeaders = await headers();
  let result: Awaited<ReturnType<typeof submitRdpAccessRequest>>;
  try {
    result = await submitRdpAccessRequest(parsed.data, rdpClientIp((name) => requestHeaders.get(name)));
  } catch (err) {
    unstable_rethrow(err);
    console.error('rdp-access: the request action failed');
    return { error: GENERIC_FAILURE_TEXT };
  }

  if (result.outcome !== 'created' || result.requestId === null) {
    // the page may be showing a stale state (an earlier request is already pending, for one): refresh it
    revalidatePath(PAGE);
    return { error: REQUEST_REFUSAL_TEXT[result.outcome === 'created' ? 'unexpected' : result.outcome] };
  }

  // The owners learn about the request AFTER the response: a slow Slack or push provider must not make the
  // person wait, and a failure there never undoes a request that already exists.
  const { requestId } = result;
  const { minutes } = parsed.data;
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
}

export async function cancelRdpRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePlatformPermission('rdp.request');
  if (await limited(user.id, 'cancel')) return { error: TOO_MANY_ATTEMPTS_TEXT };

  const parsed = cancelFormSchema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: GENERIC_FAILURE_TEXT };

  let outcome: Awaited<ReturnType<typeof cancelMyRdpRequest>>['outcome'];
  try {
    ({ outcome } = await cancelMyRdpRequest(parsed.data.requestId));
  } catch (err) {
    unstable_rethrow(err);
    console.error('rdp-access: the cancel action failed');
    return { error: GENERIC_FAILURE_TEXT };
  }

  revalidatePath(PAGE);
  if (outcome === 'cancelled') return { notice: 'הבקשה בוטלה' };
  return { error: outcome === 'not_found_or_not_pending' ? CANCEL_GONE_TEXT : GENERIC_FAILURE_TEXT };
}

export async function endRdpGrantAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  const user = await requirePlatformPermission('rdp.request');
  if (await limited(user.id, 'end')) return { error: TOO_MANY_ATTEMPTS_TEXT };

  let outcome: Awaited<ReturnType<typeof endMyRdpGrant>>['outcome'];
  try {
    ({ outcome } = await endMyRdpGrant());
  } catch (err) {
    unstable_rethrow(err);
    console.error('rdp-access: the end-access action failed');
    return { error: GENERIC_FAILURE_TEXT };
  }

  revalidatePath(PAGE);
  if (outcome === 'ended') return { notice: 'הגישה הסתיימה' };
  return { error: outcome === 'no_active_grant' ? END_GONE_TEXT : GENERIC_FAILURE_TEXT };
}
