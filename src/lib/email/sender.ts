import 'server-only';

import nodemailer from 'nodemailer';

import { createAdminClient } from '@/lib/supabase/admin';

// Email transport for KALFA business emails (signed agreement, invoices, etc.).
// SMTP (IONOS Exchange) via nodemailer; config from app_settings (admin-managed,
// server-only). Never log the password or the message bodies.

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

export async function getEmailSender(): Promise<EmailSender> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select(
      'email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from',
    )
    .eq('id', true)
    .maybeSingle();
  if (error) throw new EmailConfigError('טעינת הגדרות הדואר נכשלה');
  if (
    !data?.email_enabled ||
    !data.smtp_host ||
    !data.smtp_port ||
    !data.smtp_user ||
    !data.smtp_password ||
    !data.smtp_from
  ) {
    throw new EmailConfigError('שירות הדואר אינו מוגדר');
  }

  // No client-side DKIM signing: the IONOS Exchange relay rewrites the message
  // body, which invalidates any pre-applied DKIM signature (verified: receivers
  // report dkim=neutral "body hash did not verify"). DMARC is satisfied via SPF
  // instead — the From/Return-Path domain (kalfa.me) is aligned, and the IONOS
  // sending hosts (_spf.perfora.net) must be authorized in kalfa.me's SPF record.
  const transporter = nodemailer.createTransport({
    host: data.smtp_host,
    port: data.smtp_port,
    secure: data.smtp_secure, // true=465/SSL, false=587/STARTTLS
    auth: { user: data.smtp_user, pass: data.smtp_password },
  });
  const from = data.smtp_from;

  return {
    async send({ to, subject, html, text, attachments }) {
      try {
        await transporter.sendMail({
          from,
          to,
          replyTo: from,
          subject,
          html,
          text, // plain-text alternative → multipart, better deliverability
          attachments: attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content),
            contentType: a.contentType,
          })),
        });
      } catch {
        throw new EmailSendError('שליחת הדואר נכשלה');
      }
    },
  };
}
