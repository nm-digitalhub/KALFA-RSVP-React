import 'server-only';

import { sumitStatus } from './status';

// The ONE place every generated SUMIT operation goes through (Orval's `mutator`, see orval.config.ts).
//
// What it adds, so that no caller and no generated function has to:
//   - the credentials, in the body, as SUMIT wants them (the transformer removed them from the request types);
//   - a timeout, combined with any abort signal the caller passed;
//   - a typed SumitError for every way a call can go wrong, carrying `outcomeUnknown`: false only when SUMIT itself
//     refused the request (nothing happened), true for everything else (money MAY have moved: a timeout, a 5xx, a body
//     that could not be read). Callers that charge must treat `true` as "review", never as "retry".
//
// What it never does: log, retry, or keep the original error. A fetch error can echo the request and the request is
// where the API key is, so the original is dropped on purpose and the message is fixed text.
//
// Two mutators because the answers differ in kind: `sumitFetch` for the JSON operations, `sumitFetchPdf` for getpdf.
// The generated code picks the right one per operation (`override.operations` in orval.config.ts).

export type SumitCallOptions = {
  creds: { companyId: number; apiKey: string };
  /** Defaults to 30s. Operations that move money pass 60s explicitly. */
  timeoutMs?: number;
};

export type SumitFailureKind =
  | 'invalid_request'
  | 'rejected'
  | 'provider_error'
  | 'unknown_status'
  | 'http_error'
  | 'bad_body'
  | 'unreachable';

export class SumitError extends Error {
  constructor(
    readonly kind: SumitFailureKind,
    message: string,
    /** true = the request may have been processed: review, never retry. */
    readonly outcomeUnknown: boolean,
    readonly httpStatus?: number,
    /** SUMIT's own UserErrorMessage, cleaned and capped. For an admin screen or a log, never for an end customer. */
    readonly providerMessage?: string,
  ) {
    super(message);
    this.name = 'SumitError';
  }
}

// What the generated code hands over: the request it built, plus the options the caller passed as the last argument.
type Init = RequestInit & { sumit?: SumitCallOptions };
type Envelope = { Status?: unknown; UserErrorMessage?: unknown };

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_MESSAGE = 300;

const cleanProviderMessage = (message: unknown): string | undefined =>
  typeof message === 'string' ? message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_PROVIDER_MESSAGE) || undefined : undefined;

const isJson = (res: Response) => /\bjson\b/i.test(res.headers.get('content-type') ?? '');

// Builds the request BEFORE anything leaves the process, so a bad request is never reported as "unreachable".
async function send(url: string, init: Init): Promise<Response> {
  const creds = init.sumit?.creds;
  if (!creds || !Number.isInteger(creds.companyId) || creds.companyId <= 0 || !creds.apiKey || typeof init.body !== 'string') {
    throw new SumitError('invalid_request', 'בקשה ל-SUMIT אינה תקינה', false);
  }
  let body: string;
  try {
    body = JSON.stringify({ ...JSON.parse(init.body), Credentials: { CompanyID: creds.companyId, APIKey: creds.apiKey } });
  } catch {
    throw new SumitError('invalid_request', 'בקשה ל-SUMIT אינה תקינה', false);
  }

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const signal = AbortSignal.any([AbortSignal.timeout(init.sumit?.timeoutMs ?? DEFAULT_TIMEOUT_MS), ...(init.signal ? [init.signal] : [])]);

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', cache: 'no-store', headers, signal, body });
  } catch {
    throw new SumitError('unreachable', 'לא ניתן להגיע ל-SUMIT', true);
  }
  if (!res.ok) throw new SumitError('http_error', 'SUMIT החזירה שגיאה', true, res.status);
  return res;
}

async function readEnvelope(res: Response): Promise<Envelope> {
  let envelope: unknown;
  try {
    envelope = await res.json();
  } catch {
    throw new SumitError('bad_body', 'תשובה לא קריאה מ-SUMIT', true);
  }
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new SumitError('bad_body', 'תשובה לא תקינה מ-SUMIT', true);
  }
  return envelope as Envelope;
}

// SUMIT reports its own refusals INSIDE a 200 (Status 1), so the HTTP status alone says nothing.
function assertSuccess(envelope: Envelope): void {
  switch (sumitStatus(envelope.Status)) {
    case 'success':
      return;
    case 'business_error':
      throw new SumitError('rejected', 'SUMIT דחתה את הבקשה', false, undefined, cleanProviderMessage(envelope.UserErrorMessage));
    case 'technical_error':
      throw new SumitError('provider_error', 'תקלה אצל SUMIT', true);
    default:
      throw new SumitError('unknown_status', 'תשובה לא מוכרת מ-SUMIT', true);
  }
}

/** Every JSON operation: resolves with SUMIT's envelope ({ Status, UserErrorMessage, Data }) when it succeeded. */
export const sumitFetch = async <T>(url: string, init: Init): Promise<T> => {
  const res = await send(url, init);
  if (!isJson(res)) throw new SumitError('bad_body', 'סוג תשובה לא צפוי מ-SUMIT', true);
  const envelope = await readEnvelope(res);
  assertSuccess(envelope);
  return envelope as T;
};

/** getpdf only: resolves with the file. A JSON answer is never a success, even when SUMIT says Status 0. */
export const sumitFetchPdf = async <T extends Blob = Blob>(url: string, init: Init): Promise<T> => {
  const res = await send(url, init);
  if (isJson(res)) {
    // A missing document is a 200 + JSON (Status 1, "Document not found"), measured live on 6.10.2026.
    assertSuccess(await readEnvelope(res));
    throw new SumitError('bad_body', 'לא התקבל קובץ', true);
  }
  let pdf: Blob;
  try {
    pdf = await res.blob();
    if ((await pdf.slice(0, 5).text()) !== '%PDF-') throw new Error('not a pdf');
  } catch {
    throw new SumitError('bad_body', 'הקובץ שהתקבל אינו PDF תקין', true);
  }
  return pdf as T;
};
