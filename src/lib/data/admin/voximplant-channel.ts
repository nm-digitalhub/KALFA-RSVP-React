import 'server-only';

import { randomBytes } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';
import {
  getVoximplantConfig,
  envAllowsLiveCalls,
} from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import { setAccountCallbackUrl } from '@/lib/voximplant/mutations';
import { sha256Hex } from '@/lib/security/token-compare';
import { normalizeAccountInfo } from '@/lib/validation/vox-payloads';
import { getAppUrl } from '@/lib/url';

// Admin: Voximplant AI-call channel config (app_settings singleton, admin-only
// RLS). Same masked-secret pattern as WhatsApp/SUMIT/SMTP. The service-account
// JSON is a multi-KB RSA private key: it is NEVER round-tripped to the client —
// only its presence is reported. The dial secret (callback_secret) IS returned
// to this requireAdmin HTTPS form, shown masked with a reveal toggle, never
// logged. `outreach_enabled` is the shared master switch
// (same column WhatsApp uses) and is written ONLY by the hoisted master action,
// never by this channel DAL.

export type VoximplantChannelConfig = {
  serviceAccountConfigured: boolean; // presence only — the JSON key is never returned
  voximplant_rule_id: string;
  voximplant_caller_id: string;
  voximplant_callback_secret: string; // '' when unset — ?k= secret on ctx/cb URLs
  voximplant_low_balance_threshold: string; // stringified for the form
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
  configured: boolean; // derived: SA json + rule_id + caller_id present (matches getVoximplantConfig !== null)
  fullyConfigured: boolean; // configured AND callback_secret — the full dial config
  liveCalls: boolean; // raw app_settings.voximplant_live_calls (the admin toggle's value)
  liveEnabled: boolean; // EFFECTIVE live gate: the DB toggle AND the env not force-off
};

const SETTINGS_ID = true;

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export async function getVoximplantChannelConfig(): Promise<VoximplantChannelConfig> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select(
      'voximplant_service_account_json, voximplant_rule_id, voximplant_caller_id, ' +
        'voximplant_callback_secret, voximplant_low_balance_threshold, ' +
        'voximplant_min_call_reserve, voximplant_max_concurrent_calls, voximplant_max_calls_per_campaign_hour, ' +
        'voximplant_live_calls',
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
    voximplant_low_balance_threshold: s(row.voximplant_low_balance_threshold),
    voximplant_min_call_reserve: s(row.voximplant_min_call_reserve),
    voximplant_max_concurrent_calls: s(row.voximplant_max_concurrent_calls),
    voximplant_max_calls_per_campaign_hour: s(
      row.voximplant_max_calls_per_campaign_hour,
    ),
    configured: saConfigured && !!ruleId && !!callerId,
    fullyConfigured:
      saConfigured &&
      !!ruleId &&
      !!callerId &&
      s(row.voximplant_callback_secret).trim() !== '',
    liveCalls: row.voximplant_live_calls === true,
    liveEnabled: envAllowsLiveCalls() && row.voximplant_live_calls === true,
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
  voximplant_low_balance_threshold: string;
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
};

export async function updateVoximplantChannelConfig(
  input: UpdateVoximplantChannelInput,
): Promise<void> {
  await requirePlatformPermission('manage_voice');
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

// Admin toggle for the live-dial gate (app_settings.voximplant_live_calls). This
// PERMITS real outbound calls — enabling it still leaves consent/DNC/balance and
// the env kill switch in force. Admin-only (RLS + requireAdmin). The action layer
// is fail-closed (refuses to enable without a complete config) and audit-logs.
export async function updateVoximplantLiveCalls(enabled: boolean): Promise<void> {
  await requirePlatformPermission('manage_voice');
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ voximplant_live_calls: enabled })
    .eq('id', SETTINGS_ID);
  if (error) throw new Error('עדכון מתג השיחות החיות נכשל');
}

// ---------------------------------------------------------------------------
// B5 — account-callback wiring state machine.
// ---------------------------------------------------------------------------
// The ONLY mutating Voximplant call in the product besides the dial: a
// restricted SetAccountInfo(callback_url, callback_salt). State machine:
//   unwired → pending → wired | failed → rollback_pending → rolled_back
// Persist-then-mutate: we store the token HASH + salt + a snapshot of the
// PREVIOUS callback_url/salt BEFORE calling SetAccountInfo, so the provider can
// never point at a token we failed to store, and a rollback RESTORES the prior
// values (never blank-resets). The raw token is returned ONCE for display and
// then exists only inside the URL registered at Voximplant.

export type WireAccountCallbackResult =
  | { ok: true; callbackUrl: string; rawToken: string; echoConfirmed: boolean }
  | { ok: false; message: string };

export async function wireVoximplantAccountCallback(): Promise<WireAccountCallbackResult> {
  await requirePlatformPermission('manage_voice');
  const cfg = await getVoximplantConfig();
  if (!cfg) {
    return { ok: false, message: 'הערוץ אינו מוגדר — נדרש חשבון שירות תקין תחילה' };
  }
  const supabase = await createClient();

  // Snapshot the CURRENT callback_url/salt (echo) so a rollback can restore it.
  // If the echo is unavailable, snapshot explicit nulls (documented fallback).
  let prev: { callback_url: string | null; callback_salt: string | null } = {
    callback_url: null,
    callback_salt: null,
  };
  try {
    const info = normalizeAccountInfo(await getAccountInfo(cfg.auth, 10_000));
    prev = { callback_url: info.callbackUrl, callback_salt: info.callbackSalt };
  } catch {
    /* echo unavailable — keep null snapshot (rollback will clear, with a warning) */
  }

  const rawToken = randomBytes(24).toString('hex'); // 48 hex chars, 192-bit
  const salt = randomBytes(12).toString('hex'); // ≤40 chars, provider salt
  const tokenHash = sha256Hex(rawToken);
  const callbackUrl = await getAppUrl(`/api/voximplant/account-callback/${rawToken}`);

  // 1. Persist hash+salt+prev+state='pending' FIRST (before the provider call).
  const pendingPatch: Database['public']['Tables']['app_settings']['Update'] = {
    voximplant_account_callback_token_hash: tokenHash,
    voximplant_account_callback_salt: salt,
    voximplant_account_callback_prev: prev as unknown as Database['public']['Tables']['app_settings']['Update']['voximplant_account_callback_prev'],
    voximplant_account_callback_state: 'pending',
  };
  const { error: persistErr } = await supabase
    .from('app_settings')
    .update(pendingPatch)
    .eq('id', SETTINGS_ID);
  if (persistErr) return { ok: false, message: 'שמירת הטוקן נכשלה — לא בוצע חיווט' };

  // 2. Register the callback at Voximplant (the restricted SetAccountInfo).
  try {
    await setAccountCallbackUrl(cfg.auth, callbackUrl, salt);
  } catch {
    await supabase
      .from('app_settings')
      .update({ voximplant_account_callback_state: 'failed' })
      .eq('id', SETTINGS_ID);
    return { ok: false, message: 'רישום ה־callback ב־Voximplant נכשל — ניתן לנסות שוב' };
  }

  // 3. Verify via echo (best-effort), then mark wired.
  let echoConfirmed = false;
  try {
    const after = normalizeAccountInfo(await getAccountInfo(cfg.auth, 10_000));
    echoConfirmed = after.callbackUrl === callbackUrl;
  } catch {
    /* echo unverifiable — the first received callback stamp is the fallback proof */
  }
  await supabase
    .from('app_settings')
    .update({
      voximplant_account_callback_state: 'wired',
      voximplant_account_callback_wired_at: new Date().toISOString(),
    })
    .eq('id', SETTINGS_ID);

  return { ok: true, callbackUrl, rawToken, echoConfirmed };
}

export type RollbackAccountCallbackResult = { ok: boolean; message: string };

// Restore the PREVIOUS callback_url/salt (from the snapshot) — never a blank
// reset. Moves state → rollback_pending → rolled_back and clears the stored hash
// so the route goes dark again.
export async function rollbackVoximplantAccountCallback(): Promise<RollbackAccountCallbackResult> {
  await requirePlatformPermission('manage_voice');
  const cfg = await getVoximplantConfig();
  if (!cfg) return { ok: false, message: 'הערוץ אינו מוגדר' };
  const supabase = await createClient();

  const { data } = await supabase
    .from('app_settings')
    .select('voximplant_account_callback_prev')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  const prevRaw = (data as Record<string, unknown> | null)?.voximplant_account_callback_prev;
  const prev = (prevRaw ?? { callback_url: null, callback_salt: null }) as {
    callback_url: string | null;
    callback_salt: string | null;
  };

  await supabase
    .from('app_settings')
    .update({ voximplant_account_callback_state: 'rollback_pending' })
    .eq('id', SETTINGS_ID);

  try {
    // Restore the snapshotted values (both null clears the callback provider-side).
    await setAccountCallbackUrl(cfg.auth, prev.callback_url, prev.callback_salt);
  } catch {
    return { ok: false, message: 'שחזור ה־callback הקודם נכשל — נסו שוב' };
  }

  await supabase
    .from('app_settings')
    .update({
      voximplant_account_callback_state: 'rolled_back',
      voximplant_account_callback_token_hash: null, // route goes dark again
    })
    .eq('id', SETTINGS_ID);
  return { ok: true, message: 'החיווט בוטל וה־callback הקודם שוחזר' };
}

export type ConnectionTestResult = { ok: boolean; message: string };

// Read-only credential check: parse the stored SA-JSON via getVoximplantConfig()
// and call GetAccountInfo. Validates the JWT auth WITHOUT placing a call. Never
// logs or returns the key; surfaces balance so the admin can gate go-live (B5).
export async function testVoximplantConnection(): Promise<ConnectionTestResult> {
  await requirePlatformPermission('manage_voice');
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
