import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getEmailSender } from '@/lib/email/sender';
import { getAppOrigin } from '@/lib/url';
import { inquiryReplyEmail } from '@/lib/email/templates';
import type { Tables } from '@/lib/supabase/types';
import type { ContactStatus } from '@/lib/validation/admin';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: contact-form + in-app support submissions (the single inquiry entity).
// Access is authorized by the request-scoped session under the `cm_admin_all`
// RLS policy (has_role admin). We additionally gate with
// requirePlatformPermission() server-side so a non-admin never reaches the query.

type ContactMessageRow = Tables<'contact_messages'>;

// DTO: exactly the columns the admin list needs. The select string IS the
// contract — rows are returned pass-through. `status`/`topic`/`user_id`/
// `handled_at` drive the workflow + source badge; `draft_reply` surfaces the
// support-drafter's proposed reply (draft only — never auto-sent).
export type ContactMessage = Pick<
  ContactMessageRow,
  | 'id'
  | 'name'
  | 'email'
  | 'phone'
  | 'message'
  | 'created_at'
  | 'status'
  | 'topic'
  | 'user_id'
  | 'handled_at'
  | 'draft_reply'
  | 'draft_created_at'
  | 'sent_reply'
  | 'replied_at'
  | 'last_activity_at'
>;

// `draft_created_at` is here for the composer gate, which compares TIMES rather
// than testing whether a reply ever happened — see ContactReplyForm. Without it
// a re-drafted reply on a reopened thread is written to the database and never
// shown to anyone.
export const CONTACT_COLUMNS =
  'id, name, email, phone, message, created_at, status, topic, user_id, handled_at, draft_reply, draft_created_at, sent_reply, replied_at, last_activity_at';

// List contact messages, newest first, with exact total for pagination.
export async function listContactMessages(
  { page }: PageParams = {},
): Promise<PageResult<ContactMessage>> {
  await requirePlatformPermission('view_customer_data');

  const { page: safePage, pageSize, from, to } = resolvePage(page);

  const supabase = createAdminClient();
  const { data, error, count } = await supabase
    .from('contact_messages')
    .select(CONTACT_COLUMNS, { count: 'exact' })
    // A reopened inquiry is MORE urgent than a new one — the customer already
    // waited once. Ordering by created_at buried it at its original date, so a
    // July thread answered today sank below everything on the first page.
    // last_activity_at is maintained on write (intake, reply) rather than
    // computed, so this stays a single indexed query.
    .order('last_activity_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error('טעינת הפניות נכשלה');
  }

  return {
    items: data ?? [],
    total: count ?? 0,
    page: safePage,
    pageSize,
  };
}

// Update a single contact message's status. Same closed vocabulary as
// callbacks (validated by the caller's Server Action). handled_at is
// deterministic from the status: terminal (done/cancelled) → stamped now,
// non-terminal → cleared.
export async function updateContactStatus(
  id: string,
  status: ContactStatus,
): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: current, error: currentError } = await supabase
    .from('contact_messages')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (currentError) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  const terminal = status === 'done' || status === 'cancelled';
  const { error } = await supabase
    .from('contact_messages')
    .update({ status, handled_at: terminal ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) {
    throw new Error('עדכון הסטטוס נכשל');
  }

  await logActivity({
    action: 'contact.status_updated',
    meta: {
      contactMessageId: id,
      previousStatus: current?.status ?? null,
      status,
    },
  });
}

// Send a staff-authored email reply to a contact message, record it, and
// resolve the inquiry. SEND-THEN-PERSIST: the email is the primary effect, so
// it goes out FIRST — if the send throws (EmailConfigError/EmailSendError,
// let them propagate), nothing is persisted and the admin can retry safely.
// Only after a successful send do we stamp sent_reply/replied_at and close the
// inquiry (status='done'). If that stamp fails, the customer already received
// the reply, so the error explicitly says so — a blind retry would double-mail.
export async function sendInquiryReply(id: string, replyText: string): Promise<void> {
  await requirePlatformPermission('view_customer_data');

  const supabase = createAdminClient();
  const { data: msg, error } = await supabase
    .from('contact_messages')
    .select('email, name')
    .eq('id', id)
    .maybeSingle();

  if (error || !msg) {
    throw new Error('הפנייה לא נמצאה');
  }
  if (!msg.email) {
    throw new Error('לפנייה זו אין כתובת אימייל — לא ניתן לשלוח מענה');
  }

  const { subject, html, text } = inquiryReplyEmail({
    recipientName: msg.name,
    replyText,
    origin: await getAppOrigin(),
  });

  // Actionable errors: the admin is the operator who CAN fix these, so say
  // exactly what to do and where — not a generic "failed". Match on the error
  // name (getEmailSender/send set EmailConfigError/EmailSendError) so this holds
  // even when the module is mocked. Nothing is persisted yet, so a retry is safe.
  try {
    const sender = await getEmailSender();
    await sender.send({ to: msg.email, subject, html, text });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'EmailConfigError') {
      throw new Error(
        'שירות הדואר אינו מוגדר — הגדירו SMTP במסך ההגדרות (מערכת ותפעול ← הגדרות) והפעילו "אימייל", ואז נסו שוב.',
      );
    }
    if (name === 'EmailSendError') {
      throw new Error(
        'שליחת הדואר נכשלה — בדקו במסך ההגדרות את פרטי ה-SMTP (שרת, פורט, משתמש, סיסמה). הרשומה לא עודכנה; אפשר לנסות שוב.',
      );
    }
    throw err;
  }

  const now = new Date().toISOString();

  // The thread is the record. `sent_reply` is a single column, so a second reply
  // overwrites the first and the earlier exchange disappears — which is exactly
  // what makes a reopened inquiry unreadable. Appending here keeps every reply.
  //
  // Written BEFORE the contact_messages stamp on purpose: if this insert fails
  // the row still shows the previous state and the admin retries, whereas losing
  // it after the stamp would leave a sent reply with no record of what was sent.
  // Best-effort by design though — the mail is already gone, so a failure here
  // must not present as "the send failed".
  const { error: threadError } = await supabase.from('inquiry_messages').insert({
    inquiry_id: id,
    direction: 'outbound',
    body: replyText,
  });

  const { error: updateError } = await supabase
    .from('contact_messages')
    .update({
      sent_reply: replyText,
      replied_at: now,
      status: 'done',
      handled_at: now,
      // Keeps the admin list ordered by real activity rather than by the date
      // the inquiry first arrived.
      last_activity_at: now,
    })
    .eq('id', id);

  if (updateError || threadError) {
    throw new Error(
      'המענה נשלח ללקוח, אך שמירת הרשומה נכשלה — נא לרענן ולוודא לפני שליחה חוזרת',
    );
  }

  // PII rule: never put the reply text or the recipient email in the audit meta.
  await logActivity({
    action: 'contact.reply_sent',
    meta: { contactMessageId: id },
  });
}

export type InquiryMessage = {
  id: string;
  inquiry_id: string;
  direction: 'inbound' | 'outbound' | 'draft';
  body: string;
  created_at: string;
};

/**
 * Every message on the inquiries in `ids`, oldest first, as ONE query.
 *
 * Batched deliberately: the admin list renders a page of inquiries, and a
 * per-row read would be a classic N+1 against a table that grows with every
 * reply. The caller groups by `inquiry_id`.
 *
 * The flat `message` / `sent_reply` / `draft_reply` columns are still written
 * alongside these rows, because distill-corrections reads the draft↔sent pair
 * and the fleet trigger reads draft_reply. This is the read path for DISPLAY;
 * those remain the read path for their own consumers until they move.
 */
export async function listInquiryMessages(ids: string[]): Promise<InquiryMessage[]> {
  await requirePlatformPermission('view_customer_data');
  if (ids.length === 0) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('inquiry_messages')
    .select('id, inquiry_id, direction, body, created_at')
    .in('inquiry_id', ids)
    .order('created_at', { ascending: true });

  // Fail-soft: the thread is context around the inquiry, and losing it must not
  // take down the page that lets a human answer a waiting customer.
  if (error) return [];
  return (data ?? []) as InquiryMessage[];
}

export type InquiryUrgency = {
  /** Days until the soonest upcoming event this inquirer owns. */
  daysToEvent: number;
  eventName: string;
};

/**
 * How soon the person asking has an event, keyed by inquiry id.
 *
 * DERIVED at read time, never stored. A stored urgency flag is wrong the moment
 * the event passes, and nothing would be watching to clear it.
 *
 * Matched on PHONE. `profiles` carries `phone` but no email, so an email match
 * would have to go through GoTrue's listUsers with its 200-user ceiling — a
 * silent cutoff on the exact axis this is meant to make reliable. Phone is a
 * real indexed column, so phone is the key.
 *
 * ⚠️ NOT proof of identity. A phone number typed into a public form is a
 * PRIORITY HINT and nothing else: it orders a queue for a human, and must never
 * gate access to account data. Two inquiries could carry the same number and
 * neither has authenticated.
 *
 * Why it matters here specifically: KALFA's customers are private individuals,
 * so an event three days out is somebody's wedding. That question cannot wait
 * in line behind a general pricing enquiry, and nothing in the list currently
 * distinguishes them.
 */
export async function resolveInquiryUrgency(
  inquiries: Array<{ id: string; phone: string | null }>,
  nowMs: number = Date.now(),
): Promise<Map<string, InquiryUrgency>> {
  await requirePlatformPermission('view_customer_data');

  const phones = [...new Set(inquiries.map((i) => i.phone).filter((p): p is string => !!p))];
  const urgency = new Map<string, InquiryUrgency>();
  if (phones.length === 0) return urgency;

  const supabase = createAdminClient();

  // Two batched reads, never one per row: this renders inside a paginated list.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, phone')
    .in('phone', phones);
  if (!profiles || profiles.length === 0) return urgency;

  // `profiles.phone` is nullable, and the `.in()` above cannot return a null
  // match — but the generated type does not know that, so narrow explicitly
  // rather than assert.
  const ownerByPhone = new Map<string, string>();
  for (const p of profiles) {
    if (p.phone) ownerByPhone.set(p.phone, p.id);
  }
  const nowIso = new Date(nowMs).toISOString();

  const { data: events } = await supabase
    .from('events')
    .select('owner_id, name, event_date')
    .in('owner_id', [...ownerByPhone.values()])
    .gte('event_date', nowIso)
    .order('event_date', { ascending: true });
  if (!events) return urgency;

  // Soonest event per owner — the list is already ascending, so the first wins.
  // `name` is nullable in the schema; an unnamed event still carries urgency, so
  // it gets a neutral label rather than being dropped.
  const soonestByOwner = new Map<string, { name: string; event_date: string }>();
  for (const e of events) {
    // A dateless event carries no urgency at all — the `.gte` above already
    // excludes it, but the generated type is nullable so narrow rather than
    // assert. An unnamed one still does, and gets a neutral label.
    if (!e.owner_id || !e.event_date) continue;
    if (!soonestByOwner.has(e.owner_id)) {
      soonestByOwner.set(e.owner_id, { name: e.name ?? 'אירוע', event_date: e.event_date });
    }
  }

  const DAY_MS = 86_400_000;
  for (const inquiry of inquiries) {
    if (!inquiry.phone) continue;
    const ownerId = ownerByPhone.get(inquiry.phone);
    const event = ownerId ? soonestByOwner.get(ownerId) : undefined;
    if (!event) continue;
    urgency.set(inquiry.id, {
      daysToEvent: Math.max(0, Math.ceil((Date.parse(event.event_date) - nowMs) / DAY_MS)),
      eventName: event.name,
    });
  }
  return urgency;
}
