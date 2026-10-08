import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Server-side readers of the CardCom connection (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, D1). The
// table, `cardcom_config`, is CLOSED: RLS with no policy and every client grant revoked, so only the service-role
// client reads it, and these functions never run in the browser. The API password lives in Vault and leaves it only
// through getCardcomApiPassword, at the moment of a refund.
//
// Every reader is fail-closed, like src/lib/data/payments.ts: on any error — a missing row, a failed read, a value that
// makes no sense — it resolves to "not configured" rather than throwing. A customer page must never crash because
// clearing is unset, and a pilot that is not configured simply does not exist.

// CardCom's published test terminal. Nothing is charged on it, so a purchase that "succeeds" there is not money: it is
// open only to a platform admin (plan D4), whatever the switch says.
export const CARDCOM_TEST_TERMINAL = 1000;

export const isCardcomTestTerminal = (terminalNumber: number): boolean => terminalNumber === CARDCOM_TEST_TERMINAL;

export type CardcomServerConfig = {
  terminalNumber: number;
  apiName: string;
  /** The pilot switch: only an explicit true sends a package purchase to CardCom. */
  enabled: boolean;
};

export async function getCardcomServerConfig(): Promise<CardcomServerConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('cardcom_config')
      .select('terminal_number, api_name, enabled')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const terminalNumber = data.terminal_number;
    const apiName = typeof data.api_name === 'string' ? data.api_name.trim() : '';
    if (typeof terminalNumber !== 'number' || !Number.isInteger(terminalNumber) || terminalNumber <= 0) return null;
    if (apiName === '' || typeof data.enabled !== 'boolean') return null;
    return { terminalNumber, apiName, enabled: data.enabled };
  } catch {
    return null;
  }
}

// The password CardCom wants for a refund, decrypted from Vault. Read only when a refund is about to be sent, never kept.
export async function getCardcomApiPassword(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('cardcom_api_password');
    if (error || typeof data !== 'string' || data === '') return null;
    return data;
  } catch {
    return null;
  }
}
