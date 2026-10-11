import 'server-only';

import { getCompanyLegal } from '@/lib/data/company';
import { renderConsentWording, type ConsentWording } from '@/lib/marketing/consent-wording';
import { createAdminClient } from '@/lib/supabase/admin';

// Customer consent to KALFA marketing email (openspec change marketing-email-consent, spec marketing-consent).
//
// The evidence lives in public.marketing_consent_events: append-only, written and read by service_role only (no API
// role may insert, update or delete — migration 20261011083826). The latest row of a user is their current consent.
//
// CUSTOMERS ONLY. Nothing here reads or writes guests or event contacts; a user id always comes from the verified
// session or from Auth, never from a guest row.

export type ConsentAction = 'grant' | 'withdraw';
export type ConsentSource =
  | 'signup'
  | 'settings'
  | 'provider_unsubscribe'
  | 'provider_complaint'
  | 'account_removed';
export type CurrentConsent = 'granted' | 'withdrawn' | 'none';

type AdminClient = ReturnType<typeof createAdminClient>;

// FAIL-SAFE: anything but an explicit true — a read error, a missing row or column — reads as OFF, so a hiccup never
// shows a consent box with wording nobody approved.
export async function isMarketingConsentEnabled(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from('app_settings').select('*').eq('id', true).maybeSingle();
    if (error || !data) return false;
    return (data as Record<string, unknown>).marketing_consent_enabled === true;
  } catch {
    return false;
  }
}

// The wording the server shows next to the box AND records with a grant — one source, so they cannot differ.
export async function getConsentWording(): Promise<ConsentWording> {
  const company = await getCompanyLegal();
  return renderConsentWording(company.name);
}

export async function currentConsent(userId: string, admin: AdminClient = createAdminClient()): Promise<CurrentConsent> {
  const { data, error } = await admin
    .from('marketing_consent_events')
    .select('action')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('marketing_consent_read_failed');
  if (!data) return 'none';
  return data.action === 'grant' ? 'granted' : 'withdrawn';
}

export interface RecordConsentInput {
  userId: string;
  email: string;
  action: ConsentAction;
  source: ConsentSource;
  ip?: string | null;
  userAgent?: string | null;
  providerEventId?: string | null;
}

export type RecordConsentResult = 'recorded' | 'unchanged' | 'duplicate';

// Records one grant or withdrawal. A row that would not change the current state is not written ('unchanged'), and a
// provider event already recorded is not written twice ('duplicate', from the unique provider_event_id).
export async function recordConsent(
  input: RecordConsentInput,
  admin: AdminClient = createAdminClient(),
): Promise<RecordConsentResult> {
  const current = await currentConsent(input.userId, admin);
  if ((input.action === 'grant' && current === 'granted') || (input.action === 'withdraw' && current !== 'granted')) {
    return 'unchanged';
  }

  const wording = input.action === 'grant' ? await getConsentWording() : null;
  const { error } = await admin.from('marketing_consent_events').insert({
    user_id: input.userId,
    // Lower-cased so a provider event (which reports the address as Resend stores it) finds the row by equality.
    email: input.email.trim().toLowerCase(),
    action: input.action,
    source: input.source,
    wording: wording?.text ?? null,
    wording_version: wording?.version ?? null,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    provider_event_id: input.providerEventId ?? null,
  });
  if (error) {
    if (error.code === '23505' && input.providerEventId) return 'duplicate';
    throw new Error('marketing_consent_write_failed');
  }
  return 'recorded';
}

// The customer a provider event's address belongs to: the user of the latest ledger row for that address, with that
// row's action and time. null when no customer ever consented with it — a provider event about anyone else is ignored.
export async function latestConsentForEmail(
  email: string,
  admin: AdminClient = createAdminClient(),
): Promise<{ userId: string; action: ConsentAction; occurredAt: string } | null> {
  const { data, error } = await admin
    .from('marketing_consent_events')
    .select('user_id, action, occurred_at')
    .eq('email', email.trim().toLowerCase())
    .not('user_id', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('marketing_consent_read_failed');
  if (!data?.user_id) return null;
  return { userId: data.user_id, action: data.action === 'grant' ? 'grant' : 'withdraw', occurredAt: data.occurred_at };
}
