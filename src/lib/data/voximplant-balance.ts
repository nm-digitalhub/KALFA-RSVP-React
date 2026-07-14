import 'server-only';

import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import { sendSlackAlert } from '@/lib/alerts/slack';

// H2 — Voximplant balance-alert cron (worker/main.ts, every 30m). Read-only:
// polls GetAccountInfo and Slack-alerts when the account balance dips below the
// admin-configured reserve (calls blocked) or low-balance threshold (warning).
//
// Fail-safe by construction, exactly like the auto-thankyou sweep idiom:
//   - dark-safe: no polling at all while VOXIMPLANT_LIVE_CALLS is off, and a
//     no-op when the channel is not yet configured (getVoximplantConfig null);
//   - NEVER throws — a transient GetAccountInfo transport failure is swallowed
//     (the next 30-minute tick retries); throwing here would fail the pg-boss
//     job and trigger guardedWorker's error alert for a benign blip;
//   - NEVER dials — this only reads account info, it does not place a call;
//   - PII-free Slack payloads: balance/threshold numbers only, no guest data.
export async function runBalanceCheck(): Promise<void> {
  const cfg = await getVoximplantConfig();
  // dark-safe: no polling while the channel is off (config missing or the
  // effective live gate — admin toggle + env override — is disabled).
  if (!cfg || !cfg.liveCallsEnabled) return;

  let balance: number;
  try {
    balance = (await getAccountInfo(cfg.auth, 10_000)).result.balance;
  } catch {
    return; // transient — next tick retries; never throw (would fail the tick)
  }

  if (balance < cfg.minCallReserve) {
    void sendSlackAlert({
      level: 'error',
      category: 'send_health',
      source: 'voximplant-balance',
      title: 'Voximplant balance below reserve — calls blocked',
      detail: `balance $${balance.toFixed(2)} < reserve $${cfg.minCallReserve}`,
      fields: { balance, reserve: cfg.minCallReserve },
    });
  } else if (balance < cfg.lowBalanceThreshold) {
    void sendSlackAlert({
      level: 'warn',
      category: 'send_health',
      source: 'voximplant-balance',
      title: 'Voximplant balance low',
      detail: `balance $${balance.toFixed(2)}`,
      fields: { balance, threshold: cfg.lowBalanceThreshold },
    });
  }
}
