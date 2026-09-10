import 'server-only';

import { sumitStatus } from './status';

// Passive health check for the SUMIT (OfficeGuy) connection.
//
// The integrations card said "אין בדיקת בריאות זמינה — בדיקה ידנית ב-/admin/sumit-test",
// which was the third time this branch found that sentence meaning "nobody looked".
// SUMIT's own OpenAPI document (openapi/sumit.openapi.json) lists 84 operations; `website/companies/getdetails/`
// takes NOTHING but the credentials and returns the company they belong to.
//
// ⚠️ WHY THIS ENDPOINT AND NOT ANOTHER. Read-only was not the only requirement:
//
//   • It must charge nothing and create nothing. Most of the 84 write — documents,
//     customers, charges, tokens.
//   • It must return no CUSTOMER data. `/billing/payments/list/` and
//     `/accounting/documents/list/` would both verify the credentials and both hand
//     back people's payment records to render a green tick.
//   • It must prove the credential PAIR. `getvatrate` also takes credentials only, but
//     answers with a single number that says little about whose account replied.
//
// GetDetails returns OUR OWN business registration — name, tax id, the address already
// printed on every invoice. Not customer data, and it is the one answer that shows the
// CompanyID and APIKey resolve to the company we think we are.
//
// Never returns or logs the API key.

const SUMIT_GET_DETAILS_URL = 'https://api.sumit.co.il/website/companies/getdetails/';

export interface SumitHealthOk {
  ok: true;
  /** Our own registered organisation name, as SUMIT holds it. */
  companyName: string | null;
  /** Tax id (ח.פ. / עוסק). Ours, printed on every document we issue. */
  corporateNumber: string | null;
  /** The address shown on generated documents. */
  documentsEmail: string | null;
}

export type SumitHealthFailure =
  /** The credential pair was rejected — wrong CompanyID, wrong key, or revoked. */
  | 'credentials_rejected'
  /** SUMIT reported a technical fault on its side. Says nothing about our config. */
  | 'provider_error'
  /** Answered, but not in a shape this code recognises. */
  | 'unexpected_response'
  /** Network, timeout, or a non-200. */
  | 'unreachable';

export interface SumitHealthError {
  ok: false;
  kind: SumitHealthFailure;
  /** Hebrew, safe to render. NEVER carries the API key or a raw provider body. */
  message: string;
}

export type SumitHealth = SumitHealthOk | SumitHealthError;

const MESSAGES: Record<SumitHealthFailure, string> = {
  credentials_rejected: 'SUMIT דחתה את מזהה החברה או את מפתח ה-API',
  provider_error: 'SUMIT דיווחה על תקלה אצלה — לא בהגדרות שלנו',
  unexpected_response: 'SUMIT החזירה תגובה בפורמט לא מוכר',
  unreachable: 'לא ניתן להגיע ל-SUMIT',
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export async function checkSumitHealth(creds: {
  companyId: string;
  apiKey: string;
}): Promise<SumitHealth> {
  // CompanyID is `int64` in the spec but a string in app_settings. Refuse a
  // non-numeric value here rather than letting SUMIT reject it as bad credentials —
  // "you typed letters into the company id" and "your key was revoked" send someone
  // to two very different places.
  const companyId = Number(creds.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return {
      ok: false,
      kind: 'credentials_rejected',
      message: 'מזהה החברה ב-SUMIT אינו מספר תקין',
    };
  }

  let res: Response;
  try {
    res = await fetch(SUMIT_GET_DETAILS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Credentials: { CompanyID: companyId, APIKey: creds.apiKey } }),
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
  } catch {
    // Never surface the thrown message: a fetch failure can echo the request, and the
    // request body is where the key is.
    return { ok: false, kind: 'unreachable', message: MESSAGES.unreachable };
  }

  if (!res.ok) {
    return { ok: false, kind: 'unreachable', message: MESSAGES.unreachable };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, kind: 'unexpected_response', message: MESSAGES.unexpected_response };
  }

  const row = (body ?? {}) as {
    Status?: unknown;
    Data?: { Company?: Record<string, unknown> | null } | null;
  };

  // HTTP 200 is not the answer here — SUMIT reports business failures inside the body,
  // the same trap ExtrA sets. See status.ts for why Status has three possible shapes.
  const status = sumitStatus(row.Status);
  if (status === 'business_error') {
    return { ok: false, kind: 'credentials_rejected', message: MESSAGES.credentials_rejected };
  }
  if (status === 'technical_error') {
    return { ok: false, kind: 'provider_error', message: MESSAGES.provider_error };
  }
  if (status !== 'success') {
    return { ok: false, kind: 'unexpected_response', message: MESSAGES.unexpected_response };
  }

  const company = row.Data?.Company;
  if (!company) {
    // Success with no company is not something the spec describes. Reporting it as
    // healthy would render a green tick for an answer nobody can explain.
    return { ok: false, kind: 'unexpected_response', message: MESSAGES.unexpected_response };
  }

  return {
    ok: true,
    companyName: str(company.Name),
    corporateNumber: str(company.CorporateNumber),
    documentsEmail: str(company.DocumentsEmailAddress) ?? str(company.EmailAddress),
  };
}
