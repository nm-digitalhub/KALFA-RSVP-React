import 'server-only';

import { GRAPH_API_VERSION } from './graph-version';
import { createWhatsAppManagementClient } from './whatsapp-client';

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
  /**
   * True when every page was read, so this list is the WABA's numbers in full.
   *
   * It exists for exactly one caller: the sync's deactivation step, which treats a
   * number's ABSENCE as "deleted at Meta". That inference is only sound over a
   * complete read — against a single first page it would turn off every number
   * from page two. False means "do not conclude anything from absence".
   */
  complete: boolean;
}

// One page is 50; the WABA holds 4 (measured 2026-09-13). The cap is a runaway
// guard, not a limit anyone is expected to reach — and hitting it reports
// `complete: false` rather than silently truncating.
const MAX_PAGES = 20;

export interface WabaCredentials {
  wabaId: string;
  accessToken: string;
}

async function getPage(
  url: string,
  accessToken: string,
): Promise<{ data?: WabaPhoneNumber[]; paging?: { next?: string } }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // STATUS ONLY. Meta's error body echoes request context and has carried the
    // token in `fbtrace`-adjacent fields in the past; this string reaches logs and,
    // through an action, an admin's screen.
    throw new Error(`Meta phone_numbers fetch failed: HTTP ${res.status}`);
  }

  return (await res.json()) as { data?: WabaPhoneNumber[]; paging?: { next?: string } };
}

/**
 * Every page of the WABA's numbers.
 *
 * This followed `paging.next` for the first time on 2026-09-13. Before that it read
 * `body.data` from one `limit=50` request and stopped — fine while the list is
 * short, and the reason the sync could not safely act on a number's absence: on a
 * WABA with 51 numbers, number 51 is indistinguishable from a deleted one.
 *
 * `paging.next` is a fully-formed URL from Meta and already carries the fields and
 * the cursor, so it is followed as-is rather than rebuilt. The Authorization header
 * still has to be re-sent — the token is in the header, not in that URL.
 */
async function fetchNumbers(
  creds: WabaCredentials,
  fields: string,
): Promise<{ numbers: WabaPhoneNumber[]; complete: boolean }> {
  let url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
      creds.wabaId,
    )}/phone_numbers?fields=${fields}&limit=50`;

  const numbers: WabaPhoneNumber[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getPage(url, creds.accessToken);
    numbers.push(...(body.data ?? []));
    const next = body.paging?.next;
    if (!next) return { numbers, complete: true };
    url = next;
  }
  // Ran out of pages to read rather than pages to fetch. The numbers gathered are
  // real; the LIST is not known to be whole, so absence proves nothing.
  return { numbers, complete: false };
}

export async function listWabaPhoneNumbers(
  creds: WabaCredentials,
): Promise<WabaPhoneNumbersResult> {
  try {
    return { ...(await fetchNumbers(creds, WABA_PHONE_FIELDS_FULL)), degraded: false };
  } catch {
    // Deliberately catches everything, not just #100: a timeout on the wide read is
    // also worth one cheap retry, and the caller cannot act differently on the
    // distinction. A second failure propagates — at that point it is not a field.
    return { ...(await fetchNumbers(creds, WABA_PHONE_FIELDS_CORE)), degraded: true };
  }
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────
// Everything below CHANGES STATE AT META, and all of it DELEGATES to
// @kapso/whatsapp-cloud-api through createWhatsAppManagementClient.
//
// A hand-rolled `postGraph` stood here first, and writing it was the mistake. The
// package already models this exact lifecycle (`client.phoneNumbers.requestCode /
// verifyCode / register / deregister`), converts camelCase to Meta's snake_case, and
// raises a GraphApiError carrying `code`, `errorSubcode`, `category` and a retry hint
// — strictly more than the two fields the local version captured.
//
// It also settled a question guesswork could not. Meta's docs show request_code as
// QUERY parameters (`?code_method=SMS&language=en_US`), which read as a contradiction
// of the local JSON body; a "fix" switching those two calls to form encoding was
// written and then reverted, because the package — maintained against this API —
// sends a JSON body for all four. A speculative transport change dressed as a fix is
// worse than the bug it guesses at.
//
// ADDING A NUMBER IS STILL NOT HERE. `addWabaPhoneNumber` lives in
// ./add-waba-phone-number.ts, typed against Meta's OpenAPI spec.
//
// ⚠️ THE 72-HOUR LOCK IS THE CONSTRAINT EVERYTHING ELSE IS SHAPED AROUND.
// register and deregister are limited to 10 per business number per 72-hour moving
// window; the eleventh returns 133016 and BLOCKS THE NUMBER FOR 72 HOURS. It is not a
// retryable error, and retrying is the one response that makes it worse. The ceiling
// is per BUSINESS NUMBER at Meta, so the caller must rate-limit on the phone_number_id
// — see reserveRegistrationBudget in the DAL.
//
// ⚠️ THERE IS NO "CREATE PIN" OPERATION. The PIN is a parameter of register: when
// two-step verification is already on it must be the EXISTING PIN, and when it is off
// the value sent BECOMES the number's 2SV PIN. Meta then requires it to change the PIN
// or delete the number, so its blast radius outlives the registration. It is never
// returned, never logged, never placed in an error, and never stored.

/** Exceeding 10 register/deregister calls in 72h. The number is locked, not busy. */
export const META_RATE_LIMIT_CODE = 133016;

/**
 * Meta's numeric error code, whichever shape carries it.
 *
 * `GraphApiError` (the package) and `AddWabaPhoneNumberError` (the typed OpenAPI
 * client) name the same field differently. Reading only one of them meant every
 * add-number failure arrived as null and reached the admin as a bare "it failed" —
 * the code was on the error the whole time.
 */
export function metaErrorCode(err: unknown): number | null {
  const e = err as { code?: unknown; providerCode?: unknown } | null;
  if (typeof e?.code === 'number') return e.code;
  if (typeof e?.providerCode === 'number') return e.providerCode;
  return null;
}

/**
 * Meta's error SUBCODE, which is often the only field that distinguishes two very
 * different failures sharing one code.
 *
 * GraphApiError exposes it as `errorSubcode`; the OpenAPI client calls it
 * `providerSubcode`. Not sensitive — it is a number, not a message — and it is what
 * turns "Meta refused" into something that can be looked up.
 */
export function metaErrorSubcode(err: unknown): number | null {
  const e = err as { errorSubcode?: unknown; providerSubcode?: unknown } | null;
  if (typeof e?.errorSubcode === 'number') return e.errorSubcode;
  if (typeof e?.providerSubcode === 'number') return e.providerSubcode;
  return null;
}

/**
 * Ask Meta to send a verification code to the physical handset.
 *
 * ⚠️ `language` IS `en_US`, NOT `he`, AND THAT IS DELIBERATE. Meta calls it "the
 * two-character language code" and then shows `en_US` in every example, including the
 * curl. The two cannot both be right, and an unverified `he` risks a silently English
 * SMS to an Israeli owner — a failure found from a support call, not a status code.
 * Offer Hebrew only after seeing it accepted against the real number.
 *
 * This DOES reach a real phone. It is not a health check.
 */
export async function requestVerificationCode(
  phoneNumberId: string,
  accessToken: string,
  codeMethod: 'SMS' | 'VOICE',
): Promise<void> {
  const client = createWhatsAppManagementClient(accessToken);
  await client.phoneNumbers.requestCode({
    phoneNumberId,
    codeMethod,
    language: 'en_US',
  });
}

/** Submit the code the owner received. Proves ownership; does not register. */
export async function verifyPhoneNumberCode(
  phoneNumberId: string,
  accessToken: string,
  code: string,
): Promise<void> {
  const client = createWhatsAppManagementClient(accessToken);
  await client.phoneNumbers.verifyCode({ phoneNumberId, code });
}

/**
 * Register the number for the Cloud API.
 *
 * COUNTS AGAINST THE 10-PER-72-HOUR CEILING. `pin` is passed straight through and
 * appears nowhere else.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
  pin: string,
): Promise<void> {
  const client = createWhatsAppManagementClient(accessToken);
  await client.phoneNumbers.register({ phoneNumberId, pin });
}

/**
 * Deregister the number. Sending stops.
 *
 * ALSO COUNTS AGAINST THE SAME CEILING, so a register/deregister loop burns the
 * window twice as fast.
 */
export async function deregisterPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const client = createWhatsAppManagementClient(accessToken);
  await client.phoneNumbers.deregister({ phoneNumberId });
}
