import 'server-only';

import { getElevenLabsApiKeyWithSource } from '@/lib/data/elevenlabs-status';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { getSumitServerConfig } from '@/lib/data/payments';
import { getGa4ConfigStatus } from '@/lib/analytics/ga4-config';
import { getSmsSender, SmsConfigError } from '@/lib/sms/sender';
import { getAlertsConfig } from '@/lib/data/alerts-config';
import type { JobHealthRow } from './db-health';

// Debug page's Integrations panel. Deliberately makes ZERO live calls to any
// third-party provider — every "configured?" check below only reads
// app_settings / env (the same cheap presence checks getInfraConfigStatus
// already uses), and "last checked" is derived from data the Jobs panel is
// already fetching (pg-boss's own last_completed_on for the queue that pings
// that provider), never a fresh network round-trip. Providers with no
// matching cron queue and no stored status get an explicit "no health check
// available" rather than a fabricated value.
//
// Exchange (IONOS EWS) is NOT here — it has its own dedicated panel
// (ExchangePanel, _panels.tsx) showing every admin's connection, not just the
// viewing owner's own. A one-line entry here would only ever have shown
// listMyExchangeConnections()'s result (the CALLER's own mailbox), which is
// strictly less than what the dedicated panel already covers.

export interface IntegrationStatus {
  key: string;
  label: string;
  configured: boolean;
  lastCheckedAt: string | null;
  healthCheckAvailable: boolean;
  note?: string;
}

function lastCompletedFor(jobHealth: JobHealthRow[], queueName: string): string | null {
  return jobHealth.find((r) => r.queueName === queueName)?.lastCompletedOn ?? null;
}

export async function getIntegrationsStatus(jobHealth: JobHealthRow[]): Promise<IntegrationStatus[]> {
  const [elKey, voxConfig, waConfig, sumitConfig, ga4Status, smsConfigured, alertsConfig] =
    await Promise.all([
      getElevenLabsApiKeyWithSource(),
      getVoximplantConfig(),
      getWhatsAppConfig(),
      getSumitServerConfig(),
      getGa4ConfigStatus(),
      getSmsSender()
        .then(() => true)
        .catch((err) => {
          if (err instanceof SmsConfigError) return false;
          return false; // any other failure — treat as "not confirmed configured", never throw
        }),
      getAlertsConfig(),
    ]);

  return [
    {
      key: 'elevenlabs',
      label: 'ElevenLabs',
      configured: elKey.key !== null,
      lastCheckedAt: lastCompletedFor(jobHealth, 'elevenlabs-quota-check'),
      healthCheckAvailable: true,
    },
    {
      key: 'voximplant',
      label: 'Voximplant',
      configured: voxConfig !== null,
      lastCheckedAt: lastCompletedFor(jobHealth, 'voximplant-balance-check'),
      healthCheckAvailable: true,
    },
    {
      key: 'slack',
      label: 'Slack (התראות תפעול)',
      configured: alertsConfig.botToken !== null && alertsConfig.channelId !== null,
      lastCheckedAt: null,
      healthCheckAvailable: true,
      note: 'בדיקה ידנית בלבד — כפתור "שליחת בדיקה" ב-/admin/alerts',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp (Meta Cloud API)',
      configured: waConfig !== null,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'אין בדיקת בריאות זמינה — send-only',
    },
    {
      key: 'sumit',
      label: 'SUMIT / OfficeGuy',
      configured: sumitConfig !== null,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'אין בדיקת בריאות זמינה — בדיקה ידנית ב-/admin/sumit-test',
    },
    {
      key: 'extra-sms',
      label: 'ExtrA SMS',
      configured: smsConfigured,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'אין בדיקת בריאות זמינה — send-only',
    },
    {
      key: 'ga4',
      label: 'Google Analytics 4',
      configured: ga4Status.ok,
      lastCheckedAt: null,
      healthCheckAvailable: false,
      note: 'אין בדיקת בריאות זמינה',
    },
  ];
}
