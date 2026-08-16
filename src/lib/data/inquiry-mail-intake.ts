import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { ensureMailFolder, fetchInboundMail, flattenForDrafter } from '@/lib/microsoft/mail';
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
 * `INQUIRY_TOPICS` is closed only at the FORM boundary — the same list gates
 * both public schemas (contactMessageSchema and callbackRequestSchema), but the
 * column itself is free text with no CHECK constraint, verified against
 * pg_constraint. Server-side flows already write descriptive values outside the
 * list: callback_requests carries 'שיחה נכנסת ללא נציג זמין' and
 * 'בקשת "התקשרו אליי עכשיו" — לא נמצא נציג זמין'.
 *
 * So intake follows that precedent rather than flattening to 'אחר'. The admin
 * list renders topic raw, and 'אחר' would tell a reader nothing; the channel
 * does. Machine-readable provenance lives in `source` — this is the label.
 */
const MAIL_TOPIC = 'פנייה בדואר';

export type MailIntakeResult =
  | { status: 'created'; contactMessageId: string }
  | { status: 'duplicate' }
  | { status: 'gone' }
  | { status: 'skipped'; reason: string };

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
 * Idempotent by construction: the insert is an upsert on
 * `(source, source_message_id)`, and `source_message_id` is the RFC 5322
 * Message-ID — stable even if the item is moved between folders, unlike Graph's
 * own item id. A redelivered notification therefore resolves to 'duplicate'
 * rather than a second inquiry, a second draft, and a second reply.
 */
export async function intakeMailAsInquiry(graphMessageId: string): Promise<MailIntakeResult> {
  const mailbox = primaryMailbox();
  const mail = await fetchInboundMail(mailbox, graphMessageId);
  if (!mail) return { status: 'gone' };

  const skip = skipReason(mail.fromAddress, mailbox);
  if (skip) return { status: 'skipped', reason: skip };

  const admin = createAdminClient();
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
        message: flattenForDrafter(mail),
        user_id: null,
        source: 'outlook',
        source_message_id: mail.internetMessageId,
      },
      { onConflict: 'source,source_message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    throw new Error('שמירת הפנייה מהדואר נכשלה', { cause: error });
  }

  // ignoreDuplicates makes an already-seen message return no rows. That is the
  // success path for a redelivery, not a failure.
  const created = data?.[0]?.id;
  if (!created) return { status: 'duplicate' };

  // Same contract as the web form: only the row id and the closed-vocabulary
  // topic reach Slack — never the sender, subject or body.
  void sendSlackAlert({
    category: 'customer_inquiry',
    level: 'info',
    title: 'פנייה חדשה בדואר',
    source: 'outlook',
    fields: { contactMessageId: created, topic: MAIL_TOPIC },
  });

  return { status: 'created', contactMessageId: created };
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
