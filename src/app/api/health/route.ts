import { NextResponse } from 'next/server';

// GET /api/health — liveness probe (relocation plan Phase 0 #8).
//
// Deliberately unauthenticated and data-free: the relocation wizard's
// verification suite, the nginx template's health checks, and any future load
// balancer need exactly "is the app process serving requests" — nothing else.
// No version, no env, no dependencies checked: a body beyond { ok: true }
// would turn a liveness probe into an information-disclosure surface.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
