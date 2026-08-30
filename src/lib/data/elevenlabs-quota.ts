import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  getElevenLabsApiKeyWithSource,
  getElevenLabsQuotaResult,
  type ElevenFailure,
  type ElevenLabsQuota,
  type ElevenResult,
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
// for what counts as a quota alert. A failed read from a CONFIGURED key is
// surfaced LOUDLY (not silently skipped), so a cleared or broken key can never
// turn quota monitoring into a silent no-op.
const QUOTA_WARN_RATIO = 0.8;
const QUOTA_ERROR_RATIO = 0.95;

export interface QuotaAlertDecision {
  level: 'error' | 'warn';
  title: string;
  detail: string;
  fields: Record<string, number | string>;
}

/**
 * Turn a real failure into an operator-facing message that names the ACTUAL
 * cause and the action that follows from it.
 *
 * This replaces a single hardcoded string that blamed a missing `user_read`
 * permission for every possible failure. MEASURED 2026-08-26: a 9.1s response
 * (vs. 2–5s for six days prior) tripped the fetch timeout, and the operator was
 * told to re-issue an API key that was in fact working perfectly — verified by
 * calling /v1/user/subscription with that exact key and getting HTTP 200 with
 * character_count=65255, character_limit=363000, tier=creator.
 *
 * Status-code meanings verified live 2026-08-26 against
 * /docs/help-center/technical/api-error-code-400-or-401.md and
 * /docs/help-center/technical/api-error-code-429.md.
 */
function describeFailure(failure: ElevenFailure): { detail: string; fields: Record<string, string | number> } {
  switch (failure.kind) {
    case 'timeout':
      return {
        detail:
          `הקריאה ל-/v1/user/subscription חרגה מ-${failure.timeoutMs / 1000} שניות ובוטלה. ` +
          'זו כמעט תמיד איטיות זמנית בצד ElevenLabs — המפתח והמכסה תקינים. ' +
          'הבדיקה הבאה (בעוד 6 שעות) תנסה שוב; אם זה חוזר, יש לבדוק קישוריות יוצאת מהשרת.',
        fields: { reason: 'timeout', timeoutMs: failure.timeoutMs },
      };
    case 'network':
      return {
        detail:
          `הקריאה ל-/v1/user/subscription נכשלה ברמת הרשת: ${failure.message}. ` +
          'לא מדובר בבעיית הרשאות — הבקשה לא הגיעה לשרת של ElevenLabs.',
        fields: { reason: 'network' },
      };
    case 'http': {
      const { status, code, message } = failure;
      const observed = `HTTP ${status}${code ? ` (${code})` : ''}${message ? ` — ${message}` : ''}`;
      // 401 invalid_api_key is the ONLY documented signature of a key problem.
      if (status === 401 || status === 403) {
        return {
          detail:
            `${observed}. זו באמת בעיית מפתח: המפתח שגוי, פג, או חסר הרשאה. ` +
            'תיקון: הגדר מפתח תקין ב-app_settings.elevenlabs_api_key (או ELEVENLABS_API_KEY).',
          fields: { reason: 'auth', status, ...(code ? { code } : {}) },
        };
      }
      if (status === 429) {
        return {
          detail:
            `${observed}. חריגה ממגבלת קצב/מקביליות (בתוכנית creator: 5 בקשות במקביל), ` +
            'או system_busy — עומס זמני אצל ElevenLabs שחולף בניסיון חוזר. המפתח תקין.',
          fields: { reason: 'rate_limit', status, ...(code ? { code } : {}) },
        };
      }
      if (status >= 500) {
        return {
          detail: `${observed}. תקלה בצד ElevenLabs, לא בהגדרות שלנו. הבדיקה הבאה תנסה שוב.`,
          fields: { reason: 'upstream_5xx', status, ...(code ? { code } : {}) },
        };
      }
      return {
        detail: `${observed}. יש לבדוק מול התיעוד של ElevenLabs מה משמעות הקוד הזה בנקודת הקצה הזו.`,
        fields: { reason: 'http_error', status, ...(code ? { code } : {}) },
      };
    }
    case 'malformed':
      return {
        detail:
          `התקבלה תשובה תקינה (HTTP 200) אך לא ניתן היה לקרוא ממנה את המכסה: ${failure.message}. ` +
          'זה מצביע על שינוי בחוזה ה-API של ElevenLabs — לא על בעיית מפתח או הרשאות.',
        fields: { reason: 'contract_change' },
      };
  }
}

export function evaluateQuotaAlert(
  result: ElevenResult<ElevenLabsQuota>,
): QuotaAlertDecision | null {
  if (!result.ok) {
    const { detail, fields } = describeFailure(result.failure);
    return {
      level: 'warn',
      title: 'מכסת ElevenLabs לא ניתנת לקריאה',
      detail,
      fields,
    };
  }
  const quota = result.data;
  if (
    quota.characterCount === null ||
    quota.characterLimit === null ||
    quota.characterLimit <= 0
  ) {
    return {
      level: 'warn',
      title: 'מכסת ElevenLabs לא ניתנת לקריאה',
      detail:
        `התקבלה מכסה לא שמישה (character_limit=${quota.characterLimit ?? 'null'}). ` +
        'זה מצביע על שינוי בחוזה ה-API של ElevenLabs — לא על בעיית מפתח או הרשאות.',
      fields: { reason: 'contract_change' },
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

  // getElevenLabsQuotaResult reports transport failures as data rather than
  // throwing, so there is nothing routine left to swallow here. The catch stays
  // only for a genuinely unexpected bug in our own code — and it now REPORTS
  // that instead of returning silently, which is how a broken quota monitor
  // could previously look identical to a healthy one.
  let result: ElevenResult<ElevenLabsQuota>;
  try {
    result = await getElevenLabsQuotaResult(key);
  } catch (err) {
    result = {
      ok: false,
      failure: {
        kind: 'network',
        message: `unexpected error in the quota reader: ${err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'}`,
      },
    };
  }

  const decision = evaluateQuotaAlert(result);
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
