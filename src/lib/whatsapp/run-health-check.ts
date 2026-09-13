import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';

import { getAppUrl } from '@/lib/url';

import { checkWhatsAppHealth, type WhatsAppHealth } from './health';
import {
  getAppSubscriptions,
  readWhatsAppSubscription,
  subscribeWhatsAppWebhook,
  WHATSAPP_WEBHOOK_FIELDS,
} from './subscriptions';

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
//  5. IT NOW ALSO CHECKS THAT META WILL ACTUALLY DELIVER ANYTHING — see below.
//     A healthy token and a delivered webhook are different claims, and until
//     2026-09-13 only the first was ever asked.
export type HealthCheckOutcome = 'ok' | 'skipped' | 'degraded' | 'failed';

export interface HealthCheckSummary {
  outcome: HealthCheckOutcome;
  /** Present when the probe ran; null when there was nothing configured to probe. */
  health: WhatsAppHealth | null;
}

/**
 * Is the app still subscribed to WhatsApp webhooks — and if not, put it back.
 *
 * ⚠️ THE OUTAGE THIS EXISTS FOR ALREADY HAPPENED. The `whatsapp_business_account`
 * subscription vanished and Meta delivered nothing for five days: no button-RSVP,
 * no guest reply, no WhatsApp import, no workflow. The probe below stayed green
 * throughout, because the token and the phone-number node were fine the whole time.
 *
 * IT REPAIRS, and that is a deliberate step past "alert only". The repair is a
 * POST that re-asserts configuration we already own — idempotent by Meta's own
 * documentation, no data touched, no message sent, nothing spent. Weighed against
 * a total inbound outage that nothing else can see, waiting for a human to read an
 * alert is the worse default.
 *
 * THREE GUARDS, so it stays a repair and not a loop:
 *   - ONE attempt per run. It never retries inside a tick; the next hour tries again.
 *   - It alerts on EVERY repair, success or failure. A self-heal nobody is told
 *     about is its own kind of invisible, and the disappearance itself is a fact
 *     someone needs to see — it means something removed it.
 *   - Missing app secret / verify token / app id → alert, no attempt. Guessing at
 *     a verify token would break the callback verification that is working today.
 *
 * Never throws: this is a subordinate check inside a check that must not take the
 * worker down.
 */
async function checkWebhookSubscription(config: {
  appSecret: string | null;
  verifyToken: string | null;
}): Promise<void> {
  const appId = process.env.META_APP_ID_WA?.trim();
  if (!appId || !config.appSecret) {
    // Not a fault to page about hourly — the same rule as "not configured"
    // above. Without an app token the subscription simply cannot be read.
    return;
  }

  let state: ReturnType<typeof readWhatsAppSubscription>;
  try {
    state = readWhatsAppSubscription(await getAppSubscriptions({ appId, appSecret: config.appSecret }));
  } catch {
    // Could not ASK. Silent by design: Meta being unreachable for one tick says
    // nothing about the subscription, and the send-path probe above already
    // alerts when Meta is genuinely unavailable.
    return;
  }

  if (state.kind === 'ok') return;

  const describe =
    state.kind === 'absent'
      ? 'המנוי ל-whatsapp_business_account אינו קיים — Meta אינה שולחת הודעות נכנסות כלל.'
      : state.kind === 'inactive'
        ? 'המנוי ל-whatsapp_business_account מסומן כלא פעיל אצל Meta.'
        : `למנוי חסרים שדות: ${state.missing.join(', ')}.`;

  if (!config.verifyToken) {
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'whatsapp-health-check',
      title: 'WhatsApp — אין קליטה של הודעות נכנסות, ואי אפשר לתקן אוטומטית',
      detail: `${describe} לא נשמר verify token, ולכן אי אפשר לרשום מחדש. השלימו אותו ב-/admin/integrations/meta-whatsapp.`,
      fields: { state: state.kind },
    });
    return;
  }

  try {
    await subscribeWhatsAppWebhook({
      appId,
      appSecret: config.appSecret,
      callbackUrl: await getAppUrl('/api/webhooks/whatsapp'),
      verifyToken: config.verifyToken,
    });
    void sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'whatsapp-health-check',
      title: 'WhatsApp — מנוי ה-webhook נעלם ונרשם מחדש אוטומטית',
      // The disappearance is the story, not the fix: something removed it, and
      // between the removal and this tick inbound messages were lost for good.
      detail: `${describe} נרשם מחדש עם השדות ${WHATSAPP_WEBHOOK_FIELDS.join(', ')}. הודעות שנשלחו בינתיים אבדו — בדקו מה הסיר את המנוי.`,
      fields: { state: state.kind, repaired: 'true' },
    });
  } catch (err) {
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'whatsapp-health-check',
      title: 'WhatsApp — אין קליטה של הודעות נכנסות, והרישום מחדש נכשל',
      detail: `${describe} ${err instanceof Error ? err.message : 'שגיאה לא ידועה'}`,
      fields: { state: state.kind, repaired: 'false' },
    });
  }
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

  // BEFORE the send-path probe, and independent of it: the probe can be perfectly
  // green while nothing arrives, which is exactly what happened for five days.
  await checkWebhookSubscription({
    appSecret: config.appSecret,
    verifyToken: config.verifyToken,
  });

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
