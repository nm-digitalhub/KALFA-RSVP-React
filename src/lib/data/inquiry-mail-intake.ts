import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  ensureMailFolder,
  fetchInboundMail,
  flattenForDrafter,
  type InboundMail,
} from '@/lib/microsoft/mail';
import { graphConfigured, primaryMailbox } from '@/lib/microsoft/graph-client';
import {
  ensureIntakeSubscription,
  intakeFolderName,
} from '@/lib/microsoft/subscriptions';
import { createAdminClient } from '@/lib/supabase/admin';

// Turning an emailed message into a KALFA inquiry.
//
// This runs in the WORKER, never in a request: a Graph notification carries
// only a resource id, so the message still has to be fetched, and fetching it
// needs the app certificate. Keeping that in the worker is also what keeps the
// mailbox credential off the HTTP path entirely.
//
// The row this writes is the ONLY thing `support-drafter` will ever see. It is
// a Tier-0 fleet role with no network access and no mailbox access, so anything
// missing from this row is missing from the reply it drafts.

/**
 * An emailed inquiry arrives with NO topic — nobody picked one from a list.
 *
 * The earlier value here was 'פנייה בדואר', and the reasoning for it was that
 * `INQUIRY_TOPICS` is closed only at the FORM boundary (the column is free text,
 * no CHECK constraint — verified against pg_constraint) and that server-side
 * flows already write descriptive values outside the list, e.g.
 * `callback_requests` carries 'שיחה נכנסת ללא נציג זמין'.
 *
 * That precedent does not actually apply. Those values describe an EVENT that
 * happened. 'פנייה בדואר' describes the CHANNEL — and the channel already has
 * its own column, `source`. So it duplicated a fact we already stored while
 * answering the wrong question, and produced a value matching no
 * `console_queues` row, which is what routing will key on (§E).
 *
 * NULL is the honest value: "not yet classified" is real information, and a
 * wrong label is worse than an absent one. `source='outlook'` already says
 * where it came from.
 */
const MAIL_TOPIC: string | null = null;

export type MailIntakeResult =
  | { status: 'created'; contactMessageId: string }
  | { status: 'reopened'; contactMessageId: string }
  | { status: 'duplicate' }
  | { status: 'gone' }
  | { status: 'skipped'; reason: string };

// Local alias — this file has no existing AdminClient type to import (only
// inquiry-followup.ts:39 defines one, and it's unexported/module-private). Mirrors
// the same local-alias pattern already used independently in other files in this
// codebase rather than exporting a cross-file type these two modules otherwise
// don't share.
type AdminClient = ReturnType<typeof createAdminClient>;

// Exported so the Resend bounce handler matches the SAME token this module
// matches on inbound mail — one pattern, not two that can drift apart.
export const REF_CODE_RE = /\[KLF-([0-9A-F]{8})\]/i;

type InquiryMatch = { id: string; status: 'cancelled' | (string & {}); thread_id: string | null };

/**
 * Mail we must never turn into an inquiry: our own sends landing back in the
 * folder, and automated bounces. Replying to either would mean emailing a
 * mail server, or the customer a second time about nothing.
 */
function skipReason(fromAddress: string | null, mailbox: string): string | null {
  if (!fromAddress) return 'no_sender';
  const from = fromAddress.toLowerCase();
  if (from === mailbox.toLowerCase()) return 'self';
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/.test(from)) {
    return 'automated';
  }
  return null;
}

/**
 * Locate the existing inquiry an inbound reply belongs to, if any.
 *
 * Two tiers, both sender-verified (docs/inquiry-email-threading-fix-plan-2026-08-25.md
 * §2.3): the `[KLF-XXXXXXXX]` reference code embedded in the subject of every outbound
 * send on this thread (templates.ts threadSubject()) first, falling back to Graph's own
 * conversationId when no token is present or it doesn't match — conversationId alone is
 * unreliable for Resend-sent mail, which never passes through Exchange's own Sent Items
 * (§0). Neither signal is trusted alone: mail.fromAddress is Graph's parsed From: header,
 * not SPF/DKIM/DMARC-verified, so the sender check is a meaningful deterrent, not
 * cryptographic proof of identity (§2.1).
 */
async function findExistingInquiry(
  admin: AdminClient,
  mail: InboundMail,
): Promise<InquiryMatch | null> {
  const tokenMatch = mail.subject?.match(REF_CODE_RE);
  if (tokenMatch) {
    const code = tokenMatch[1].toUpperCase();
    const { data, error } = await admin
      .from('contact_messages')
      .select('id, email, status, thread_id')
      .eq('ref_code', code)
      .maybeSingle();
    if (error) {
      // A transient DB failure here must NOT be treated as "no match" — that is
      // exactly how the live-verified incident in §0 happened (a miss silently
      // creates a new, disconnected row).
      throw new Error('שאילתת חיפוש פנייה לפי קוד נכשלה', { cause: error });
    }
    if (data && data.email?.toLowerCase() === mail.fromAddress?.toLowerCase()) {
      return { id: data.id, status: data.status, thread_id: data.thread_id };
    }
    if (data) {
      // A code matched but the sender didn't — a possible spoofing attempt, not
      // just an ordinary miss. ids/reason only, never the two addresses being
      // compared.
      void sendSlackAlert({
        category: 'customer_inquiry',
        level: 'warn',
        title: 'קוד פנייה תואם אך כתובת שולח לא תואמת',
        source: 'outlook',
        fields: { contactMessageId: data.id, reason: 'ref_code_sender_mismatch' },
      });
    }
  }
  if (!mail.conversationId) return null;
  const { data, error } = await admin
    .from('contact_messages')
    .select('id, email, status, thread_id')
    .eq('thread_id', mail.conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error('שאילתת חיפוש פנייה לפי conversationId נכשלה', { cause: error });
  }
  // Same identity comparison as tier 1, but deliberately no dedicated alert on a
  // mismatch here — a shared conversationId with a mismatched sender is a weaker,
  // far-more-often-benign signal (cc'd colleague, forward, shared mailbox) than a
  // ref_code match with a mismatched sender (§2.3 point 3).
  if (!data || data.email?.toLowerCase() !== mail.fromAddress?.toLowerCase()) return null;
  return { id: data.id, status: data.status, thread_id: data.thread_id };
}

/**
 * Distinguishes "looks like an unmatched reply" from "genuinely new" when
 * findExistingInquiry misses on both tiers (§2.3 point 6) — so a `ref_code` that got
 * stripped or mangled in transit doesn't silently fire the same generic "new inquiry"
 * alert as a genuinely fresh compose. MUST be called before the upsert-insert below
 * runs, or it would match the very row that insert just created and always report true.
 */
async function hasSameSenderInquiry(
  admin: AdminClient,
  fromAddress: string | null,
): Promise<boolean> {
  if (!fromAddress) return false;
  // contact_messages.email is never normalized to lowercase on write while
  // mail.fromAddress always is — a plain .eq() would silently miss a form
  // submission entered as "Dana@Gmail.com". .ilike() is case-insensitive but
  // treats `%`/`_` as wildcards under Postgres's default ILIKE escape rules, so
  // the address is escaped first.
  const escaped = fromAddress.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const { data, error } = await admin
    .from('contact_messages')
    .select('id')
    .ilike('email', escaped)
    .limit(1)
    .maybeSingle();
  if (error) {
    // Fail closed to the generic "new inquiry" alert rather than throwing — this
    // check only affects which Slack alert fires, not the correctness of the
    // insert itself.
    return false;
  }
  return data != null;
}

/**
 * On a redelivered notification for a message already seen, the upsert below
 * resolves to 'duplicate' — but a redelivery might be retrying a PRIOR attempt whose
 * `inquiry_messages` write never landed (silent loss, §2.8), so that path still
 * looks up the existing row and re-attempts an idempotent thread-message write
 * instead of just reporting "duplicate" and stopping.
 */
export async function intakeMailAsInquiry(graphMessageId: string): Promise<MailIntakeResult> {
  const mailbox = primaryMailbox();
  const mail = await fetchInboundMail(mailbox, graphMessageId);
  if (!mail) return { status: 'gone' };

  const skip = skipReason(mail.fromAddress, mailbox);
  if (skip) return { status: 'skipped', reason: skip };

  const admin = createAdminClient();
  const body = flattenForDrafter(mail);

  // A message on a thread we already hold is a REPLY, not a new inquiry. Two-tier
  // match, both sender-verified (§2.3): the [KLF-XXXXXXXX] reference code in the
  // subject first, falling back to Graph's conversationId.
  const match = await findExistingInquiry(admin, mail);
  if (match) {
    return attachReplyToInquiry(match, mail, body);
  }

  // Neither tier matched. Before treating this as a brand-new inquiry, check
  // whether this looks like a reply that SHOULD have matched and didn't (§2.3
  // point 6) — must run before the upsert-insert below, or it would match the very
  // row that insert just created.
  const looksUnmatched = await hasSameSenderInquiry(admin, mail.fromAddress);

  const { data, error } = await admin
    .from('contact_messages')
    .upsert(
      {
        // Falling back to the address keeps the name column populated when the
        // sender has no display name; the admin list renders it directly.
        name: mail.fromName ?? mail.fromAddress ?? 'ללא שם',
        email: mail.fromAddress,
        phone: null,
        topic: MAIL_TOPIC,
        message: body,
        user_id: null,
        source: 'outlook',
        source_message_id: mail.internetMessageId,
        thread_id: mail.conversationId,
      },
      { onConflict: 'source,source_message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    throw new Error('שמירת הפנייה מהדואר נכשלה', { cause: error });
  }

  // ignoreDuplicates makes an already-seen message return no rows. That is the
  // success path for a redelivery, not a failure — but see this function's own
  // doc comment above for why that path still needs to look the row up.
  let contactMessageId = data?.[0]?.id;
  const wasNew = Boolean(contactMessageId);
  if (!contactMessageId) {
    const { data: existing, error: findError } = await admin
      .from('contact_messages')
      .select('id')
      .eq('source', 'outlook')
      .eq('source_message_id', mail.internetMessageId)
      .maybeSingle();
    if (findError) {
      throw new Error('איתור הפנייה הקיימת נכשל', { cause: findError });
    }
    if (!existing) {
      // Should not happen — ignoreDuplicates just reported a conflict against
      // this exact (source, source_message_id) pair. Fail loudly rather than
      // silently drop the message if it somehow does.
      throw new Error('פנייה קיימת לא אותרה לאחר זיהוי כפילות');
    }
    contactMessageId = existing.id;
  }

  // The thread carries the same text the flat column does, so the conversation
  // view is right from the first message rather than only from the first reply.
  // Idempotent regardless of wasNew: on a redelivery this self-heals a prior
  // attempt's silently-lost insert instead of assuming it already succeeded (§2.8).
  const { error: threadError } = await admin.from('inquiry_messages').upsert(
    {
      inquiry_id: contactMessageId,
      direction: 'inbound',
      body,
      message_id: mail.internetMessageId,
      created_at: mail.receivedAt,
    },
    { onConflict: 'message_id', ignoreDuplicates: true },
  );
  if (threadError) {
    throw new Error('שמירת ההודעה בשרשור נכשלה', { cause: threadError });
  }

  if (!wasNew) return { status: 'duplicate' };

  // Same contract as the web form: only the row id reaches Slack — never the
  // sender, subject or body. `topic` is deliberately NOT sent: it is null for
  // mail intake now, `fields` is typed Record<string, string | number> so null
  // would not even compile, and `source: 'outlook'` above already carries the
  // one thing the old topic field was really saying.
  void sendSlackAlert(
    looksUnmatched
      ? {
          category: 'customer_inquiry',
          level: 'warn',
          title: 'תגובה אפשרית לא שויכה — נפתחה פנייה חדשה',
          source: 'outlook',
          fields: { contactMessageId },
        }
      : {
          category: 'customer_inquiry',
          level: 'info',
          title: 'פנייה חדשה בדואר',
          source: 'outlook',
          fields: { contactMessageId },
        },
  );

  return { status: 'created', contactMessageId };
}

/**
 * Keeps the Graph subscription alive. Run on a cron by the worker.
 *
 * A subscription expires after ~2.94 days and Graph gives no warning when it
 * lapses — intake simply goes quiet, and a silent stop is far worse than a loud
 * failure because nothing looks broken. So this runs on a cadence well inside
 * the window and alerts when it cannot do its job.
 *
 * Never throws: the worker's guard would alert on a throw anyway, but a lapsed
 * subscription is an ops fact worth its own message rather than a stack trace.
 */
export async function runGraphIntakeSubscriptionSweep(): Promise<void> {
  if (!graphConfigured()) return;

  let mailbox: string;
  try {
    mailbox = primaryMailbox();
  } catch {
    return; // Intake not configured for this deployment.
  }

  try {
    const folderId = await ensureMailFolder(mailbox, intakeFolderName());
    // Silent on success in every branch. A renewal that worked is the expected
    // state several times a week; alerting on it would train the reader to
    // ignore exactly the channel the failure below needs them to notice.
    await ensureIntakeSubscription(mailbox, folderId);
  } catch (err) {
    // Losing the subscription stops customer inquiries from ever arriving, and
    // nothing downstream would notice — no error, no queue backlog, just
    // silence. This alert is the only thing standing between that and a week of
    // unanswered mail.
    void sendSlackAlert({
      category: 'errors',
      level: 'error',
      title: 'חידוש מנוי קליטת הדואר נכשל — פניות בדואר לא ייקלטו',
      source: 'graph_intake',
      fields: { reason: err instanceof Error ? err.message : 'unknown' },
    });
  }
}

/**
 * A customer wrote back on a thread we already hold — matched by findExistingInquiry
 * (either the [KLF-XXXXXXXX] reference code or, as fallback, Graph's conversationId,
 * both sender-verified — §2.3).
 *
 * Status becomes `reopened`, NOT `new`, and that distinction is load-bearing.
 * The fleet trigger is `status = 'new' AND draft_reply IS NULL`; on an inquiry
 * that was already answered `draft_reply` is populated, so setting `new` would
 * leave the row looking handled and the drafter would never wake — the reply
 * would sit unanswered with nothing reporting it. `reopened` is paired with a
 * trigger clause that compares reply_needed_at against draft_created_at, so the
 * row stays eligible until a draft is written AFTER the customer's message.
 *
 * `handled_at` is cleared for the same reason: the inquiry is open again.
 */
async function attachReplyToInquiry(
  match: InquiryMatch,
  mail: InboundMail,
  body: string,
): Promise<MailIntakeResult> {
  const admin = createAdminClient();

  // The reply is appended as its own message. The flat `message` column is left
  // alone: it holds the ORIGINAL question, and overwriting it would destroy the
  // context the drafter needs to avoid repeating an answer already given.
  //
  // Runs unconditionally, first, even for a reply to a cancelled inquiry (§2.3
  // point 4) — this row is the durable record of what happened, not the
  // best-effort Slack alert below. Only the status/cascade mutation is skipped
  // for a cancelled row. Upsert on message_id (§2.7) guards against a
  // webhook_inbox retry re-running this after the insert already succeeded but
  // a later step failed — NULL is exempt from the underlying unique constraint
  // under standard Postgres semantics, so a web-form-originated row is
  // unaffected.
  const { error: threadError } = await admin.from('inquiry_messages').upsert(
    {
      inquiry_id: match.id,
      direction: 'inbound',
      body,
      message_id: mail.internetMessageId,
      created_at: mail.receivedAt,
    },
    { onConflict: 'message_id', ignoreDuplicates: true },
  );
  if (threadError) {
    throw new Error('שמירת תגובת הלקוח נכשלה', { cause: threadError });
  }

  // Backfill thread_id, write-once — fixes a gap found during independent
  // adversarial verification 2026-08-25: a web-form-originated row starts with
  // thread_id NULL (only mail intake's own new-inquiry branch ever sets it),
  // so a tier-1 (ref_code) match never gave a LATER reply — one whose ref_code
  // gets stripped or mangled in transit — a tier-2 (conversationId) fallback to
  // land on. Runs even for a cancelled row: the thread link is a fact about the
  // conversation, not a verdict on it — the cancelled-guard below only skips
  // the status/cascade mutation. Never overwrites an existing thread_id: a
  // tier-2 match's row already carries this exact value by construction (its
  // own SELECT filtered on it), so this is a genuine no-op there; a tier-1
  // match only ever learns it once, the first time. Throws on failure (not
  // best-effort) so webhook_inbox's retry picks this row up again rather than
  // leaving the gap permanently unfixed.
  if (!match.thread_id && mail.conversationId) {
    const { error: threadIdError } = await admin
      .from('contact_messages')
      .update({ thread_id: mail.conversationId })
      .eq('id', match.id);
    if (threadIdError) {
      throw new Error('שמירת מזהה השרשור נכשלה', { cause: threadIdError });
    }
  }

  if (match.status === 'cancelled') {
    // Deliberate cancellation — do not resurrect the row's status/cascade
    // state. The reply itself is already safely recorded above. Distinct title
    // from a normal reopen so ops can tell the two apart at a glance; ids only,
    // no PII.
    void sendSlackAlert({
      category: 'customer_inquiry',
      level: 'warn',
      title: 'לקוח הגיב לפנייה שבוטלה',
      source: 'outlook',
      fields: { contactMessageId: match.id },
    });
    return { status: 'skipped', reason: 'cancelled' };
  }

  const { error } = await admin
    .from('contact_messages')
    .update({
      status: 'reopened',
      reply_needed_at: mail.receivedAt,
      last_activity_at: mail.receivedAt,
      handled_at: null,
      // A reopen starts a fresh silence-cascade cycle — round-1's stamps must
      // not leak into round-2's gating (listDueForReminder/Warning/AutoClose
      // all gate on "is null"). rating_token clears alongside
      // rating_requested_at since together they're the whole /rate/[token]
      // auth pair. rating_score/rating_comment/rating_at are deliberately NOT
      // touched — resubmission overwrites those in place by design, and this
      // reopen is unrelated to the rating itself (§2.3 point 5).
      reminder_sent_at: null,
      closing_warning_sent_at: null,
      auto_closed_at: null,
      rating_requested_at: null,
      rating_token: null,
    })
    .eq('id', match.id);
  if (error) {
    throw new Error('עדכון הפנייה שנפתחה מחדש נכשל', { cause: error });
  }

  void sendSlackAlert({
    category: 'customer_inquiry',
    level: 'info',
    title: 'לקוח הגיב לפנייה קיימת',
    source: 'outlook',
    fields: { contactMessageId: match.id },
  });

  return { status: 'reopened', contactMessageId: match.id };
}
