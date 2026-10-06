import 'server-only';

import { sumitStatus } from './status';

// A READ-ONLY question to SUMIT's payment list, for the admin who has to decide what happened to a payment operation
// that ended in `review` (the process died, or SUMIT's answer was not clear): did a payment of this amount, at about
// this time, for this customer, actually go through?
//
// What this is NOT. SUMIT cannot be searched by our reference (the list takes only a date range, a valid/invalid
// switch and a paging index), so a match here is a SUGGESTION — a person confirms it against SUMIT's own screen and
// types the document number, which the list does not return. And "could not ask" is never reported as "no payment":
// an unreachable SUMIT must not tell an admin it is safe to mark a possibly-charged operation as failed.

const SUMIT_PAYMENTS_LIST_URL = 'https://api.sumit.co.il/billing/payments/list/';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15_000;
// Money is compared to the agora; SUMIT returns a double.
const AMOUNT_TOLERANCE = 0.005;

export type ProbeUnavailableReason =
  | 'credentials'
  | 'provider_error'
  | 'unexpected_response'
  | 'unreachable'
  | 'too_many_pages';

export interface ProbeMatch {
  paymentId: number | null;
  date: string | null;
  amount: number;
  authNumber: string | null;
  customerId: number | null;
}

export type ProbeResult =
  | { kind: 'found'; matches: ProbeMatch[] }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: ProbeUnavailableReason };

export interface ProbeParams {
  // CompanyID is int64 in the spec but a string in app_settings.
  companyId: number | string;
  apiKey: string;
  // When the operation began (payment_operations.recorded_at). The window is a day either side.
  recordedAt: string;
  amount: number;
  // The SUMIT customer number we expect the payment to be under, when we know it.
  customerId?: number | null;
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
};

export async function probeSumitCharge(p: ProbeParams): Promise<ProbeResult> {
  const companyId = Number(p.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) return { kind: 'unavailable', reason: 'credentials' };

  const center = Date.parse(p.recordedAt);
  if (!Number.isFinite(center)) return { kind: 'unavailable', reason: 'unexpected_response' };
  const dateFrom = new Date(center - WINDOW_MS).toISOString();
  const dateTo = new Date(center + WINDOW_MS).toISOString();

  const matches: ProbeMatch[] = [];
  let startIndex = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let res: Response;
    try {
      res = await fetch(SUMIT_PAYMENTS_LIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Credentials: { CompanyID: companyId, APIKey: p.apiKey },
          Date_From: dateFrom,
          Date_To: dateTo,
          Valid: true,
          StartIndex: startIndex,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch {
      // The thrown message can echo the request, and the request body is where the key is.
      return { kind: 'unavailable', reason: 'unreachable' };
    }
    if (!res.ok) return { kind: 'unavailable', reason: 'unreachable' };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: 'unavailable', reason: 'unexpected_response' };
    }
    const envelope = asObj(body);
    const status = sumitStatus(envelope?.Status);
    if (status === 'business_error') return { kind: 'unavailable', reason: 'credentials' };
    if (status === 'technical_error') return { kind: 'unavailable', reason: 'provider_error' };
    if (status !== 'success') return { kind: 'unavailable', reason: 'unexpected_response' };

    const data = asObj(envelope?.Data);
    const payments = Array.isArray(data?.Payments) ? data.Payments : [];
    for (const raw of payments) {
      const pay = asObj(raw);
      if (!pay || pay.ValidPayment === false) continue;
      const amount = num(pay.Amount);
      if (amount === null || Math.abs(amount - p.amount) > AMOUNT_TOLERANCE) continue;
      const customerId = num(pay.CustomerID);
      if (p.customerId != null && customerId !== p.customerId) continue;
      matches.push({
        paymentId: num(pay.ID),
        date: text(pay.Date),
        amount,
        // AuthNumber sometimes arrives with a leading space.
        authNumber: text(pay.AuthNumber),
        customerId,
      });
    }

    // A page that says "more" but returned nothing would otherwise loop forever.
    if (data?.HasNextPage !== true || payments.length === 0) {
      return matches.length > 0 ? { kind: 'found', matches } : { kind: 'not_found' };
    }
    startIndex += payments.length;
  }

  // Ran out of pages while SUMIT still had more: whatever was seen is incomplete, so no verdict either way.
  return { kind: 'unavailable', reason: 'too_many_pages' };
}
