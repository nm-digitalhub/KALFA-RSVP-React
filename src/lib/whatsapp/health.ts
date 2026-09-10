import 'server-only';

import { GRAPH_API_VERSION } from './graph-version';

// Passive health check for the WhatsApp channel: does the integration actually
// work, asked WITHOUT sending anything to anyone.
//
// Until now /admin/debug said "אין בדיקת בריאות זמינה — send-only" for WhatsApp,
// which treated "we cannot test it without messaging a guest" as the end of the
// question. It is not: Meta exposes the phone number node and the WABA's number
// list, and reading both exercises the exact credentials and ids the send path
// needs — the token, the phone number id, the WABA id, and the relationship
// between the last two.
//
// ⚠️ WHAT IT DOES NOT PROVE. That a particular message will be delivered. A send
// can still fail on template state, category, the 24-hour window, quality-based
// throttling or policy. Reporting "תקין" here means the CONNECTION is sound, and
// the wording in the UI must not promise more. A test SEND is deliberately not part
// of this: it would cost a real message to a real number to answer a question about
// configuration.
//
// ⚠️ THE FIELD LIST IS MEASURED, NOT ASSUMED, and that is not pedantry. Graph
// refuses the WHOLE request over a single unavailable field, and its error blames
// the wrong part — the OBA filter once failed with "operation not supported" when
// the real fault was a string where a boolean belonged. So every field below was
// probed live across v23–v26 (`npm run meta:verify`, 2026-09-10):
//
//   quality_rating, status, name_status, account_mode,
//   is_official_business_account, throughput, code_verification_status  → value
//   display_phone_number, verified_name                                 → in production use
//   last_onboarded_time                                                 → accepted but EMPTY
//   unified_cert_status                                                 → REFUSED on all four
//
// unified_cert_status is therefore absent, and always must be: it is declared by
// Meta's own v25.0 spec and refused by Meta's own API. last_onboarded_time is absent
// too — not because it fails (the plan said it would; measured, it does not) but
// because it is always empty here and an always-empty field is noise.
export const HEALTH_FIELDS = [
  'id',
  'display_phone_number',
  'verified_name',
  'quality_rating',
  'status',
  'name_status',
  'code_verification_status',
  'throughput',
] as const;

export interface WhatsAppHealthOk {
  ok: true;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** GREEN | YELLOW | RED | UNKNOWN — Meta's own rating, never derived here. */
  qualityRating: string | null;
  /** CONNECTED | FLAGGED | RESTRICTED … */
  status: string | null;
  nameStatus: string | null;
  throughputLevel: string | null;
}

export type WhatsAppHealthFailure =
  /** The token is rejected or expired — nothing else can be checked. */
  | 'token_invalid'
  /** The token is fine but lacks the WhatsApp scopes. */
  | 'permission_missing'
  /** The phone number id does not resolve on this token. */
  | 'number_unreachable'
  /** The WABA id does not resolve. */
  | 'waba_unreachable'
  /** Both resolve, but the number is NOT one of the WABA's numbers. */
  | 'number_not_in_waba'
  /** Meta throttled us — says nothing about configuration. */
  | 'rate_limited'
  /** Network/timeout, or a shape we do not recognise. */
  | 'unreachable';

export interface WhatsAppHealthError {
  ok: false;
  kind: WhatsAppHealthFailure;
  /** Hebrew, safe to render. NEVER carries the token or a raw Graph body. */
  message: string;
}

export type WhatsAppHealth = WhatsAppHealthOk | WhatsAppHealthError;

const MESSAGES: Record<WhatsAppHealthFailure, string> = {
  token_invalid: 'טוקן Meta אינו תקף או פג',
  permission_missing: 'לטוקן חסרות הרשאות WhatsApp',
  number_unreachable: 'מזהה מספר ה-WhatsApp אינו נגיש בטוקן הזה',
  waba_unreachable: 'מזהה החשבון העסקי (WABA) אינו נגיש בטוקן הזה',
  number_not_in_waba: 'מספר ה-WhatsApp אינו משויך לחשבון העסקי שהוגדר',
  rate_limited: 'Meta הגבילה זמנית את הקריאות — הבדיקה תחזור מאוחר יותר',
  unreachable: 'לא ניתן להגיע ל-Meta',
};

/**
 * Map a Graph error onto one of our kinds.
 *
 * Graph's numeric codes are the only stable part of its errors — the human message
 * changes, and `error_subcode` is not always present. 190 is the authoritative
 * "token" family (expired, revoked, password changed, session invalidated); 200 and
 * 10 are permission; 4/17/32/613 are the throttling family; 803 is "that object does
 * not exist for you", which for us means the id is wrong OR the token cannot see it —
 * the same remedy either way.
 */
function classify(code: number | undefined, node: 'number' | 'waba'): WhatsAppHealthFailure {
  if (code === 190) return 'token_invalid';
  if (code === 200 || code === 10) return 'permission_missing';
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limited';
  if (code === 803 || code === 100) return node === 'waba' ? 'waba_unreachable' : 'number_unreachable';
  return 'unreachable';
}

interface GraphError {
  error?: { code?: number; message?: string };
}

async function graphGet<T>(
  url: string,
  accessToken: string,
): Promise<{ ok: true; body: T } | { ok: false; code: number | undefined }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as (T & GraphError) | null;
    if (!res.ok || !body || body.error) {
      return { ok: false, code: body?.error?.code };
    }
    return { ok: true, body };
  } catch {
    // Never surface the thrown message: a fetch failure can echo the URL, and the
    // URL is where a token would be if anyone ever put one there.
    return { ok: false, code: undefined };
  }
}

/**
 * Two calls, because one does not answer the question.
 *
 * `GET /{phoneNumberId}` proves the token works and the number resolves. It does NOT
 * prove the number belongs to the WABA this system is configured with — a stale
 * `whatsapp_waba_id` after a migration between business accounts passes call one and
 * breaks template sync, which reads templates from the WABA. So call two lists the
 * WABA's numbers and checks ours is among them, and reports that mismatch as its own
 * kind rather than as a generic failure.
 */
export async function checkWhatsAppHealth(creds: {
  phoneNumberId: string;
  wabaId: string | null;
  accessToken: string;
}): Promise<WhatsAppHealth> {
  const base = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

  const number = await graphGet<{
    id?: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    status?: string;
    name_status?: string;
    throughput?: { level?: string };
  }>(
    `${base}/${encodeURIComponent(creds.phoneNumberId)}?fields=${HEALTH_FIELDS.join(',')}`,
    creds.accessToken,
  );

  if (!number.ok) {
    const kind = classify(number.code, 'number');
    return { ok: false, kind, message: MESSAGES[kind] };
  }

  // No WABA configured: the number answered, which is most of the value. Report
  // success rather than inventing a failure for a field the admin never filled.
  if (creds.wabaId) {
    const list = await graphGet<{ data?: Array<{ id?: string }> }>(
      `${base}/${encodeURIComponent(creds.wabaId)}/phone_numbers?fields=id&limit=50`,
      creds.accessToken,
    );
    if (!list.ok) {
      const kind = classify(list.code, 'waba');
      return { ok: false, kind, message: MESSAGES[kind] };
    }
    const belongs = (list.body.data ?? []).some((n) => n.id === creds.phoneNumberId);
    if (!belongs) {
      return { ok: false, kind: 'number_not_in_waba', message: MESSAGES.number_not_in_waba };
    }
  }

  return {
    ok: true,
    phoneNumberId: creds.phoneNumberId,
    displayPhoneNumber: number.body.display_phone_number ?? null,
    verifiedName: number.body.verified_name ?? null,
    qualityRating: number.body.quality_rating ?? null,
    status: number.body.status ?? null,
    nameStatus: number.body.name_status ?? null,
    throughputLevel: number.body.throughput?.level ?? null,
  };
}
