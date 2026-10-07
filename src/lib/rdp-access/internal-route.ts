import { NextResponse } from 'next/server';

// What the app's loopback-only routes for the remote-desktop feature have in common: the no-store JSON answer, the
// "this did not come straight from a local process" test, the Bearer reader and the deadline wrapper. Shared by
// tunnel-check (called by the gateway) and xrdp-ticket (called by the desktop's login helper) so a fix lands in both.

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

// Headers only a reverse proxy adds (Next.js never sets either). Their presence means the request did not come
// straight from a local process. Do not add x-forwarded-*: Next sets those on every request.
const PROXY_HEADERS = ['x-real-ip', 'forwarded'] as const;

export function cameThroughProxy(request: Request): boolean {
  return PROXY_HEADERS.some((name) => request.headers.has(name));
}

/** The answer a proxied request gets: the route does not exist. */
export function notFoundResponse(): NextResponse {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

export function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null;
  return token;
}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('failed'));
      },
    );
  });
}
