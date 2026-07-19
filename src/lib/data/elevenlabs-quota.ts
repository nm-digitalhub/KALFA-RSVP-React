import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  getElevenLabsApiKeyWithSource,
  getElevenLabsQuota,
  type ElevenLabsQuota,
} from '@/lib/data/elevenlabs-status';

// ElevenLabs character-quota alert cron (plan item 3; worker every 6h). Slack-
// alerts when the account's monthly character usage crosses 80% (warn) / 95%
// (error). Structured exactly like the Voximplant balance cron
// (voximplant-balance.ts): a PURE threshold decision + a fail-safe run wrapper
// that reads via the read-only status module and alerts.
//
// Fail-safe by construction:
//   - dark-safe: no key configured → no-op (no alert), so it is inert until an
//     admin sets the ElevenLabs key;
//   - NEVER throws — a transient subscription-fetch failure is swallowed (the
//     next 6-hourly tick retries); throwing would fail the pg-boss job and fire
//     guardedWorker's error alert for a benign blip;
//   - PII-free Slack payloads: character counts + tier + key source only.

// Pure threshold decision, shared with nothing else — the single source of truth
// for what counts as a quota alert. A null/absent usage from a CONFIGURED key is
// surfaced LOUDLY (not silently skipped): the verified cause is a key without the
// `user_read` permission (the env/IaC key lacks it; the DB key has it), so a
// cleared DB key would otherwise turn quota monitoring into a silent no-op.
const QUOTA_WARN_RATIO = 0.8;
const QUOTA_ERROR_RATIO = 0.95;

export interface QuotaAlertDecision {
  level: 'error' | 'warn';
  title: string;
  detail: string;
  fields: Record<string, number | string>;
}

export function evaluateQuotaAlert(quota: ElevenLabsQuota | null): QuotaAlertDecision | null {
  if (
    !quota ||
    quota.characterCount === null ||
    quota.characterLimit === null ||
    quota.characterLimit <= 0
  ) {
    return {
      level: 'warn',
      title: 'מכסת ElevenLabs לא ניתנת לקריאה',
      detail: 'תגובת המנוי חסרה character_count/limit — ייתכן שמפתח ה-API חסר הרשאת user_read',
      fields: {},
    };
  }
  const ratio = quota.characterCount / quota.characterLimit;
  const percent = Math.round(ratio * 100);
  const usage = { used: quota.characterCount, limit: quota.characterLimit, percent };
  if (ratio >= QUOTA_ERROR_RATIO) {
    return {
      level: 'error',
      title: 'מכסת ElevenLabs מעל 95%',
      detail: `נוצלו ${quota.characterCount} מתוך ${quota.characterLimit} תווים (${percent}%)`,
      fields: usage,
    };
  }
  if (ratio >= QUOTA_WARN_RATIO) {
    return {
      level: 'warn',
      title: 'מכסת ElevenLabs מעל 80%',
      detail: `נוצלו ${quota.characterCount} מתוך ${quota.characterLimit} תווים (${percent}%)`,
      fields: usage,
    };
  }
  return null;
}

export async function runElevenLabsQuotaCheck(): Promise<void> {
  const { key, source } = await getElevenLabsApiKeyWithSource();
  if (!key) return; // dark-safe: not configured → nothing to monitor

  let quota: ElevenLabsQuota | null;
  try {
    quota = await getElevenLabsQuota(key);
  } catch {
    return; // transient — the next tick retries; never throw (would fail the tick)
  }

  const decision = evaluateQuotaAlert(quota);
  if (decision) {
    void sendSlackAlert({
      level: decision.level,
      category: 'send_health',
      source: 'elevenlabs-quota',
      title: decision.title,
      detail: decision.detail,
      fields: { ...decision.fields, keySource: source ?? 'none' },
    });
  }
}
