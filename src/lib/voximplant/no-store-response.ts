import { NextResponse } from 'next/server';

import { NO_STORE_HEADERS, noStoreJson } from '@/lib/http/no-store-json';

// Response builders for the Voximplant-facing endpoints (/api/voximplant/**).
// Their URLs or bodies carry bearer material (a per-call token in the path, the
// scenario secret in the body), so EVERY response is explicitly no-store: the
// config-layer block on /api/voximplant/:path* is defense-in-depth, this is the
// primary control (`force-dynamic` only skips Next's own cache, not downstream
// caches). The header itself has one definition, in lib/http/no-store-json.ts.

/** A bodiless response — the refusal shape of the token-gated routes, so no detail leaks. */
export const emptyNoStore = (status: number) =>
  new NextResponse(null, { status, headers: NO_STORE_HEADERS });

/** The stable, minimal ack a scenario's own lifecycle report gets. */
export const okNoStore = () => new NextResponse('ok', { status: 200, headers: NO_STORE_HEADERS });

/** `noStoreJson` with the 200 these routes answer almost everywhere as the default. */
export const jsonNoStore = (body: unknown, status = 200) => noStoreJson(body, status);
