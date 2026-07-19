import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { evaluateBalanceAlert } from '@/lib/data/voximplant-balance';
import { getVoximplantBalancePullConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import { normalizeAccountInfo } from '@/lib/validation/vox-payloads';

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
