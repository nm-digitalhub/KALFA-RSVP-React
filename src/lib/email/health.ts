import 'server-only';

import nodemailer from 'nodemailer';
import { Resend } from 'resend';

// Passive health check for OUTGOING MAIL: does the transport actually work, asked
// WITHOUT sending a message to anyone.
//
// The integrations panel said "אין בדיקת בריאות זמינה" for this card. That was never
// true — it only reflected that nobody had looked. Resend exposes the domain registry
// read-only, and reading it exercises the API key AND the DNS state of the domain the
// From header actually uses. The SMTP fallback has nodemailer's verify(), which
// connects and authenticates without sending.
//
// ⚠️ WHY THIS CHECK MATTERS MORE THAN THE WHATSAPP ONE. Outgoing mail dies SILENTLY.
// A send keeps returning 200 while SPF or DKIM is broken; the recipient's provider
// quietly files it as spam, and nothing in this system ever hears about it. Resend
// names that exact state `temporary_failure` — "a previously verified domain that is
// currently missing required DNS records" (resend.com/docs/dashboard/domains/
// introduction). Catching it is the whole point.
//
// ⚠️ THE DOMAIN STATUS IS TREATED AS A STRING, DELIBERATELY. Measured against the
// installed SDK (resend 6.26.0, 2026-09-10):
//
//   DomainRecordStatus = 'pending' | 'verified' | 'failed' | 'temporary_failure' | 'not_started'
//   DomainStatus       = 'pending' | 'verified' | 'failed' | 'not_started'
//                        | 'partially_verified' | 'partially_failed'
//
// The DOMAIN-level union is missing `temporary_failure` even though Resend's own docs
// describe it as a domain status. A switch over the typed union would silently drop
// the one value that means "your verified domain just broke". So the status is carried
// as a string and an unrecognised value is reported as unknown rather than as healthy.
//
// ⚠️ WHAT IT DOES NOT PROVE. That a particular message will be delivered. Reputation,
// content filtering, a recipient's own rules and bounce history all sit outside this.
// "תקין" here means the TRANSPORT and the sending domain are sound; the UI wording must
// not promise more. A test SEND is deliberately not part of it.
//
// Never returns, logs, or embeds the API key or the SMTP password.

export type EmailHealthFailure =
  /** The Resend key is missing, malformed, or rejected. */
  | 'key_invalid'
  /**
   * The key is valid but scoped to SENDING only, so it may not read the domain
   * registry. NOT a fault — a sending-only key is the safer configuration. The
   * caller must treat this as "could not ask", never as "broken".
   */
  | 'key_restricted'
  /** smtp_from's domain is not registered in this Resend account at all. */
  | 'domain_missing'
  /** Registered but never verified — sends from it will be refused. */
  | 'domain_unverified'
  /** Verified once and broken now, or verification failed. The silent-death case. */
  | 'domain_failed'
  /** Registered and verified, but sending is switched off for it in Resend. */
  | 'sending_disabled'
  /** Resend throttled or quota-capped us — says nothing about configuration. */
  | 'rate_limited'
  /** SMTP host reachable but rejected the credentials. */
  | 'smtp_auth_failed'
  /** Network, timeout, or a response shape we do not recognise. */
  | 'unreachable';

export interface EmailHealthRecord {
  /** 'SPF' | 'DKIM' | 'Tracking' | … — Resend's own label, never derived here. */
  record: string;
  status: string;
}

export interface EmailHealthOk {
  ok: true;
  transport: 'resend' | 'smtp';
  /** The business sender address. Not personal data — it is printed on the website. */
  from: string;
  /** Resend only: the domain derived from `from`, and Resend's verdict on it. */
  domain: string | null;
  domainStatus: string | null;
  /** Resend only: the SPF/DKIM rows behind that verdict, for the panel to show. */
  records: EmailHealthRecord[];
  /**
   * True when the domain reads exactly 'verified'. `partially_verified` resolves to
   * false WITHOUT being a failure — an optional record (open/click tracking, which
   * this system does not use) can be pending while mail flows perfectly.
   */
  fullyVerified: boolean | null;
}

export interface EmailHealthError {
  ok: false;
  kind: EmailHealthFailure;
  /** Hebrew, safe to render. NEVER carries a key, a password, or a raw provider body. */
  message: string;
  /** Present when the provider named a status we do not recognise — reported verbatim. */
  observedStatus?: string;
}

export type EmailHealth = EmailHealthOk | EmailHealthError;

const MESSAGES: Record<EmailHealthFailure, string> = {
  key_invalid: 'מפתח ה-API של Resend אינו תקף',
  key_restricted: 'מפתח ה-API מוגבל לשליחה בלבד — לא ניתן לקרוא את מצב הדומיין',
  domain_missing: 'דומיין השליחה אינו רשום בחשבון Resend',
  domain_unverified: 'דומיין השליחה טרם אומת ב-Resend — שליחות ידחו',
  domain_failed: 'אימות דומיין השליחה נשבר — רשומות ה-DNS חסרות או נכשלו',
  sending_disabled: 'השליחה מהדומיין הזה כבויה ב-Resend',
  rate_limited: 'Resend הגבילה זמנית את הקריאות — הבדיקה תחזור מאוחר יותר',
  smtp_auth_failed: 'שרת הדואר דחה את פרטי ההזדהות',
  unreachable: 'לא ניתן להגיע לספק הדואר',
};

/**
 * Statuses that mean "mail will not leave, or will leave unsigned".
 *
 * `temporary_failure` is here even though the SDK's DomainStatus union omits it —
 * see the file header. It is the one that matters most: it is what a working setup
 * degrades INTO.
 */
const BROKEN_STATUSES = new Set(['failed', 'partially_failed', 'temporary_failure']);
/** Registered, but verification has not completed. Sends are refused in this state. */
const PENDING_STATUSES = new Set(['not_started', 'pending']);
/** Mail flows. `partially_verified` = an OPTIONAL record is outstanding, not a fault. */
const HEALTHY_STATUSES = new Set(['verified', 'partially_verified']);

/**
 * Only SPF and DKIM decide health.
 *
 * Resend also returns Tracking and CAA rows for open/click tracking, a feature this
 * system does not use. Their `pending` state is permanent here and would page someone
 * hourly, forever, about a feature nobody enabled — which is how an alert channel gets
 * muted. Filtering them out is the difference between a signal and a nuisance.
 */
const DELIVERABILITY_RECORDS = new Set(['SPF', 'DKIM']);

/**
 * The domain a message is actually sent FROM.
 *
 * `smtp_from` holds either `noreply@send.kalfa.me` or `KALFA <noreply@send.kalfa.me>`
 * — both are valid in the admin form and both are in use. Anything else returns null
 * rather than a guess: checking the wrong domain and reporting it healthy is worse
 * than reporting that we could not tell which domain to check.
 */
export function domainFromSender(from: string): string | null {
  const angled = from.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : from).trim();
  const at = address.lastIndexOf('@');
  if (at === -1 || at === address.length - 1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain.includes('.') ? domain : null;
}

/** Map a Resend error name onto one of our kinds. The name is the stable part. */
function classifyResend(name: string | undefined): EmailHealthFailure {
  switch (name) {
    case 'missing_api_key':
    case 'invalid_api_key':
      return 'key_invalid';
    // A key with SENDING access cannot read /domains. That is a deliberate, safer
    // configuration — reporting it as a fault would push someone to widen the key.
    case 'restricted_api_key':
    case 'invalid_access':
      return 'key_restricted';
    case 'rate_limit_exceeded':
    case 'daily_quota_exceeded':
    case 'monthly_quota_exceeded':
      return 'rate_limited';
    default:
      return 'unreachable';
  }
}

/**
 * Two calls, because one does not answer the question.
 *
 * `domains.list()` proves the key works and finds the domain matching the From header.
 * It does NOT report the DNS rows behind that verdict, and `partially_failed` alone
 * cannot say WHICH record broke — SPF failing and Tracking failing carry the same
 * domain status and completely different consequences. So call two fetches the domain
 * and reads its SPF/DKIM rows directly.
 *
 * Matching against the From domain is the load-bearing part: a Resend account can hold
 * several verified domains, and "some domain is verified" proves nothing about the one
 * this system sends from. Same reasoning as the WhatsApp check's second call.
 */
async function checkResendHealth(apiKey: string, from: string): Promise<EmailHealth> {
  const wanted = domainFromSender(from);
  if (!wanted) {
    return {
      ok: false,
      kind: 'unreachable',
      message: 'לא ניתן לגזור את דומיין השליחה מכתובת השולח',
    };
  }

  const client = new Resend(apiKey);

  let list;
  try {
    list = await client.domains.list();
  } catch {
    // Never surface the thrown message — a client error can echo request details.
    return { ok: false, kind: 'unreachable', message: MESSAGES.unreachable };
  }
  if (list.error || !list.data) {
    const kind = classifyResend(list.error?.name);
    return { ok: false, kind, message: MESSAGES[kind] };
  }

  const match = list.data.data.find((d) => d.name.trim().toLowerCase() === wanted);
  if (!match) {
    return { ok: false, kind: 'domain_missing', message: MESSAGES.domain_missing };
  }

  const status = String(match.status);
  if (BROKEN_STATUSES.has(status)) {
    return { ok: false, kind: 'domain_failed', message: MESSAGES.domain_failed, observedStatus: status };
  }
  if (PENDING_STATUSES.has(status)) {
    return {
      ok: false,
      kind: 'domain_unverified',
      message: MESSAGES.domain_unverified,
      observedStatus: status,
    };
  }
  if (!HEALTHY_STATUSES.has(status)) {
    // A status Resend added after this was written. Report it verbatim rather than
    // deciding it is fine — the SDK's own union already lags its docs by one value.
    return {
      ok: false,
      kind: 'unreachable',
      message: `Resend החזירה מצב דומיין לא מוכר: ${status}`,
      observedStatus: status,
    };
  }
  if (match.capabilities?.sending === 'disabled') {
    return { ok: false, kind: 'sending_disabled', message: MESSAGES.sending_disabled };
  }

  // Call two. A failure here is NOT fatal: call one already established that the key
  // works and the domain is verified, which is most of the answer. Losing the record
  // breakdown degrades the detail, and inventing a failure over it would be worse.
  let records: EmailHealthRecord[] = [];
  try {
    const detail = await client.domains.get(match.id);
    if (!detail.error && detail.data) {
      records = (detail.data.records ?? [])
        .filter((r) => DELIVERABILITY_RECORDS.has(r.record))
        .map((r) => ({ record: r.record, status: String(r.status) }));
    }
  } catch {
    /* keep the empty breakdown — the verdict above stands on its own */
  }

  // A domain can read 'verified' while an individual SPF/DKIM row has since degraded;
  // the domain-level roll-up is not always immediate. Trust the rows when we have them.
  const brokenRecord = records.find((r) => BROKEN_STATUSES.has(r.status));
  if (brokenRecord) {
    return {
      ok: false,
      kind: 'domain_failed',
      message: `${MESSAGES.domain_failed} (${brokenRecord.record})`,
      observedStatus: brokenRecord.status,
    };
  }

  return {
    ok: true,
    transport: 'resend',
    from,
    domain: wanted,
    domainStatus: status,
    records,
    fullyVerified: status === 'verified',
  };
}

/**
 * SMTP's passive equivalent: connect, STARTTLS, AUTH, quit. No message is composed and
 * none is sent. It proves the host is reachable and the credentials are accepted —
 * which is exactly the pair that breaks when a mailbox password rotates.
 *
 * It cannot say anything about SPF or DKIM: on this path the relay rewrites the body
 * and signs it, so DNS state is the relay's business, not ours (see smtpSender).
 * `records` is therefore empty and `fullyVerified` null — absent, not false.
 */
async function checkSmtpHealth(
  cfg: {
    smtp_host: string;
    smtp_port: number;
    smtp_secure: boolean;
    smtp_user: string;
    smtp_password: string;
  },
  from: string,
): Promise<EmailHealth> {
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
  });
  try {
    await transporter.verify();
    return {
      ok: true,
      transport: 'smtp',
      from,
      domain: domainFromSender(from),
      domainStatus: null,
      records: [],
      fullyVerified: null,
    };
  } catch (err) {
    // nodemailer puts the SMTP reply code on the error. 535/534/454 are the AUTH
    // family; anything else is a connection problem. The provider's own text is never
    // surfaced — it can echo the username.
    const code = (err as { responseCode?: number })?.responseCode;
    const kind: EmailHealthFailure =
      code === 535 || code === 534 || code === 454 ? 'smtp_auth_failed' : 'unreachable';
    return { ok: false, kind, message: MESSAGES[kind] };
  } finally {
    transporter.close();
  }
}

export const emailHealthMessages = MESSAGES;
export { checkResendHealth, checkSmtpHealth };
