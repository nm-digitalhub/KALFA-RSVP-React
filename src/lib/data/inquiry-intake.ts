import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { preferenceToInstant } from '@/lib/callbacks/schedule-policy';
import { normalizePhone } from '@/lib/phone';
import type {
  CallbackRequestInput,
  ContactMessageInput,
} from '@/lib/validation/inquiries';

// REQUEST-FREE inquiry intake core (same split as sendable-contacts.ts:
// resolveSendableContacts vs listSendableContacts). These writers run on the
// service-role client and touch NO request-scoped Next API, because they are
// reachable from the pg-boss worker: webhook-processing → the voice-tool
// processors (callback/sales) escalate into contact_messages through this
// module with userId=null. The session-side wrappers — createContactMessage /
// createCallbackRequest in inquiries.ts — add the userId-gated logActivity
// audit, which requires a session and therefore must stay out of the worker
// graph (`worker-no-request-scoped-next` in .dependency-cruiser.cjs).
//
// RLS keeps INSERT authenticated-only by design, so these run on the
// service-role client AFTER the caller has rate-limited, honeypot-checked and
// Zod-validated the input. `userId` is attached server-side — never from the
// browser.
//
// The Slack alert fires UNCONDITIONALLY on insert success (not gated on
// userId): anonymous public-form submissions are the majority and are exactly
// the ones with no logActivity trail, so the alert is their only real-time
// signal. It is fire-and-forget (`void`) — sendSlackAlert never throws and is
// fully gated by the admin toggle, so it never blocks or fails the submission.
// PII rule: only the row id + closed-vocabulary topic go to Slack — never
// name/email/phone/message.

// Which QUEUE a customer-chosen topic routes to.
//
// The two vocabularies are deliberately independent: the form says
// "חיוב ותשלום" because that is what a customer calls it, while the queue is
// keyed `billing` and displays "גבייה" because that is what the desk calls it.
//
// Keyed on the queue `key`, never on `name_he`. Matching by Hebrew name looked
// obviously correct and silently was not — MEASURED 16.08: those two strings
// differ, so a name match would have failed to route EVERY billing inquiry,
// with no error and no log, on the category least affordable to lose. Keying on
// `key` also means renaming a queue for display can never re-route anything.
//
// 'אחר' is absent on purpose, and so is mail intake's null topic: an unrouted
// inquiry is visible and triageable, a wrongly-routed one is not.
export const TOPIC_TO_QUEUE_KEY: Record<string, string> = {
  'מכירות': 'sales',
  'תמיכה': 'support',
  'חיוב ותשלום': 'billing',
};

/**
 * Resolve the routing queue for a topic, or null when it does not route.
 *
 * Fail-soft: a missing or inactive queue yields null rather than throwing. The
 * inquiry itself is the thing that must not be lost — losing the routing hint
 * costs a triage step, losing the submission costs a customer.
 */
async function resolveQueueId(
  supabase: ReturnType<typeof createAdminClient>,
  topic: string | null,
): Promise<string | null> {
  const key = topic ? TOPIC_TO_QUEUE_KEY[topic] : undefined;
  if (!key) return null;

  const { data } = await supabase
    .from('console_queues')
    .select('id')
    .eq('key', key)
    .eq('is_active', true)
    .maybeSingle();
  return data?.id ?? null;
}

/** The inserted row's id rides along so the session-side wrapper can audit it. */
export async function insertContactMessage(
  input: ContactMessageInput,
  userId: string | null,
): Promise<{ ok: boolean; id?: string }> {
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
      queue_id: await resolveQueueId(supabase, input.topic),
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false };
  }

  // Mirrors the flat `message` column into the thread table so the admin
  // detail view's InquiryThread shows the original question, not just
  // replies — mail intake already does this (inquiry-mail-intake.ts); this was
  // the missing half for web-form submissions, which never got an initial
  // `inbound` row. Best-effort: the inquiry itself (inserted above) is the
  // thing that must not be lost, so a thread-mirror failure must not fail
  // the submission — the flat `message` column still holds the text either way.
  const { error: threadError } = await supabase.from('inquiry_messages').insert({
    inquiry_id: data.id,
    direction: 'inbound',
    body: input.message,
  });
  if (threadError) {
    console.error('[inquiry-intake] thread mirror insert failed', data.id, threadError.code);
  }

  void sendSlackAlert({
    category: 'customer_inquiry',
    level: 'info',
    title: 'פנייה חדשה מלקוח',
    source: 'contact_form',
    fields: { contactMessageId: data.id, topic: input.topic },
  });

  return { ok: true, id: data.id };
}

export async function insertCallbackRequest(
  input: CallbackRequestInput,
): Promise<{ ok: boolean; id?: string }> {
  // The caller's chosen part of the day, resolved to the instant the scheduler
  // starts searching from. 'asap' stays NULL on purpose: it means "no stated
  // time", and the scheduler resolves that against the clock at the moment it
  // actually runs rather than against the moment this form was submitted — a
  // request can sit in the queue for a while, and "as soon as possible" should
  // mean soon from THEN.
  const preferredMs =
    input.preference === 'asap' ? null : preferenceToInstant(input.preference, Date.now());

  // The band is also a DIRECTION, and the instant above throws that away: once
  // it is a timestamp, nothing downstream can tell "they wanted the afternoon"
  // from "start looking at four". Recording the rank keeps the choice usable
  // when the exact instant turns out to be taken.
  const requestedRank: 'earliest' | 'early' | 'late' =
    input.preference === 'asap' ? 'earliest' : input.preference === 'morning' ? 'early' : 'late';

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('callback_requests')
    .insert({
      full_name: input.full_name,
      phone: normalizePhone(input.phone) ?? input.phone,
      topic: input.topic,
      note: input.note ?? null,
      requested_at: preferredMs === null ? null : new Date(preferredMs).toISOString(),
      requested_rank: requestedRank,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false };
  }

  void sendSlackAlert({
    category: 'customer_inquiry',
    level: 'info',
    title: 'בקשת חזרה טלפונית חדשה',
    source: 'callback_form',
    // Counts and closed vocabulary only — no name, phone or note in an alert.
    fields: { callbackRequestId: data.id, topic: input.topic, מועד: input.preference },
  });

  return { ok: true, id: data.id };
}
