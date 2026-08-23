import 'server-only';

import { logActivity } from '@/lib/data/activity';
import {
  insertCallbackRequest,
  insertContactMessage,
} from '@/lib/data/inquiry-intake';
import type {
  CallbackRequestInput,
  ContactMessageInput,
} from '@/lib/validation/inquiries';

// SESSION-SIDE inquiry writers, for Server Actions with a (possible) signed-in
// submitter. The actual insert + queue routing + Slack alert live in the
// request-free core (inquiry-intake.ts) — which the pg-boss worker also
// reaches via the voice-tool processors — while THIS module owns the one
// request-scoped step: logActivity (requireUser + RLS client), which runs ONLY
// for signed-in submitters. Anonymous submissions are audited by the inserted
// row itself (created_at + content), which is the meaningful record here.
// Split enforced by `worker-no-request-scoped-next` in .dependency-cruiser.cjs.

// Re-exported for the routing contract tests and any topic→queue consumers;
// the mapping itself lives with the request-free core that applies it.
export { TOPIC_TO_QUEUE_KEY } from '@/lib/data/inquiry-intake';

export async function createContactMessage(
  input: ContactMessageInput,
  userId: string | null,
): Promise<{ ok: boolean }> {
  const result = await insertContactMessage(input, userId);
  if (!result.ok || !result.id) {
    return { ok: false };
  }

  if (userId) {
    await logActivity({
      action: 'inquiry.contact_created',
      meta: { contactMessageId: result.id, source: 'app' },
    });
  }
  return { ok: true };
}

export async function createCallbackRequest(
  input: CallbackRequestInput,
  userId: string | null,
): Promise<{ ok: boolean }> {
  const result = await insertCallbackRequest(input);
  if (!result.ok || !result.id) {
    return { ok: false };
  }

  if (userId) {
    await logActivity({
      action: 'inquiry.callback_created',
      meta: { callbackRequestId: result.id, source: 'app' },
    });
  }
  return { ok: true };
}
