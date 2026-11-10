import type { NextResponse } from 'next/server';

import { noStoreJson } from '@/lib/http/no-store-json';

// Reads a request body as size-capped JSON for the agent-console and widget JSON routes. It only reads and parses:
// authentication, rate limiting and schema validation stay in the route, in the route's own order.
//
// The answers are the two every one of those routes already gave: 413 'בקשה גדולה מדי' over the cap, 400
// 'גוף הבקשה אינו תקין' for a body that is not JSON.

export interface ReadJsonBodyOptions {
  /** The cap, in the unit named by `measure`. */
  maxSize: number;
  /**
   * How the body is measured against the cap. 'utf8-bytes' is the size on the wire (Buffer.byteLength);
   * 'string-length' is the JavaScript string length, which is smaller for non-ASCII text. Routes differ here, so
   * each one names its own.
   */
  measure: 'utf8-bytes' | 'string-length';
  /** Refuse on a declared Content-Length over the cap before reading the body. */
  checkDeclaredLength?: boolean;
  /** Treat an empty body as `{}` (routes that take no parameters). Otherwise an empty body is invalid JSON. */
  emptyAsObject?: boolean;
}

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

const TOO_LARGE = 'בקשה גדולה מדי';
const INVALID_BODY = 'גוף הבקשה אינו תקין';

export async function readJsonBody(
  request: Request,
  options: ReadJsonBodyOptions,
): Promise<ReadJsonBodyResult> {
  if (options.checkDeclaredLength) {
    const declaredLen = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLen) && declaredLen > options.maxSize) {
      return { ok: false, response: noStoreJson({ error: TOO_LARGE }, 413) };
    }
  }

  const raw = await request.text();
  const size = options.measure === 'utf8-bytes' ? Buffer.byteLength(raw) : raw.length;
  if (size > options.maxSize) return { ok: false, response: noStoreJson({ error: TOO_LARGE }, 413) };

  if (options.emptyAsObject && raw.length === 0) return { ok: true, value: {} };

  try {
    const value: unknown = JSON.parse(raw);
    return { ok: true, value };
  } catch {
    return { ok: false, response: noStoreJson({ error: INVALID_BODY }, 400) };
  }
}
