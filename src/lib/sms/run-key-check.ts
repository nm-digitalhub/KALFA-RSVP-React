import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';

import { getAuthKey, type ExtraKeyHealth } from './extra-client';
import { readSmsSettings } from './sender';

// The scheduled half of the ExtrA key check. One read-only GET a day, no message
// sent, nothing charged.
//
// ⚠️ THIS IS A DEADLINE MONITOR, WHICH IS A DIFFERENT JOB FROM A HEALTH CHECK.
// The WhatsApp and email checks answer "is it working now". This one mostly answers
// "for how much longer" — the live key was created 2025-10-27 and expires
// 2027-10-27 (MEASURED). Nothing else in this system watches that date, and the day
// it passes, every OTP, cancellation SMS, callback-scheduling message and sales
// signup link stops at once, with a provider error nobody is watching for.
//
// TWO THRESHOLDS, DELIBERATELY DIFFERENT:
//   • the CARD turns amber at 60 days — early, so whoever sees the panel can plan;
//   • the ALERT fires at 30 days — late, so Slack is not nagged for two months about
//     a date nobody can act on yet.
// A single threshold would have to be either a useless warning or a two-month nag.
export const EXTRA_KEY_ALERT_DAYS = 30;
export const EXTRA_KEY_WARN_DAYS = 60;

export type ExtraKeyOutcome = 'ok' | 'skipped' | 'degraded' | 'failed';

export interface ExtraKeySummary {
  outcome: ExtraKeyOutcome;
  /** Present when the probe ran; null when there was nothing configured to probe. */
  health: ExtraKeyHealth | null;
}

export async function runExtraKeyCheck(): Promise<ExtraKeySummary> {
  const settings = await readSmsSettings();
  // Both non-ok cases are 'skipped', for different reasons: 'unreadable' is a
  // database problem the DB panels already show, and alerting here would send
  // someone to look at the wrong system.
  if (settings.kind !== 'ok') return { outcome: 'skipped', health: null };

  // NOTE: `settings.enabled` is deliberately NOT consulted. A key that expires while
  // the channel is switched off still expires, and discovering it on the day someone
  // switches sending back on is precisely what this monitor exists to prevent.
  const health = await getAuthKey(settings.token);

  if (!health.ok) {
    if (health.kind === 'unreachable') {
      // A provider blip is not a credentials problem, and this runs daily — a single
      // failed reach says nothing. Recorded, not alerted.
      return { outcome: 'degraded', health };
    }
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'extra-key-check',
      title: 'ExtrA — מפתח ה-API אינו תקף',
      detail: health.message,
      // `kind` only. The key never reaches this point by construction — the client
      // drops it from the response and never puts it in a message (extra-client.ts).
      fields: { kind: health.kind },
    });
    return { outcome: 'failed', health };
  }

  const days = health.daysToExpiry;
  if (days !== null && days <= EXTRA_KEY_ALERT_DAYS) {
    const expired = days < 0;
    void sendSlackAlert({
      level: expired ? 'error' : 'warn',
      category: 'send_health',
      source: 'extra-key-check',
      title: expired
        ? 'ExtrA — מפתח ה-API פג'
        : `ExtrA — מפתח ה-API פג בעוד ${days} ימים`,
      detail:
        'חידוש מתבצע בפורטל ExtrA (/my/api/) ואז עדכון השדה ב-/admin/integrations/extra-sms. בפקיעה נעצרות כל שליחות ה-SMS: OTP, ביטול אירוע, תזמון חזרה וקישור הרשמה.',
      fields: { days_to_expiry: String(days), expires: health.expireAt ?? 'unknown' },
    });
    return { outcome: expired ? 'failed' : 'degraded', health };
  }

  return { outcome: 'ok', health };
}
