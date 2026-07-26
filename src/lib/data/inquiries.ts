import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/data/activity';
import { normalizePhone } from '@/lib/phone';
import type {
  CallbackRequestInput,
  ContactMessageInput,
} from '@/lib/validation/inquiries';

// Public/customer inquiry writers. RLS keeps INSERT authenticated-only by
// design, so these run on the service-role client AFTER the calling Server
// Action has rate-limited, honeypot-checked and Zod-validated the input.
// `userId` is attached server-side from the session — never from the browser.
//
// logActivity requires a session (requireUser) — so it runs ONLY for
// signed-in submitters. Anonymous submissions are audited by the inserted
// row itself (created_at + content), which is the meaningful record here.

export async function createContactMessage(
  input: ContactMessageInput,
  userId: string | null,
): Promise<{ ok: boolean }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('contact_messages')
    .insert({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      topic: input.topic,
      message: input.message,
      user_id: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false };
  }

  if (userId) {
    await logActivity({
      action: 'inquiry.contact_created',
      meta: { contactMessageId: data.id, source: 'app' },
    });
  }
  return { ok: true };
}

export async function createCallbackRequest(
  input: CallbackRequestInput,
  userId: string | null,
): Promise<{ ok: boolean }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .insert({
      full_name: input.full_name,
      phone: normalizePhone(input.phone) ?? input.phone,
      topic: input.topic,
      note: input.note ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false };
  }

  if (userId) {
    await logActivity({
      action: 'inquiry.callback_created',
      meta: { callbackRequestId: data.id, source: 'app' },
    });
  }
  return { ok: true };
}
