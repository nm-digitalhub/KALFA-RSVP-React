import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';

import { checkWhatsAppHealth, type WhatsAppHealth } from './health';

// The scheduled half of the WhatsApp health check: run the passive probe, and say
// something ONLY when the answer changes for the worse.
//
// Alerting rules, in the order they mattered when writing this:
//
//  1. NOT CONFIGURED IS NOT A FAULT. An install with no WhatsApp credentials is a
//     valid state, and paging about it hourly forever is how an alert channel gets
//     muted. It returns 'skipped' and the queue still records a completion, so
//     "last checked" stays truthful.
//  2. THROTTLING IS NOT A FAULT EITHER. Meta rate-limiting us says nothing about
//     configuration; alerting on it would turn a Meta capacity blip into a KALFA
//     incident. Recorded, not alerted.
//  3. QUALITY IS META'S JUDGEMENT, NOT OURS. A RED rating is reported verbatim and
//     never re-derived — but it IS worth a warning, because it precedes throttling
//     and template loss and nothing else in this system would surface it.
//  4. Never throws. A health check that can take the worker down is worse than no
//     health check.
export type HealthCheckOutcome = 'ok' | 'skipped' | 'degraded' | 'failed';

export interface HealthCheckSummary {
  outcome: HealthCheckOutcome;
  /** Present when the probe ran; null when there was nothing configured to probe. */
  health: WhatsAppHealth | null;
}

export async function runWhatsAppHealthCheck(): Promise<HealthCheckSummary> {
  let config: Awaited<ReturnType<typeof getWhatsAppConfig>> = null;
  try {
    config = await getWhatsAppConfig();
  } catch {
    // Config unreadable is an infrastructure problem the DB panels already show.
    return { outcome: 'skipped', health: null };
  }
  if (!config) return { outcome: 'skipped', health: null };

  const health = await checkWhatsAppHealth({
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    accessToken: config.accessToken,
  });

  if (!health.ok) {
    if (health.kind === 'rate_limited') return { outcome: 'degraded', health };

    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'whatsapp-health-check',
      title: 'WhatsApp — בדיקת החיבור נכשלה',
      detail: health.message,
      // `kind` only. The message is already Hebrew and safe; the raw Graph body and
      // the token never reach this point by construction (see health.ts).
      fields: { kind: health.kind },
    });
    return { outcome: 'failed', health };
  }

  if (health.qualityRating === 'RED') {
    void sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'whatsapp-health-check',
      title: 'WhatsApp — דירוג האיכות של המספר ירד ל-RED',
      detail: 'Meta עלולה להגביל שליחות. בדקו את התבניות ואת קצב הפניות.',
      fields: {
        quality: health.qualityRating,
        // The business number, which is not PII — it is printed on the website.
        number: health.displayPhoneNumber ?? 'unknown',
      },
    });
    return { outcome: 'degraded', health };
  }

  return { outcome: 'ok', health };
}
