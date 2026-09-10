import 'server-only';

import { GRAPH_API_VERSION } from './graph-version';

// Read the phone numbers attached to a WABA. Read-only: one GET, no message sent,
// no template touched.
//
// ⚠️ GRAPH REJECTS THE WHOLE REQUEST OVER ONE BAD FIELD, AND BLAMES THE WRONG PART.
// Asking for a field Meta has removed returns #100 for the entire call, with an
// error naming the object rather than the field — so a single retired field takes
// the numbers page down and sends whoever debugs it to check the WABA id. Meta has
// removed fields before. So the full field list is attempted once, and a failure
// falls back to a core that has been running in production continuously
// (`display_phone_number` and `verified_name` are what channels.ts reads on every
// connection test) and reports `degraded: true` for the page to show as a note.
// Degrading is not the same as failing: the numbers are still listed, the extra
// columns are simply blank, and the admin is told which of the two happened.
//
// The two verification fields are the reason the wide list is worth attempting at
// all. Measured live 2026-09-10 on this WABA: the configured RSVP sender's
// `code_verification_status` is EXPIRED while the import number's is VERIFIED —
// and Meta's own WhatsApp Manager table does not show that column anywhere.

export const WABA_PHONE_FIELDS_FULL =
  'id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,platform_type,account_mode,is_official_business_account';

// Proven in production on every connection test. If even this fails, the problem is
// the credentials or the WABA, not a field name.
export const WABA_PHONE_FIELDS_CORE = 'id,display_phone_number,verified_name,status';

export interface WabaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  status?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  messaging_limit_tier?: string;
  throughput?: { level?: string };
  platform_type?: string;
  account_mode?: string;
  is_official_business_account?: boolean;
}

export interface WabaPhoneNumbersResult {
  numbers: WabaPhoneNumber[];
  /** True when the wide field list failed and the core list answered instead. */
  degraded: boolean;
}

export interface WabaCredentials {
  wabaId: string;
  accessToken: string;
}

async function fetchNumbers(
  creds: WabaCredentials,
  fields: string,
): Promise<WabaPhoneNumber[]> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
      creds.wabaId,
    )}/phone_numbers?fields=${fields}&limit=50`,
    {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!res.ok) {
    // STATUS ONLY. Meta's error body echoes request context and has carried the
    // token in `fbtrace`-adjacent fields in the past; this string reaches logs and,
    // through an action, an admin's screen.
    throw new Error(`Meta phone_numbers fetch failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data?: WabaPhoneNumber[] };
  return body.data ?? [];
}

export async function listWabaPhoneNumbers(
  creds: WabaCredentials,
): Promise<WabaPhoneNumbersResult> {
  try {
    return { numbers: await fetchNumbers(creds, WABA_PHONE_FIELDS_FULL), degraded: false };
  } catch {
    // Deliberately catches everything, not just #100: a timeout on the wide read is
    // also worth one cheap retry, and the caller cannot act differently on the
    // distinction. A second failure propagates — at that point it is not a field.
    return { numbers: await fetchNumbers(creds, WABA_PHONE_FIELDS_CORE), degraded: true };
  }
}
