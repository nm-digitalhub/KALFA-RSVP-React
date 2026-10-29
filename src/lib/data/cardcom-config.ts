import 'server-only';

import ipaddr from 'ipaddr.js';

import { parseGooglePayMode, type GooglePayMode } from '@/lib/cardcom/google-pay-mode';
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
// open only to a platform admin (plan D4), whatever the switch says, except on a server that runs against a local
// database (usesLocalDatabase below).
export const CARDCOM_TEST_TERMINAL = 1000;

export const isCardcomTestTerminal = (terminalNumber: number): boolean => terminalNumber === CARDCOM_TEST_TERMINAL;

// Does this server run against a database on this machine (Supabase local, `supabase start`)? The test server on :3999
// does: it runs with NODE_ENV=test, so Next.js loads .env.test.local and never .env.local (docs: environment-variables,
// "Test Environment Variables"). Such a database holds no real customer, so there the test terminal is open to every
// buyer (owner, 29.10.2026). Production runs against the hosted project and never matches.
//
// NEXT_PUBLIC_SUPABASE_URL is the address every server client connects to (src/lib/supabase/admin.ts). Next.js inlines
// it at build time, server code included (docs: "Bundling Environment Variables for the Browser"), so a production build
// cannot be opened by a variable set at runtime. Read literally: a dynamic lookup is not inlined. Loopback only, by
// ipaddr.js range (the same test as src/lib/voximplant/session-command.ts); a private LAN address is not "this machine".
// A missing or unparsable address answers false.
export function usesLocalDatabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  } catch {
    return false;
  }
  if (host === 'localhost') return true;
  return ipaddr.isValid(host) && ipaddr.process(host).range() === 'loopback';
}

export type CardcomServerConfig = {
  terminalNumber: number;
  apiName: string;
  /** The pilot switch: only an explicit true sends a package purchase to CardCom. */
  enabled: boolean;
  /**
   * The save-card switch (admin, 12.10.2026): when true, a package purchase asks CardCom for
   * ChargeAndCreateToken — charge AND save the card for the planned upgrade charges — instead of ChargeOnly.
   * Only an explicit true tokenizes, same posture as `enabled`.
   */
  saveCardOnPurchase: boolean;
  /**
   * Who is offered Google Pay on the payment form (admin, 18.10.2026): off, admins or all. Any stored value that is none of
   * the three reads as `off`, same fail-closed posture as the switches above, and it never makes the connection unreadable.
   */
  googlePayMode: GooglePayMode;
};

export async function getCardcomServerConfig(): Promise<CardcomServerConfig | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('cardcom_config')
      .select('terminal_number, api_name, enabled, save_card_on_purchase, google_pay_mode')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return null;
    const terminalNumber = data.terminal_number;
    const apiName = typeof data.api_name === 'string' ? data.api_name.trim() : '';
    if (typeof terminalNumber !== 'number' || !Number.isInteger(terminalNumber) || terminalNumber <= 0) return null;
    if (apiName === '' || typeof data.enabled !== 'boolean') return null;
    return {
      terminalNumber,
      apiName,
      enabled: data.enabled,
      saveCardOnPurchase: data.save_card_on_purchase === true,
      googlePayMode: parseGooglePayMode(data.google_pay_mode),
    };
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
