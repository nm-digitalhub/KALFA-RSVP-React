import 'server-only';

import { graphClient, mailboxPath } from './graph-client';

// Reading inbound mail from the business mailbox.
//
// The consumer of everything here is `support-drafter`, a Tier-0 fleet role. It
// CANNOT reach Graph, cannot open the mailbox, cannot fetch an attachment and
// cannot walk a thread — the fleet permission tiers deny WebFetch, curl, inline
// interpreters and any read of `.env*`. So whatever the drafter needs in order
// to write a reply has to be flattened into plain text HERE, at intake, by a
// process that IS allowed to hold credentials.
//
// That constraint is the reason the design works rather than a limitation of
// it: the agent sees a normalized record, never a mailbox.

/**
 * Resolves a mail folder's id from its display name, creating it when absent.
 *
 * Creating it is the right default rather than an overreach: the intake folder
 * is infrastructure this system owns, and a subscription cannot be created
 * against a folder that does not exist yet. Returns the id either way.
 */
export async function ensureMailFolder(mailbox: string, displayName: string): Promise<string> {
  // Well-known names ('inbox', 'archive', …) are valid folder ids in Graph and
  // must not be looked up or created.
  if (/^[a-z]+$/.test(displayName)) return displayName;

  const found = (await graphClient()
    .api(`${mailboxPath(mailbox)}/mailFolders`)
    .filter(`displayName eq '${displayName.replace(/'/g, "''")}'`)
    .select('id,displayName')
    .get()) as { value?: Array<{ id?: string }> };

  const existing = found.value?.[0]?.id;
  if (existing) return existing;

  const created = (await graphClient()
    .api(`${mailboxPath(mailbox)}/mailFolders`)
    .post({ displayName })) as { id?: string };
  if (!created.id) throw new Error('graph_folder_create_failed');
  return created.id;
}

/** A message reduced to what a drafter can actually use. */
export type InboundMail = {
  /** Graph's item id — mailbox-scoped, changes if the item moves. */
  id: string;
  /**
   * RFC 5322 Message-ID. STABLE across folder moves, unlike `id`, which is why
   * this is what dedupe keys off.
   */
  internetMessageId: string;
  conversationId: string | null;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string;
  /** Plain text. Requested as text from Graph so no HTML stripping is needed. */
  body: string;
  hasAttachments: boolean;
  attachmentNames: string[];
};

type GraphMessage = {
  id?: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
};

const SELECT =
  'id,internetMessageId,conversationId,subject,receivedDateTime,hasAttachments,bodyPreview,body,from';

/**
 * Fetches one message. Returns null when it is gone — a notification can arrive
 * for an item the owner deletes a second later, and that is an ordinary race,
 * not an error worth retrying.
 */
export async function fetchInboundMail(
  mailbox: string,
  messageId: string,
): Promise<InboundMail | null> {
  let msg: GraphMessage;
  try {
    msg = (await graphClient()
      .api(`${mailboxPath(mailbox)}/messages/${encodeURIComponent(messageId)}`)
      // Ask Graph for plain text rather than converting HTML ourselves. The
      // service renders it from the original, which handles quoted replies and
      // signatures far better than tag-stripping does.
      .header('Prefer', 'outlook.body-content-type="text"')
      .select(SELECT)
      .get()) as GraphMessage;
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : NaN;
    if (status === 404) return null;
    throw err;
  }

  if (!msg.id || !msg.internetMessageId) return null;

  let attachmentNames: string[] = [];
  if (msg.hasAttachments) {
    // Names only. The drafter can never open these, but "there is a PDF called
    // חוזה.pdf attached" changes what a sensible reply says, so the fact has to
    // survive into the text it reads.
    try {
      const res = (await graphClient()
        .api(`${mailboxPath(mailbox)}/messages/${encodeURIComponent(msg.id)}/attachments`)
        .select('name')
        .get()) as { value?: Array<{ name?: string }> };
      attachmentNames = (res.value ?? []).map((a) => a.name ?? '').filter(Boolean);
    } catch {
      // A listing failure must not lose the message itself.
      attachmentNames = [];
    }
  }

  return {
    id: msg.id,
    internetMessageId: msg.internetMessageId,
    conversationId: msg.conversationId ?? null,
    subject: (msg.subject ?? '').trim(),
    fromName: msg.from?.emailAddress?.name?.trim() || null,
    fromAddress: msg.from?.emailAddress?.address?.trim()?.toLowerCase() || null,
    receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
    body: (msg.body?.content ?? msg.bodyPreview ?? '').trim(),
    hasAttachments: msg.hasAttachments === true,
    attachmentNames,
  };
}

/** Hard cap on stored body text — a mail thread can be enormous. */
const BODY_MAX = 8000;

/**
 * Flattens a message into the single text field the drafter reads.
 *
 * Subject is included in the body on purpose: `contact_messages` has no subject
 * column, and a reply written without the subject line reads as if it answered
 * a different email.
 */
export function flattenForDrafter(mail: InboundMail): string {
  const parts: string[] = [];
  if (mail.subject) parts.push(`נושא: ${mail.subject}`);
  if (mail.attachmentNames.length > 0) {
    parts.push(`קבצים מצורפים (לא נגישים לניסוח): ${mail.attachmentNames.join(', ')}`);
  } else if (mail.hasAttachments) {
    parts.push('צורף קובץ (שמו לא אותר, ואינו נגיש לניסוח)');
  }
  const body = mail.body.length > BODY_MAX ? `${mail.body.slice(0, BODY_MAX)}\n…[קוצר]` : mail.body;
  parts.push(body);
  return parts.join('\n\n');
}
