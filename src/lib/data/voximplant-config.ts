import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { VoximplantConfig } from '@/lib/voximplant/client';

// Server-side reader of the admin-managed Voximplant config (app_settings, a
// singleton with ADMIN-ONLY RLS). Fail-safe AND forward-compatible: the columns
// are added by a pending migration, so until they exist `select('*')` simply
// omits them and this resolves to null (fail-closed — the AI-call channel stays
// off). Mirrors getWhatsAppConfig / getSumitServerConfig. Secrets never leave the
// server and are never logged.

export type VoximplantServerConfig = {
  // Management API JWT auth (parsed from the stored service-account JSON) —
  // shaped for src/lib/voximplant/core.ts's VoximplantConfig.
  auth: VoximplantConfig;
  ruleId: string; // OutCall rule id (live: 1494311)
  callerId: string; // purchased/verified Voximplant number ('from')
  callbackSecret: string | null; // ?k= secret on ctx/cb URLs; null until provisioned
  groqApiKey: string | null; // scenario 'gk' (Branch A); null if moved to a Vox-side secret
  lowBalanceThreshold: number; // warn below this ($)
  minCallReserve: number; // do-not-dial below this ($)
  maxConcurrentCalls: number;
  maxCallsPerCampaignHour: number;
  // The EFFECTIVE live-dial gate: the admin DB toggle AND the env not force-off.
  // Still only PERMITS a dial — consent/DNC/balance are enforced separately.
  liveCallsEnabled: boolean;
};

function str(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === 'string' ? (row[key] as string) : '';
}

function num(row: Record<string, unknown>, key: string, fallback: number): number {
  const v = row[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return fallback;
}

// Parse the stored service-account JSON into core.ts's VoximplantConfig shape.
// Returns null if the JSON is absent or missing any required field.
function parseServiceAccount(raw: string): VoximplantConfig | null {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as {
    account_id?: unknown;
    key_id?: unknown;
    private_key?: unknown;
  };
  const accountId = p.account_id;
  const keyId = typeof p.key_id === 'string' ? p.key_id : '';
  const privateKey = typeof p.private_key === 'string' ? p.private_key : '';
  const accountIdOk =
    typeof accountId === 'string' || typeof accountId === 'number';
  if (!accountIdOk || !keyId || !privateKey) return null;
  return { accountId: accountId as string | number, keyId, privateKey };
}

// Returns null unless the service-account JSON parses AND rule_id + caller_id are
// present (the minimum StartScenarios needs). Read server-side only.
export async function getVoximplantConfig(): Promise<VoximplantServerConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;

    const auth = parseServiceAccount(str(row, 'voximplant_service_account_json'));
    const ruleId = str(row, 'voximplant_rule_id');
    const callerId = str(row, 'voximplant_caller_id');
    if (!auth || !ruleId || !callerId) return null;

    return {
      auth,
      ruleId,
      callerId,
      callbackSecret: str(row, 'voximplant_callback_secret') || null,
      groqApiKey: str(row, 'voximplant_groq_api_key') || null,
      lowBalanceThreshold: num(row, 'voximplant_low_balance_threshold', 5.0),
      minCallReserve: num(row, 'voximplant_min_call_reserve', 0.1),
      maxConcurrentCalls: num(row, 'voximplant_max_concurrent_calls', 5),
      maxCallsPerCampaignHour: num(row, 'voximplant_max_calls_per_campaign_hour', 200),
      liveCallsEnabled: envAllowsLiveCalls() && row.voximplant_live_calls === true,
    };
  } catch {
    return null;
  }
}

// Just the ?k= secret, for the ctx/cb endpoints (they don't need the full config).
export async function getVoximplantCallbackSecret(): Promise<string | null> {
  const cfg = await getVoximplantConfig();
  return cfg?.callbackSecret ?? null;
}

// Narrow config for the account-callback verified balance pull (B5): the
// service-account auth + the two thresholds ONLY. Deliberately does NOT require
// rule_id/caller_id — a balance alert must work whether or not dialing is
// configured (number-rent decay matters while calls are off), and the callback's
// validity must not depend on the dial config. Returns null only if the SA JSON
// is absent/unparseable.
export type VoximplantBalancePullConfig = {
  auth: VoximplantConfig;
  lowBalanceThreshold: number;
  minCallReserve: number;
};

export async function getVoximplantBalancePullConfig(): Promise<VoximplantBalancePullConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const auth = parseServiceAccount(str(row, 'voximplant_service_account_json'));
    if (!auth) return null;
    return {
      auth,
      lowBalanceThreshold: num(row, 'voximplant_low_balance_threshold', 5.0),
      minCallReserve: num(row, 'voximplant_min_call_reserve', 0.1),
    };
  } catch {
    return null;
  }
}

// Just the Groq key (Branch B: served in the ctx response instead of the scenario
// payload, so it never lands in Voximplant call-history session_custom_data). Read
// directly from the row so serving it never depends on SA/rule/caller presence.
// NEVER logged; only returned over the token-gated ctx endpoint. Null if unset.
export async function getVoximplantGroqKey(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('voximplant_groq_api_key')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const key = (data as Record<string, unknown>).voximplant_groq_api_key;
    return typeof key === 'string' && key.trim() !== '' ? key : null;
  } catch {
    return null;
  }
}

// The env var is now an OPS OVERRIDE / kill switch only: unset (default) lets the
// admin DB toggle (app_settings.voximplant_live_calls) govern; setting it to the
// literal 'false' HARD-DISABLES live calls regardless of the DB flag (emergency
// stop that no admin UI click can undo). The effective gate is computed in
// getVoximplantConfig().liveCallsEnabled = envAllowsLiveCalls() && the DB toggle.
export function envAllowsLiveCalls(): boolean {
  return process.env.VOXIMPLANT_LIVE_CALLS !== 'false';
}
