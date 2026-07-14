import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';
import {
  getVoximplantConfig,
  getVoximplantLiveEnabled,
} from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';

// Admin: Voximplant AI-call channel config (app_settings singleton, admin-only
// RLS). Same masked-secret pattern as WhatsApp/SUMIT/SMTP. The service-account
// JSON is a multi-KB RSA private key: it is NEVER round-tripped to the client —
// only its presence is reported. The dial secrets (callback_secret,
// groq_api_key) ARE returned to this requireAdmin HTTPS form, shown masked with
// a reveal toggle, never logged. `outreach_enabled` is the shared master switch
// (same column WhatsApp uses) and is written ONLY by the hoisted master action,
// never by this channel DAL.

export type VoximplantChannelConfig = {
  serviceAccountConfigured: boolean; // presence only — the JSON key is never returned
  voximplant_rule_id: string;
  voximplant_caller_id: string;
  voximplant_callback_secret: string; // '' when unset — ?k= secret on ctx/cb URLs
  voximplant_groq_api_key: string; // '' when unset — scenario 'gk' (Branch A)
  voximplant_low_balance_threshold: string; // stringified for the form
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
  configured: boolean; // derived: SA json + rule_id + caller_id present (matches getVoximplantConfig !== null)
  liveEnabled: boolean; // env VOXIMPLANT_LIVE_CALLS — display-only badge, NOT a DB toggle
};

const SETTINGS_ID = true;

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export async function getVoximplantChannelConfig(): Promise<VoximplantChannelConfig> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'voximplant_service_account_json, voximplant_rule_id, voximplant_caller_id, ' +
        'voximplant_callback_secret, voximplant_groq_api_key, voximplant_low_balance_threshold, ' +
        'voximplant_min_call_reserve, voximplant_max_concurrent_calls, voximplant_max_calls_per_campaign_hour',
    )
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error('טעינת הגדרות הערוץ נכשלה');

  const row = (data ?? {}) as Record<string, unknown>;
  const saConfigured = s(row.voximplant_service_account_json).trim() !== '';
  const ruleId = s(row.voximplant_rule_id);
  const callerId = s(row.voximplant_caller_id);
  return {
    serviceAccountConfigured: saConfigured,
    voximplant_rule_id: ruleId,
    voximplant_caller_id: callerId,
    voximplant_callback_secret: s(row.voximplant_callback_secret),
    voximplant_groq_api_key: s(row.voximplant_groq_api_key),
    voximplant_low_balance_threshold: s(row.voximplant_low_balance_threshold),
    voximplant_min_call_reserve: s(row.voximplant_min_call_reserve),
    voximplant_max_concurrent_calls: s(row.voximplant_max_concurrent_calls),
    voximplant_max_calls_per_campaign_hour: s(
      row.voximplant_max_calls_per_campaign_hour,
    ),
    configured: saConfigured && !!ruleId && !!callerId,
    liveEnabled: getVoximplantLiveEnabled(),
  };
}

export type UpdateVoximplantChannelInput = {
  // NOTE: no `outreach_enabled` here — the global master switch is written ONLY
  // by the hoisted master action (§1.0), never by a channel form.
  // '' = keep the existing stored value (write-only secret); a non-empty value
  // replaces it.
  voximplant_service_account_json: string;
  voximplant_rule_id: string;
  voximplant_caller_id: string;
  voximplant_callback_secret: string;
  voximplant_groq_api_key: string;
  voximplant_low_balance_threshold: string;
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
};

export async function updateVoximplantChannelConfig(
  input: UpdateVoximplantChannelInput,
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  // The nullable text columns take '' → null (intentional unset). The FOUR
  // tuning columns are NOT NULL number in the live schema — writing null would
  // break the UPDATE, so a blank field is OMITTED from the patch (keeps the
  // existing DB value / default). The write-only service-account JSON is also
  // omitted when blank ("leave as-is") and written only on a fresh non-empty
  // value.
  const patch: Database['public']['Tables']['app_settings']['Update'] = {
    voximplant_rule_id: input.voximplant_rule_id || null,
    voximplant_caller_id: input.voximplant_caller_id || null,
    voximplant_callback_secret: input.voximplant_callback_secret || null,
    voximplant_groq_api_key: input.voximplant_groq_api_key || null,
  };
  // NOT NULL numeric columns — only set when a finite number is supplied.
  const num = (v: string): number | undefined => {
    const t = v.trim();
    if (t === '') return undefined; // keep existing
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };
  const lowBalance = num(input.voximplant_low_balance_threshold);
  if (lowBalance !== undefined) patch.voximplant_low_balance_threshold = lowBalance;
  const minReserve = num(input.voximplant_min_call_reserve);
  if (minReserve !== undefined) patch.voximplant_min_call_reserve = minReserve;
  const maxConcurrent = num(input.voximplant_max_concurrent_calls);
  if (maxConcurrent !== undefined)
    patch.voximplant_max_concurrent_calls = maxConcurrent;
  const maxPerHour = num(input.voximplant_max_calls_per_campaign_hour);
  if (maxPerHour !== undefined)
    patch.voximplant_max_calls_per_campaign_hour = maxPerHour;
  if (input.voximplant_service_account_json.trim() !== '') {
    patch.voximplant_service_account_json =
      input.voximplant_service_account_json.trim();
  }

  const { error } = await supabase
    .from('app_settings')
    .update(patch)
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון הגדרות הערוץ נכשל');
}

export type ConnectionTestResult = { ok: boolean; message: string };

// Read-only credential check: parse the stored SA-JSON via getVoximplantConfig()
// and call GetAccountInfo. Validates the JWT auth WITHOUT placing a call. Never
// logs or returns the key; surfaces balance so the admin can gate go-live (B5).
export async function testVoximplantConnection(): Promise<ConnectionTestResult> {
  await requireAdmin();
  const cfg = await getVoximplantConfig();
  if (!cfg) {
    return {
      ok: false,
      message: 'חסרים פרטי חשבון שירות תקינים או rule_id / caller_id',
    };
  }
  try {
    const info = await getAccountInfo(cfg.auth, 10_000);
    return { ok: true, message: `מחובר · יתרה $${info.result.balance.toFixed(2)}` };
  } catch {
    return { ok: false, message: 'החיבור נכשל — בדקו את פרטי חשבון השירות' };
  }
}
