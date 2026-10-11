import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// The switches that decide WHO may be called (public.call_compliance_settings, one row, id = true), split out of
// app_settings on 11.10.2026. Both readers here are for the dial path and use the service-role client; the admin
// screens read and write through the cookie client (src/lib/data/admin/voximplant-channel.ts).
//
// Both fail SAFE, toward protecting the person called: a read error, a missing row, or anything but an explicit false
// (resp. true) reads as "consent required" and "registry gate on".

const SETTINGS_ID = true;

async function readSettings(): Promise<{ call_consent_required: boolean; dnc_registry_gate_enabled: boolean } | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('call_compliance_settings')
      .select('call_consent_required, dnc_registry_gate_enabled')
      .eq('id', SETTINGS_ID)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/** Whether an AI dial needs a recorded contacts.call_consent_at. Anything but an explicit false reads as required. */
export async function callConsentRequired(): Promise<boolean> {
  const row = await readSettings();
  return row?.call_consent_required !== false;
}

/**
 * Whether marketing dials are checked against the national Do-Not-Call registry. A read error counts as ON: the check
 * protects the person called, and a dial it holds back only waits (openspec/changes/dnc-registry-dial-gate, D5).
 */
export async function dncRegistryGateEnabled(): Promise<boolean> {
  const row = await readSettings();
  return row === null ? true : row.dnc_registry_gate_enabled === true;
}
