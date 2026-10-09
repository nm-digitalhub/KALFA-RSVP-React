import 'server-only';

import type { ErrorInfo } from './generated/models';

// The ONE place every generated CardCom operation goes through (Orval's `mutator`, see orval.config.ts).
//
// What it adds, so that no caller and no generated function has to:
//   - a timeout (5 seconds unless the caller asks for more), combined with any abort signal the caller passed;
//   - a typed CardcomError for every way a CALL can go wrong, carrying `outcomeUnknown`: false only when nothing could
//     have been processed (the request was malformed, or CardCom refused it with a 4xx), true for everything else (a
//     timeout, a dropped connection, a 5xx, a body that could not be read). A caller that moves money must treat `true`
//     as "ask CardCom what happened" and never as "try again".
//
// What it deliberately does NOT do: look at `ResponseCode`. CardCom answers a declined payment, a rejected request and
// a success all with HTTP 200 and a body; reading that code is the caller's job, because for GetLpResult a non-zero
// code is an ordinary answer ("this payment failed"), not a fault of the call.
//
// What it never does: log, retry, or keep the original error. A fetch error can echo the request, and the request is
// where the API password is, so the original is dropped on purpose and the message is fixed text.
//
// What it DOES keep of a failed call: the HTTP status, and — when CardCom answered with a JSON body — the two fields its
// OpenAPI documents for an error (ErrorInfo: `ResponseCode`, `Description`; every operation declares it for 400 "see
// 'Description' in response" and 401 "Invalid username"). Without them a refusal could only ever be reported as "CardCom
// refused", with the reason thrown away (9.10.2026: two CancelDoc refusals, reason unknown). The body is read only when it
// is JSON, the same way a successful answer is read; nothing else in it is kept, the Description is cut to the 250
// characters the OpenAPI allows it, and the API password is blanked out of it should CardCom ever echo it. Reading it never
// changes what the error IS: a body that cannot be read leaves `answer` undefined and the kind and outcome as they were.

export type CardcomCallOptions = {
  /** Defaults to 5 seconds (the documented limit for GetLpResult). */
  timeoutMs?: number;
};

export type CardcomFailureKind = 'invalid_request' | 'http_error' | 'bad_body' | 'unreachable';

export class CardcomError extends Error {
  constructor(
    readonly kind: CardcomFailureKind,
    message: string,
    /** true = the request may have been processed: ask CardCom, never retry. */
    readonly outcomeUnknown: boolean,
    readonly httpStatus?: number,
    /** CardCom's own reason (its ErrorInfo body), when it answered with one: for the ledger, logs (code only) and staff. */
    readonly answer?: ErrorInfo,
  ) {
    super(message);
    this.name = 'CardcomError';
  }
}

// What the generated code hands over: the request it built, plus the options the caller passed as the last argument.
type Init = RequestInit & { cardcom?: CardcomCallOptions };

const DEFAULT_TIMEOUT_MS = 5_000;

const isJson = (res: Response) => /\bjson\b/i.test(res.headers.get('content-type') ?? '');

const DESCRIPTION_LIMIT = 250;

// The ErrorInfo of a failed call, or undefined when the body is not JSON, cannot be read, or carries neither field.
async function errorAnswer(res: Response, requestBody: string): Promise<ErrorInfo | undefined> {
  if (!isJson(res)) return undefined;
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const { ResponseCode, Description } = parsed as ErrorInfo;
  const code = typeof ResponseCode === 'number' && Number.isInteger(ResponseCode) ? ResponseCode : undefined;
  let text = typeof Description === 'string' && Description.trim() !== '' ? Description.trim() : undefined;
  // The request's ApiPassword must never travel onward, should CardCom echo it.
  if (text !== undefined) {
    let password: unknown;
    try {
      password = (JSON.parse(requestBody) as { ApiPassword?: unknown }).ApiPassword;
    } catch {
      password = undefined;
    }
    if (typeof password === 'string' && password !== '') text = text.split(password).join('[hidden]');
  }
  if (text !== undefined) text = text.slice(0, DESCRIPTION_LIMIT);
  if (code === undefined && text === undefined) return undefined;
  return { ResponseCode: code, Description: text ?? null };
}

/** What a failed call can tell a ledger row, a log line (the numbers only) and a staff alert; nulls when it carries none. */
export type CardcomFailureFacts = { httpStatus: number | null; responseCode: number | null; description: string | null };
export function cardcomFailureFacts(err: unknown): CardcomFailureFacts {
  if (!(err instanceof CardcomError)) return { httpStatus: null, responseCode: null, description: null };
  return {
    httpStatus: err.httpStatus ?? null,
    responseCode: err.answer?.ResponseCode ?? null,
    description: err.answer?.Description ?? null,
  };
}

/** Every JSON operation: resolves with CardCom's parsed answer. The caller reads `ResponseCode`. */
export const cardcomFetch = async <T>(url: string, init: Init): Promise<T> => {
  if (typeof init.body !== 'string') throw new CardcomError('invalid_request', 'בקשה ל-CardCom אינה תקינה', false);

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const signal = AbortSignal.any([AbortSignal.timeout(init.cardcom?.timeoutMs ?? DEFAULT_TIMEOUT_MS), ...(init.signal ? [init.signal] : [])]);

  let res: Response;
  try {
    res = await fetch(url, { method: init.method ?? 'POST', cache: 'no-store', headers, signal, body: init.body });
  } catch {
    throw new CardcomError('unreachable', 'לא ניתן להגיע ל-CardCom', true);
  }
  // 4xx: CardCom refused the request itself (wrong credentials, malformed body). 5xx: it may have been processed. Either
  // way its ErrorInfo body, when there is one, says why.
  if (!res.ok) {
    const answer = await errorAnswer(res, init.body);
    throw new CardcomError('http_error', 'CardCom החזירה שגיאה', res.status >= 500, res.status, answer);
  }
  if (!isJson(res)) throw new CardcomError('bad_body', 'סוג תשובה לא צפוי מ-CardCom', true);

  let answer: unknown;
  try {
    answer = await res.json();
  } catch {
    throw new CardcomError('bad_body', 'תשובה לא קריאה מ-CardCom', true);
  }
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    throw new CardcomError('bad_body', 'תשובה לא תקינה מ-CardCom', true);
  }
  return answer as T;
};
