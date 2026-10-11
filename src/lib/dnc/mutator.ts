import 'server-only';

import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import type { DncErrorResponse } from './generated/models';

// The ONE place every generated DNC ("אל תתקשר אליי") operation goes through (Orval's `mutator`, see orval.config.ts).
// There are two mutators because the authority runs the two services on different hosts with different wire formats:
//   - dncFetch       → Phone-List-Verification on pverification.fta.gov.il: plain JSON, up to 100K numbers;
//   - dncQueryFetch  → Phone-Query on dnc-api.fta.gov.il: the same JSON sorted and gzip-compressed, up to 1M numbers.
// Orval reads only the spec's document-level `servers`, so the generated functions pass a path and the mutator owns the
// host.
//
// What both add, so that no caller and no generated function has to:
//   - the two authentication headers, `name` and `token`, read from the server environment (DNC_API_NAME,
//     DNC_API_TOKEN) at call time — they never come from a caller and never reach the browser;
//   - a timeout (30 seconds unless the caller asks for another), combined with any abort signal the caller passed;
//   - a typed DncError for every way a call can go wrong, with the service's own `statusCode`, `message` and
//     `transactionId` when it answered with them (measured 11.10.2026: 400 and 401 answer with that JSON body, and so does
//     Phone-List-Verification's 500; Phone-Query's 500 has an empty body, and its 400 has a null transactionId).
//
// What they never do: log, retry, or keep the original fetch error — a fetch error can echo the request headers, and the
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

const LIST_VERIFICATION_HOST = 'https://pverification.fta.gov.il';
const PHONE_QUERY_HOST = 'https://dnc-api.fta.gov.il';
const DEFAULT_TIMEOUT_MS = 30_000;

const gzipAsync = promisify(gzip);

const isJson = (res: Response) => /\bjson\b/i.test(res.headers.get('content-type') ?? '');

async function errorAnswer(res: Response): Promise<DncErrorResponse | undefined> {
  if (!isJson(res)) return undefined;
  try {
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const { statusCode, message, transactionId } = parsed as Partial<DncErrorResponse>;
    if (typeof statusCode !== 'number') return undefined;
    return {
      statusCode,
      message: typeof message === 'string' ? message : '',
      transactionId: typeof transactionId === 'string' ? transactionId : null,
    };
  } catch {
    return undefined;
  }
}

async function call<T>(url: string, init: Init, body: BodyInit, extraHeaders: Record<string, string>): Promise<T> {
  const name = process.env.DNC_API_NAME;
  const token = process.env.DNC_API_TOKEN;
  if (!name || !token) throw new DncError('not_configured', 'שירות "אל תתקשר אליי" אינו מוגדר');

  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  headers.set('name', name);
  headers.set('token', token);
  const signal = AbortSignal.any([
    AbortSignal.timeout(init.dnc?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(init.signal ? [init.signal] : []),
  ]);

  let res: Response;
  try {
    res = await fetch(url, { method: init.method ?? 'POST', cache: 'no-store', headers, signal, body });
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
}

const invalidRequest = () => new DncError('invalid_request', 'בקשה לשירות "אל תתקשר אליי" אינה תקינה');

/** Phone-List-Verification: resolves with the service's parsed answer. */
export const dncFetch = async <T>(path: string, init: Init): Promise<T> => {
  if (typeof init.body !== 'string') throw invalidRequest();
  return call<T>(LIST_VERIFICATION_HOST + path, init, init.body, {});
};

/**
 * Phone-Query: sorts the numbers (document section 3.2.1), gzips the JSON and sends it WITHOUT a Content-Encoding header —
 * measured 11.10.2026, announcing the gzip makes the service fail (500/415, empty body), and so does an uncompressed body.
 */
export const dncQueryFetch = async <T>(path: string, init: Init): Promise<T> => {
  if (typeof init.body !== 'string') throw invalidRequest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    throw invalidRequest();
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || !data.every((phone): phone is string => typeof phone === 'string')) throw invalidRequest();
  const compressed = await gzipAsync(JSON.stringify({ data: [...data].sort() }));
  return call<T>(PHONE_QUERY_HOST + path, init, new Uint8Array(compressed), { 'Accept-Encoding': 'gzip, deflate' });
};
