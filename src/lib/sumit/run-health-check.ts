import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { getSumitServerConfig } from '@/lib/data/payments';

import { checkSumitHealth, type SumitHealth } from './health';

// The scheduled half of the SUMIT check. One read-only POST a day; nothing charged,
// no document created, no customer data read.
//
// WHY IT IS WORTH A QUEUE AT ALL. Unlike the ExtrA key beside it, SUMIT hands out no
// expiry date to count down — this is a plain liveness check. It earns its place on
// consequence instead: if the credential pair stops resolving, every charge stops.
// The way that surfaces today is a customer at a payment form, because the close-charge
// path only runs when a campaign closes. A daily probe turns that into a Slack line.
//
// ONLY a rejected credential pair alerts. A technical error on SUMIT's side and an
// unreachable network both say nothing about our configuration, and paging about them
// would train someone to re-check a key that was never wrong.
export type SumitHealthOutcome = 'ok' | 'skipped' | 'degraded' | 'failed';

export interface SumitHealthSummary {
  outcome: SumitHealthOutcome;
  health: SumitHealth | null;
}

export async function runSumitHealthCheck(): Promise<SumitHealthSummary> {
  const config = await getSumitServerConfig();
  // No credentials stored is a valid state for an install that does not take payments.
  if (!config) return { outcome: 'skipped', health: null };

  const health = await checkSumitHealth({
    companyId: String(config.companyId),
    apiKey: config.apiKey,
  });

  if (health.ok) return { outcome: 'ok', health };

  if (health.kind !== 'credentials_rejected') {
    // provider_error, unreachable, unexpected_response — recorded, never alerted.
    return { outcome: 'degraded', health };
  }

  void sendSlackAlert({
    level: 'error',
    category: 'send_health',
    source: 'sumit-health-check',
    title: 'SUMIT — פרטי ההתחברות נדחו',
    detail:
      'סליקה מושבתת בפועל עד לתיקון: חיוב סגירת קמפיין, תפיסת מסגרת וזיכויים כולם עוברים דרך אותם פרטים. עדכון ב-/admin/integrations/sumit.',
    // `kind` only. The API key never reaches this point by construction (health.ts).
    fields: { kind: health.kind },
  });
  return { outcome: 'failed', health };
}
