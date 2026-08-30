import 'server-only';

import nodemailer from 'nodemailer';
import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';

// Email transport for KALFA business emails (signed agreement, invoices, etc.).
//
// Two transports, chosen by EMAIL_PROVIDER so a rollback needs no deploy and
// does not depend on the database being reachable:
//
//   resend  — the Resend API. A transactional sender, which is what this
//             traffic actually is.
//   smtp    — nodemailer against the mailbox host in app_settings. The
//             original path, kept as the fallback.
//
// Why the API path exists at all: sending application mail out of a HUMAN
// MAILBOX is what every provider treats as suspicious. Exchange Online refused
// this tenant's outbound mail with `550 5.7.708 … traffic not accepted from
// this IP`, generated inside the service before any recipient was contacted
// (measured: the failure's FQDN and IP fields come back empty). A mailbox also
// caps at 30 messages/minute and reports delivery failures only as a bounce
// into someone's inbox, which no code ever sees.
//
// Never log the credentials, the recipients, or the message bodies.

export type EmailAttachment = {
  filename: string;
  content: Uint8Array;
  contentType: string;
};

export interface EmailSender {
  send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
    /**
     * Outbound-only defense in depth (docs/inquiry-email-threading-fix-plan-
     * 2026-08-25.md §2.4) — NOT a matching tier. The real matching signal is the
     * `[KLF-XXXXXXXX]` subject token; these headers just give a mail client's own
     * threading a second, independent chance to group the conversation.
     */
    inReplyTo?: string;
    references?: string[];
    /**
     * Resend-only (§2.6): closes the outbound duplicate-send gap when a sweep
     * crashes between sending and persisting its completion stamp. Remembered
     * for 24 hours by Resend, not indefinitely — see §2.6 for the bounded,
     * low-probability residual this leaves. Silently ignored by `smtpSender`;
     * nodemailer/SMTP has no protocol-level equivalent.
     */
    idempotencyKey?: string;
  }): Promise<void>;
}

export class EmailConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EmailConfigError';
  }
}
export class EmailSendError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EmailSendError';
  }
}

export type EmailProvider = 'resend' | 'smtp';

/**
 * Which transport is live. Defaults to `smtp` deliberately: the safe direction
 * for an unset variable is the path that is already proven in production, not
 * the new one.
 */
export function selectedEmailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === 'resend' ? 'resend' : 'smtp';
}

/** The admin-managed row both transports read. `email_enabled` gates both. */
async function emailSettings() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select(
      'email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from',
    )
    .eq('id', true)
    .maybeSingle();
  if (error) throw new EmailConfigError('טעינת הגדרות הדואר נכשלה');
  if (!data?.email_enabled || !data.smtp_from) {
    throw new EmailConfigError('שירות הדואר אינו מוגדר');
  }
  return data;
}

function resendSender(apiKey: string, from: string): EmailSender {
  const client = new Resend(apiKey);
  return {
    async send({ to, subject, html, text, attachments, inReplyTo, references, idempotencyKey }) {
      // The SDK reports failures in `error` rather than by throwing, so a
      // bare await would silently succeed on a rejected send.
      const { error } = await client.emails.send(
        {
          from,
          to,
          replyTo: from,
          subject,
          html,
          ...(text ? { text } : {}),
          ...(inReplyTo
            ? {
                headers: {
                  'In-Reply-To': inReplyTo,
                  References: (references ?? [inReplyTo]).join(' '),
                },
              }
            : {}),
          ...(attachments?.length
            ? {
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  content: Buffer.from(a.content),
                  contentType: a.contentType,
                })),
              }
            : {}),
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
      // The message never carries the provider's wording — it can name the
      // recipient or the reason, and neither belongs in a user-facing string.
      // The real reason is still worth having server-side: log it here (per
      // Resend's own documented pattern — console.error(error) at the point
      // { data, error } is destructured) before it's discarded below.
      if (error) {
        console.error(`[email] resend send failed: ${error.name} — ${error.message}`);
        throw new EmailSendError('שליחת הדואר נכשלה');
      }
    },
  };
}

function smtpSender(
  cfg: {
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_secure: boolean | null;
    smtp_user: string | null;
    smtp_password: string | null;
  },
  from: string,
): EmailSender {
  if (!cfg.smtp_host || !cfg.smtp_port || !cfg.smtp_user || !cfg.smtp_password) {
    throw new EmailConfigError('שירות הדואר אינו מוגדר');
  }
  // No client-side DKIM signing on this path: the relay rewrites the message
  // body, which invalidates any pre-applied signature (verified: receivers
  // report dkim=neutral "body hash did not verify"). DMARC is satisfied via
  // SPF instead — From/Return-Path (kalfa.me) is aligned, and the relay's
  // sending hosts must stay authorized in kalfa.me's SPF record.
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure ?? false, // true=465/SSL, false=587/STARTTLS
    auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
  });
  return {
    async send({ to, subject, html, text, attachments, inReplyTo, references }) {
      try {
        await transporter.sendMail({
          from,
          to,
          replyTo: from,
          subject,
          html,
          text, // plain-text alternative → multipart, better deliverability
          ...(inReplyTo ? { inReplyTo, references: references ?? [inReplyTo] } : {}),
          attachments: attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content),
            contentType: a.contentType,
          })),
        });
      } catch (err) {
        // Same rationale as resendSender above: log the real reason server-side
        // before collapsing it into the generic user-facing message.
        console.error(
          `[email] smtp send failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new EmailSendError('שליחת הדואר נכשלה');
      }
    },
  };
}

export async function getEmailSender(): Promise<EmailSender> {
  const data = await emailSettings();
  // `smtp_from` is reused rather than duplicated: it already holds the
  // display-name-plus-address the business sends as, it is already editable in
  // the admin settings form, and the From header means the same thing to both
  // transports.
  const from = data.smtp_from as string;

  if (selectedEmailProvider() === 'resend') {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new EmailConfigError('שירות הדואר אינו מוגדר');
    return resendSender(apiKey, from);
  }
  return smtpSender(data, from);
}
