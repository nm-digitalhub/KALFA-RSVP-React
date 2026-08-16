import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { getEmailSender } from '@/lib/email/sender';
import { getAppOrigin } from '@/lib/url';
import { inquiryReplyEmail } from '@/lib/email/templates';
import type { Database } from '@/lib/supabase/types';
import type { CallbackStatus } from '@/lib/validation/admin';
import { resolvePage, type PageParams, type PageResult } from './shared';

// Admin: contact-form + in-app support submissions (the single inquiry entity).
// Access is authorized by the request-scoped session under the `cm_admin_all`
// RLS policy (has_role admin). We additionally gate with
// requirePlatformPermission() server-side so a non-admin never reaches the query.

type ContactMessageRow = Database['public']['Tables']['contact_messages']['Row'];

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
  | 'sent_reply'
  | 'replied_at'
>;

export const CONTACT_COLUMNS =
  'id, name, email, phone, message, created_at, status, topic, user_id, handled_at, draft_reply, sent_reply, replied_at';

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
    .order('created_at', { ascending: false })
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
  status: CallbackStatus,
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
  const { error: updateError } = await supabase
    .from('contact_messages')
    .update({ sent_reply: replyText, replied_at: now, status: 'done', handled_at: now })
    .eq('id', id);

  if (updateError) {
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
