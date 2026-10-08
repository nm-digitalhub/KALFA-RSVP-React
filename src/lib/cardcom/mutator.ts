import 'server-only';

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
  ) {
    super(message);
    this.name = 'CardcomError';
  }
}

// What the generated code hands over: the request it built, plus the options the caller passed as the last argument.
type Init = RequestInit & { cardcom?: CardcomCallOptions };

const DEFAULT_TIMEOUT_MS = 5_000;

const isJson = (res: Response) => /\bjson\b/i.test(res.headers.get('content-type') ?? '');

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
  // 4xx: CardCom refused the request itself (wrong credentials, malformed body). 5xx: it may have been processed.
  if (!res.ok) throw new CardcomError('http_error', 'CardCom החזירה שגיאה', res.status >= 500, res.status);
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
