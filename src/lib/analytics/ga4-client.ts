import 'server-only';

import { BetaAnalyticsDataClient } from '@google-analytics/data';

// Lazy module-level singleton. No explicit credentials — ADC reads
// GOOGLE_APPLICATION_CREDENTIALS itself. fallback:'rest' keeps gRPC (and its
// bundling problems) entirely out of the runtime.
//
// This file is deliberately the ONLY one that imports the SDK — the fleet
// CLI's analytics-summary verb reads config through ga4-config.ts instead,
// via createRequire, to keep @google-analytics/data's unconditional gRPC
// require chain out of dist/fleet-agent-cli.cjs (see scripts/fleet-agent-cli.ts).
let client: BetaAnalyticsDataClient | null = null;

export function getGa4Client(): BetaAnalyticsDataClient {
  client ??= new BetaAnalyticsDataClient({ fallback: 'rest' });
  return client;
}
