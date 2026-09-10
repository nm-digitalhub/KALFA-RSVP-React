import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';

import { checkResendHealth, checkSmtpHealth, type EmailHealth } from './health';
import { readEmailSettings, selectedEmailProvider } from './sender';

// The scheduled half of the outgoing-mail health check: run the passive probe, and say
// something ONLY when the answer changes for the worse.
//
// Alerting rules, in the order they mattered when writing this:
//
//  1. NOT CONFIGURED IS NOT A FAULT. Mail switched off, or no From address, is a valid
//     state. It returns 'skipped' and the queue still records a completion, so "last
//     checked" on the card stays truthful.
//  2. NEITHER IS A SENDING-ONLY API KEY. A Resend key scoped to sending cannot read
//     /domains — that is the SAFER key, and paging about it would push someone to widen
//     it. Reported as 'skipped', never alerted. "We could not ask" is not "it is broken".
//  3. NEITHER IS THROTTLING. Resend rate-limiting or quota-capping us says nothing about
//     configuration. Recorded, not alerted.
//  4. A BROKEN SENDING DOMAIN IS THE WHOLE POINT. failed / partially_failed /
//     temporary_failure mean mail is going out unsigned or not at all, while every send
//     call keeps returning success. Nothing else in this system would surface it, so it
//     alerts at ERROR.
//  5. Never throws. A health check that can take the worker down is worse than none.
export type EmailHealthOutcome = 'ok' | 'skipped' | 'degraded' | 'failed';

export interface EmailHealthSummary {
  outcome: EmailHealthOutcome;
  /** Present when the probe ran; null when there was nothing configured to probe. */
  health: EmailHealth | null;
}

/** Failures that describe OUR ability to ask, not the integration's health. */
const NOT_A_FAULT = new Set(['key_restricted', 'rate_limited']);

/**
 * Read the settings, pick the transport, run the probe. NO alerting.
 *
 * Split out of runEmailHealthCheck so /admin/integrations/outgoing-email can show the
 * same verdict without a page render firing Slack. One definition of "which transport
 * is live and is it healthy" — the scheduled job below adds the alerting policy on top
 * rather than re-deriving the answer.
 *
 * Returns null when there is nothing configured to probe, which the caller must render
 * as "not set up" and never as "broken".
 */
export async function probeEmailHealth(): Promise<EmailHealth | null> {
  const settings = await readEmailSettings();
  if (settings.kind !== 'ok') return null;

  const from = settings.data.smtp_from as string;
  const provider = selectedEmailProvider();

  if (provider === 'resend') {
    const apiKey = process.env.RESEND_API_KEY;
    // EMAIL_PROVIDER says resend and the key is absent: that IS a fault — the send path
    // would throw on the next business email. It is not "unconfigured", because someone
    // deliberately selected this transport.
    if (!apiKey) {
      return {
        ok: false,
        kind: 'key_invalid',
        message: 'EMAIL_PROVIDER=resend אך RESEND_API_KEY חסר',
      };
    }
    return checkResendHealth(apiKey, from);
  }

  const { smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure } = settings.data;
  // The SMTP path with half a config is genuinely unconfigured, not broken.
  if (!smtp_host || !smtp_port || !smtp_user || !smtp_password) return null;
  return checkSmtpHealth(
    { smtp_host, smtp_port, smtp_secure: smtp_secure ?? false, smtp_user, smtp_password },
    from,
  );
}

export async function runEmailHealthCheck(): Promise<EmailHealthSummary> {
  // null covers both "mail switched off / no From address" and "half an SMTP config":
  // valid states, never alerted. An unreadable settings row lands here too, and that
  // is deliberate — it is a database problem the DB panels already show, and alerting
  // on it here would send someone to look at the wrong system.
  const health = await probeEmailHealth();
  if (!health) return { outcome: 'skipped', health: null };

  const provider = selectedEmailProvider();

  if (!health.ok) {
    if (NOT_A_FAULT.has(health.kind)) {
      return { outcome: health.kind === 'key_restricted' ? 'skipped' : 'degraded', health };
    }

    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'email-health-check',
      title: 'דואר יוצא — בדיקת החיבור נכשלה',
      detail: health.message,
      // `kind` and the provider's own status string. Both are safe by construction:
      // no key, password or raw provider body reaches this point (see health.ts).
      fields: {
        kind: health.kind,
        transport: provider,
        ...(health.observedStatus ? { status: health.observedStatus } : {}),
      },
    });
    return { outcome: 'failed', health };
  }

  // Verified, but not FULLY — an optional record (open/click tracking, unused here) is
  // outstanding. Worth recording, not worth waking anyone.
  if (health.fullyVerified === false) {
    return { outcome: 'degraded', health };
  }

  return { outcome: 'ok', health };
}
