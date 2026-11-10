import 'server-only';

import type { RouteStep } from '@/lib/console-calls/route-auth';
import { getCallAttemptById, TERMINAL_STATUSES } from '@/lib/data/call-attempts';
import { noStoreJson } from '@/lib/http/no-store-json';
import { pickSessionUrl } from '@/lib/voximplant/session-command';

// The live AI call a console command acts on (/api/calls/{callAttemptId}/end, /monitor, /agent-command).
//
// AUTHORIZATION IS NOT HERE: each of those routes runs requireManageVoiceAgent first. The session handle this
// returns is a capability — server-only, never RLS-exposed — so it is read through the service-role DAL only
// after that gate.

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

type CallAttempt = NonNullable<Awaited<ReturnType<typeof getCallAttemptById>>>;

/**
 * Loads the attempt and its managing URL (HTTPS handle preferred). 500 when the read fails, 404 when there is no
 * such attempt, 409 when it is already terminal or has no usable handle — the handle lives only for the call's
 * duration, and 409 is the branch the app already handles for "no longer live".
 */
export async function loadLiveCallAttempt(
  callAttemptId: string,
): Promise<RouteStep<{ attempt: CallAttempt; sessionUrl: URL }>> {
  let attempt;
  try {
    attempt = await getCallAttemptById(callAttemptId);
  } catch {
    return { ok: false, response: noStoreJson({ error: 'טעינת השיחה נכשלה' }, 500) };
  }
  if (!attempt) return { ok: false, response: noStoreJson({ error: 'שיחה לא נמצאה' }, 404) };

  if (TERMINAL.has(attempt.status)) {
    return { ok: false, response: noStoreJson({ error: 'השיחה אינה פעילה' }, 409) };
  }
  const sessionUrl = pickSessionUrl(
    attempt.media_session_access_secure_url,
    attempt.media_session_access_url,
  );
  if (!sessionUrl) return { ok: false, response: noStoreJson({ error: 'השיחה אינה פעילה' }, 409) };

  return { ok: true, attempt, sessionUrl };
}
