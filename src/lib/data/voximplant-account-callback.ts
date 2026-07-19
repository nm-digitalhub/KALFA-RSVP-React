import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert, type SlackAlertLevel } from '@/lib/alerts/slack';
import type { AlertCategory } from '@/lib/data/alerts-config';
import { evaluateBalanceAlert } from '@/lib/data/voximplant-balance';
import { getVoximplantBalancePullConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import {
  normalizeAccountInfo,
  type NormalizedAccountCallbackEvent,
} from '@/lib/validation/vox-payloads';

// B5 route-side DAL (service-role, request-free): the public account-callback
// route treats any authenticated POST as an UNTRUSTED POKE, then pulls the
// verified balance itself and alerts from that. Hash verification of the
// provider's MD5 is impossible (needs the legacy api_key we don't hold), so
// identity is our own opaque URL token — stored ONLY as a SHA-256 hash.

// The stored SHA-256 hex of the account-callback token (null until wired).
// Read service-side; the raw token is never persisted anywhere.
export async function getAccountCallbackTokenHash(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('voximplant_account_callback_token_hash')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const h = (data as Record<string, unknown>).voximplant_account_callback_token_hash;
    return typeof h === 'string' && h.length > 0 ? h : null;
  } catch {
    return null;
  }
}

// Record that a (verified) callback poke was received. Best-effort — a stamp
// failure must not change the 200 the route returns.
export async function stampBalanceCallbackReceived(): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from('app_settings')
      .update({ voximplant_balance_callback_at: new Date().toISOString() } as never)
      .eq('id', true);
  } catch {
    /* best-effort */
  }
}

// The verified pull: read the live balance ourselves and alert via the SAME
// threshold logic the H2 cron uses (evaluateBalanceAlert — shared, not
// duplicated). `source` differs from the cron so slack.ts's level|title|source
// dedup does not swallow this against a recent cron alert. Never throws.
export async function runVerifiedBalancePull(): Promise<void> {
  const cfg = await getVoximplantBalancePullConfig();
  if (!cfg) return; // channel not configured — nothing to verify
  let info;
  try {
    info = await getAccountInfo(cfg.auth, 10_000, { returnLiveBalance: true });
  } catch {
    return; // transient — the cron still polls every 30m
  }
  const balance = normalizeAccountInfo(info).balance;
  const decision = evaluateBalanceAlert({
    balance,
    minCallReserve: cfg.minCallReserve,
    lowBalanceThreshold: cfg.lowBalanceThreshold,
  });
  if (decision) {
    void sendSlackAlert({
      level: decision.level,
      category: 'send_health',
      source: 'voximplant-account-callback',
      title: decision.title,
      detail: decision.detail,
      fields: decision.fields,
    });
  }
}

// ---------------------------------------------------------------------------
// Type-specific ops alerts (plan item 1) — JSFail, expiring CallerID/agreement,
// card/charge issues → Slack. Complements the verified balance pull above.
// ---------------------------------------------------------------------------

// Routing + severity for the callback types KALFA acts on, keyed by the envelope
// `type`. Types NOT in this map are intentionally silent:
//   - `min_balance` is already covered by the verified balance pull (a second
//     alert here would double-fire on every low-balance callback);
//   - certificates + SIP-registration are Apple-VOIP / 3rd-party-SIP concerns
//     that do not apply to KALFA's PSTN-only outbound, so they are info-only;
//   - administrative/unknown kinds (payments, document status, …) are counted
//     for telemetry by the normalizer but are not ops-actionable.
interface CallbackAlertRule {
  category: AlertCategory;
  level: SlackAlertLevel;
  title: string;
}

const CALLBACK_ALERT_RULES: Record<string, CallbackAlertRule> = {
  js_fail: { category: 'errors', level: 'error', title: 'שגיאת JS בתרחיש Voximplant' },
  expiring_callerid: { category: 'send_health', level: 'warn', title: 'אימות Caller ID של Voximplant פג בקרוב' },
  card_payment_failed: { category: 'campaign_billing', level: 'error', title: 'תשלום כרטיס ב-Voximplant נכשל' },
  card_expired: { category: 'campaign_billing', level: 'warn', title: 'כרטיס התשלום ב-Voximplant פג' },
  card_expires_in_month: { category: 'campaign_billing', level: 'info', title: 'כרטיס התשלום ב-Voximplant יפוג החודש' },
  next_charge_alert: { category: 'campaign_billing', level: 'warn', title: 'חיוב מתקרב ב-Voximplant עם יתרה חסרה' },
  expiring_agreement: { category: 'send_health', level: 'warn', title: 'הסכם החשבון ב-Voximplant פג בקרוב' },
  expired_agreement: { category: 'send_health', level: 'error', title: 'הסכם החשבון ב-Voximplant פג' },
  call_history_report: { category: 'send_health', level: 'info', title: 'דוח היסטוריית שיחות מוכן ב-Voximplant' },
  // Not applicable to KALFA (Apple VOIP / 3rd-party SIP) — info/count-only.
  expiring_certificates: { category: 'send_health', level: 'info', title: 'תעודת Voximplant פגה בקרוב (לא בשימוש KALFA)' },
  expired_certificates: { category: 'send_health', level: 'info', title: 'תעודת Voximplant פגה (לא בשימוש KALFA)' },
  sip_registration_fail: { category: 'send_health', level: 'info', title: 'כשל רישום SIP ב-Voximplant (לא בשימוש KALFA)' },
};

// Whole days from `now` (ms) until a "YYYY-MM-DD" (or ISO) date, or null.
function daysUntil(value: string | number | undefined, now: number): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / 86_400_000);
}

export interface AccountCallbackAlert {
  level: SlackAlertLevel;
  category: AlertCategory;
  title: string;
  fields: Record<string, string | number>;
}

// Pure decision: map normalized (metadata-only) callback events to ops-alert
// descriptors. Excludes min_balance + unknown types; escalates a couple of
// severities from the detail (near-expiry CallerID, a failed history report).
// `now` is injected so the function stays pure and testable.
export function evaluateCallbackAlerts(
  events: NormalizedAccountCallbackEvent[],
  now: number,
): AccountCallbackAlert[] {
  const out: AccountCallbackAlert[] = [];
  for (const ev of events) {
    const rule = CALLBACK_ALERT_RULES[ev.type];
    if (!rule) continue; // min_balance (handled by the pull) + unknown → silent
    let level = rule.level;
    if (ev.type === 'call_history_report' && ev.detail.success === 'false') level = 'warn';
    if (ev.type === 'expiring_callerid') {
      const days = daysUntil(ev.detail.expiration_date, now);
      if (days !== null && days <= 7) level = 'error'; // the CallerID is our whole outbound identity
    }
    const fields: Record<string, string | number> = { ...ev.detail };
    if (ev.callbackId) fields.callback_id = ev.callbackId;
    out.push({ level, category: rule.category, title: rule.title, fields });
  }
  return out;
}

// IO wrapper: alert Slack for each actionable callback event. Derives from the
// UNTRUSTED body — acceptable here because possession of the secret URL token is
// required to reach this code (the route's constant-time hash gate), these are
// low-severity ops notices, and slack.ts adds dedup + a global rate cap. Unlike
// the balance number, JSFail/expiry signals cannot be cheaply re-verified via a
// separate API, so we surface the token-authenticated poke directly. Never throws
// (sendSlackAlert is fail-safe; the mapping is total).
export async function alertForAccountCallbacks(events: NormalizedAccountCallbackEvent[]): Promise<void> {
  for (const alert of evaluateCallbackAlerts(events, Date.now())) {
    void sendSlackAlert({
      level: alert.level,
      category: alert.category,
      source: 'voximplant-account-callback',
      title: alert.title,
      fields: alert.fields,
    });
  }
}
