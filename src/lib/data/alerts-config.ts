import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Server-side reader of the admin-managed Slack ops-alerting config (app_settings,
// a singleton row). Read via the SERVICE-ROLE client so it works in BOTH the
// Next.js server and the esbuild worker bundle (which aliases `server-only` to an
// empty stub) — mirrors getWhatsAppConfig / getOutreachEnabled in
// src/lib/data/outreach-config.ts.
//
// FAIL-SAFE: any read error resolves to a fully-DISABLED config (alerts off),
// never throws. The bot token NEVER leaves the server and is never logged.
//
// SHORT IN-PROCESS CACHE: sendSlackAlert runs in hot error paths, so we must not
// hit the DB on every alert. Successful reads are cached for CACHE_TTL_MS; a
// failed read is NOT cached (so the next call can recover). Per-process — the web
// and worker keep independent caches, acceptable for best-effort ops alerting.

// Alert categories, each gated by its own admin toggle. NOTE: only `errors`
// (instrumentation + worker) and `send_health` (whatsapp/sms/sumit provider
// failures) have emit sites in this phase. `campaign_billing` and `security`
// toggles exist for a later phase — no code currently emits those categories.
export type AlertCategory = 'errors' | 'campaign_billing' | 'send_health' | 'security';

export interface AlertsConfig {
  enabled: boolean;
  botToken: string | null;
  channelId: string | null;
  categories: {
    errors: boolean;
    campaignBilling: boolean;
    sendHealth: boolean;
    security: boolean;
  };
}

const DISABLED: AlertsConfig = {
  enabled: false,
  botToken: null,
  channelId: null,
  categories: {
    errors: false,
    campaignBilling: false,
    sendHealth: false,
    security: false,
  },
};

const CACHE_TTL_MS = 20_000;

let cache: { value: AlertsConfig; at: number } | null = null;

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Read the Slack ops-alerting config from app_settings (service-role, cached).
 * Never throws; a missing/failed read resolves to a fully-disabled config.
 */
export async function getAlertsConfig(): Promise<AlertsConfig> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return DISABLED; // do NOT cache — allow recovery.

    const row = data as Record<string, unknown>;
    const value: AlertsConfig = {
      enabled: row.slack_alerts_enabled === true,
      botToken: nonEmptyString(row.slack_bot_token),
      channelId: nonEmptyString(row.slack_alert_channel_id),
      categories: {
        errors: row.slack_alert_errors === true,
        campaignBilling: row.slack_alert_campaign_billing === true,
        sendHealth: row.slack_alert_send_health === true,
        security: row.slack_alert_security === true,
      },
    };
    cache = { value, at: now };
    return value;
  } catch {
    return DISABLED; // fail-safe, uncached.
  }
}

/** Whether the given category's per-toggle is on in the resolved config. */
export function categoryEnabled(config: AlertsConfig, category: AlertCategory): boolean {
  switch (category) {
    case 'errors':
      return config.categories.errors;
    case 'campaign_billing':
      return config.categories.campaignBilling;
    case 'send_health':
      return config.categories.sendHealth;
    case 'security':
      return config.categories.security;
  }
}

/** Test-only: clear the in-process cache so each test starts clean. */
export function __resetAlertsConfigCacheForTests(): void {
  cache = null;
}
