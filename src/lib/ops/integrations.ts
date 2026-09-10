import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { envAllowsLiveCalls } from '@/lib/data/voximplant-config';
import { getGa4ConfigStatus } from '@/lib/analytics/ga4-config';
import type { JobHealthRow } from './db-health';

// Provider status for the admin Integrations panel. Makes ZERO live calls to any
// third party — "configured" is presence in app_settings, and "last checked" comes
// from data the Jobs panel already fetched (pg-boss's own last_completed_on for the
// queue that pings that provider), never a fresh network round-trip. A provider with
// no matching cron queue gets an explicit "no health check available" rather than a
// fabricated value.
//
// ⚠️ IT ALSO READS NO CREDENTIAL, AND THAT IS THE POINT OF THE RPC BELOW.
// Until 2026-09-10 this file called five resolvers that each return the real secret —
// getWhatsAppConfig (access token + app secret), getVoximplantConfig (the
// service-account JSON), getElevenLabsApiKeyWithSource (the key), getAlertsConfig
// (the Slack bot token), getSumitServerConfig (the api key) — and used each one only
// to test it for null. Five secrets through service-role, on every page load, to
// render five ✔/✘ marks. Nothing leaked: the panel prints booleans. They were simply
// in process memory for no reason. `integrations_configured_flags()` answers the same
// question in SQL and returns booleans only.
//
// Exchange (IONOS EWS) is NOT here — it has its own dedicated panel showing EVERY
// admin's connection, while listMyExchangeConnections() returns only the caller's
// own. A row here could never be more than the weaker of the two. Anything composing
// a Microsoft card must read the dedicated source, not this list.

export interface IntegrationStatus {
  key: string;
  label: string;
  /** Credentials present. Independent of the switch — see `enabled`. */
  configured: boolean;
  /**
   * The provider's own on/off switch.
   *
   * Separate from `configured` because conflating them produced a real display bug:
   * ExtrA's status came from getSmsSender(), which throws when
   * `!sms_enabled || !token || !sender`, so turning the SMS switch OFF made the panel
   * report ExtrA as NOT CONFIGURED rather than "configured, switched off".
   *
   * ElevenLabs and GA4 have no switch column at all; for them this mirrors
   * `configured`, which is the honest answer — inventing a switch would be worse than
   * saying there is none.
   */
  enabled: boolean;
  lastCheckedAt: string | null;
  /**
   * True ONLY when a scheduled job actually feeds `lastCheckedAt`. It gates whether
   * the card prints "נבדק לאחרונה", so setting it without a queue prints "טרם רץ"
   * forever — a claim that a scheduled check exists and has never run. A manual test
   * button is not a health check; say so in `note` instead.
   */
  healthCheckAvailable: boolean;
  note?: string;
}

export interface IntegrationsConfiguredFlags {
  whatsapp_configured: boolean;
  whatsapp_enabled: boolean;
  voximplant_configured: boolean;
  voximplant_enabled: boolean;
  extra_sms_configured: boolean;
  extra_sms_enabled: boolean;
  email_configured: boolean;
  email_enabled: boolean;
  sumit_configured: boolean;
  sumit_enabled: boolean;
  slack_configured: boolean;
  slack_enabled: boolean;
  elevenlabs_configured: boolean;
}

/**
 * Presence + switch state for every provider whose credentials live in app_settings.
 * Booleans only — no credential crosses the process boundary.
 *
 * Uses the COOKIE client on purpose: the function is SECURITY DEFINER (it has to be,
 * to read app_settings past its RLS) and gates on is_platform_staff() internally,
 * which needs the CALLER's auth.uid(). Service-role would arrive with no uid and be
 * refused.
 *
 * Returns null on refusal or error — never a row of `false`. The distinction is
 * load-bearing: "we could not ask" and "nothing is configured" look identical once
 * flattened into booleans, and only one of them should be rendered as a status.
 */
export async function getIntegrationsConfiguredFlags(): Promise<IntegrationsConfiguredFlags | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('integrations_configured_flags');
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    return (row as IntegrationsConfiguredFlags | undefined) ?? null;
  } catch {
    return null;
  }
}

function lastCompletedFor(jobHealth: JobHealthRow[], queueName: string): string | null {
  return jobHealth.find((r) => r.queueName === queueName)?.lastCompletedOn ?? null;
}

export async function getIntegrationsStatus(jobHealth: JobHealthRow[]): Promise<IntegrationStatus[]> {
  const flags = await getIntegrationsConfiguredFlags();
  if (!flags) {
    // Fail closed AND visibly. The caller (debug/page.tsx) catches this and renders
    // UnavailableAlert with the message; a list of `configured: false` would instead
    // read as a confident "every provider is unconfigured".
    throw new Error('לא ניתן לקרוא את מצב האינטגרציות (נדרשת הרשאת צוות)');
  }

  // The three answers SQL cannot give, resolved here rather than half-answered there.
  const elevenLabsEnvKey = (process.env.ELEVENLABS_API_KEY ?? '').trim() !== '';
  const ga4 = await getGa4ConfigStatus();

  return [
    {
      key: 'elevenlabs',
      label: 'ElevenLabs',
      // The column is a fallback for the env var, not the only source.
      configured: flags.elevenlabs_configured || elevenLabsEnvKey,
      enabled: flags.elevenlabs_configured || elevenLabsEnvKey,
      lastCheckedAt: lastCompletedFor(jobHealth, 'elevenlabs-quota-check'),
      healthCheckAvailable: true,
      note: 'אין מתג הפעלה — מוגדר = פעיל',
    },
    {
      key: 'voximplant',
      label: 'Voximplant',
      configured: flags.voximplant_configured,
      // VOXIMPLANT_LIVE_CALLS='false' is an ops kill switch that overrides the admin
      // toggle and no click in the panel can undo — so it belongs in the AND, not as
      // a footnote (see envAllowsLiveCalls' own comment).
      enabled: flags.voximplant_enabled && envAllowsLiveCalls(),
      lastCheckedAt: lastCompletedFor(jobHealth, 'voximplant-balance-check'),
      healthCheckAvailable: true,
    },
    {
      key: 'slack',
      label: 'Slack (התראות תפעול)',
      configured: flags.slack_configured,
      enabled: flags.slack_enabled,
      lastCheckedAt: null,
      // `false`, and the two fields have to agree. Slack has NO scheduled queue —
      // only the manual "send a test" button — so with `true` the card printed
      // "נבדק לאחרונה: טרם רץ" directly under a note saying the check is manual only.
      // Two contradictory sentences on one card, and the "טרם רץ" one implied a
      // scheduled job existed and had never fired. MEASURED on the live panel
      // 2026-09-10. The invariant is now asserted in integrations.test.ts.
      healthCheckAvailable: false,
      note: 'בדיקה ידנית בלבד — כפתור "שליחת בדיקה" ב-/admin/alerts',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp (Meta Cloud API)',
      configured: flags.whatsapp_configured,
      // The GLOBAL outreach master switch, not a WhatsApp-only one — the same column
      // that gates every outbound channel.
      enabled: flags.whatsapp_enabled,
      // Was `false` with the note "אין בדיקת בריאות זמינה — send-only" until
      // 2026-09-10. "Send-only" described how we MESSAGE GUESTS, and was mistaken for
      // a statement about whether the integration can be examined at all: Meta exposes
      // the phone-number node and the WABA's number list, and reading both exercises
      // the exact token and ids the send path needs. No message is sent.
      lastCheckedAt: lastCompletedFor(jobHealth, 'whatsapp-health-check'),
      healthCheckAvailable: true,
    },
    {
      key: 'sumit',
      label: 'SUMIT / OfficeGuy',
      configured: flags.sumit_configured,
      enabled: flags.sumit_enabled,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'אין בדיקת בריאות זמינה — בדיקה ידנית ב-/admin/sumit-test',
    },
    {
      key: 'extra-sms',
      label: 'ExtrA SMS',
      configured: flags.extra_sms_configured,
      enabled: flags.extra_sms_enabled,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'אין בדיקת בריאות זמינה — send-only',
    },
    {
      key: 'resend-email',
      label: 'דואר יוצא',
      // smtp_from is the one field both transports need. WHICH transport is active is
      // an env decision (EMAIL_PROVIDER) that belongs to the page rendering it, not to
      // a presence check.
      configured: flags.email_configured,
      enabled: flags.email_enabled,
      // Was `false` with the note "אין בדיקת בריאות זמינה" until 2026-09-10. Nobody had
      // looked: Resend exposes its domain registry read-only, and reading it exercises
      // the API key AND the DNS state of the domain the From header actually uses. The
      // SMTP fallback has nodemailer's verify() — connect + AUTH, no message composed.
      // Worth it not because the failure is silent — Resend 403s a send from an
      // unverified domain — but because this transport is event-driven and low volume:
      // that 403 surfaces at the NEXT customer signature, days later. The DKIM-pulled-
      // while-still-marked-verified window IS silent. See src/lib/email/health.ts.
      lastCheckedAt: lastCompletedFor(jobHealth, 'email-health-check'),
      healthCheckAvailable: true,
    },
    {
      key: 'ga4',
      label: 'Google Analytics 4',
      configured: ga4.ok,
      enabled: ga4.ok,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'הגדרה מ-env בלבד; אין מתג הפעלה',
    },
  ];
}
