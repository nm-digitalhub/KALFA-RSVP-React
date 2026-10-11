import 'server-only';

import type { DncErrorResponse } from './generated/models';

// The ONE place every generated DNC ("אל תתקשר אליי") operation goes through (Orval's `mutator`, see orval.config.ts).
//
// What it adds, so that no caller and no generated function has to:
//   - the two authentication headers, `name` and `token`, read from the server environment (DNC_API_NAME,
//     DNC_API_TOKEN) at call time — they never come from a caller and never reach the browser;
//   - a timeout (30 seconds unless the caller asks for another: one request may carry up to 100K numbers), combined with
//     any abort signal the caller passed;
//   - a typed DncError for every way a call can go wrong, with the service's own `statusCode`, `message` and
//     `transactionId` when it answered with them (measured 11.10.2026: 400, 401 and 500 all answer with that JSON body;
//     the transactionId is what the authority's support asks for).
//
// What it never does: log, retry, or keep the original fetch error — a fetch error can echo the request headers, and the
// token is in them. The check is read-only, so a retry is the caller's choice.

export type DncCallOptions = {
  /** Defaults to 30 seconds. */
  timeoutMs?: number;
};

export type DncFailureKind = 'not_configured' | 'invalid_request' | 'http_error' | 'bad_body' | 'unreachable';

export class DncError extends Error {
  constructor(
    readonly kind: DncFailureKind,
    message: string,
    readonly httpStatus?: number,
    /** The service's own answer to a failed call (statusCode, message, transactionId), when it sent one. */
    readonly answer?: DncErrorResponse,
  ) {
    super(message);
    this.name = 'DncError';
  }
}

type Init = RequestInit & { dnc?: DncCallOptions };

const DEFAULT_TIMEOUT_MS = 30_000;

const isJson = (res: Response) => /\bjson\b/i.test(res.headers.get('content-type') ?? '');

async function errorAnswer(res: Response): Promise<DncErrorResponse | undefined> {
  if (!isJson(res)) return undefined;
  try {
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const { statusCode, message, transactionId } = parsed as Partial<DncErrorResponse>;
    if (typeof statusCode !== 'number' || typeof transactionId !== 'string') return undefined;
    return { statusCode, message: typeof message === 'string' ? message : '', transactionId };
  } catch {
    return undefined;
  }
}

/** Every DNC operation: resolves with the service's parsed answer. */
export const dncFetch = async <T>(url: string, init: Init): Promise<T> => {
  const name = process.env.DNC_API_NAME;
  const token = process.env.DNC_API_TOKEN;
  if (!name || !token) throw new DncError('not_configured', 'שירות "אל תתקשר אליי" אינו מוגדר');
  if (typeof init.body !== 'string') throw new DncError('invalid_request', 'בקשה לשירות "אל תתקשר אליי" אינה תקינה');

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('name', name);
  headers.set('token', token);
  const signal = AbortSignal.any([
    AbortSignal.timeout(init.dnc?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(init.signal ? [init.signal] : []),
  ]);

  let res: Response;
  try {
    res = await fetch(url, { method: init.method ?? 'POST', cache: 'no-store', headers, signal, body: init.body });
  } catch {
    throw new DncError('unreachable', 'לא ניתן להגיע לשירות "אל תתקשר אליי"');
  }
  if (!res.ok) {
    throw new DncError('http_error', 'שירות "אל תתקשר אליי" החזיר שגיאה', res.status, await errorAnswer(res));
  }
  if (!isJson(res)) throw new DncError('bad_body', 'סוג תשובה לא צפוי משירות "אל תתקשר אליי"', res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new DncError('bad_body', 'תשובה לא קריאה משירות "אל תתקשר אליי"', res.status);
  }
};
