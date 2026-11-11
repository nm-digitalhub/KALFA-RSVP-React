import { connection, NextResponse } from 'next/server';

// GET /api/health — liveness probe (relocation plan Phase 0 #8).
//
// Deliberately unauthenticated and data-free: the relocation wizard's
// verification suite and any future load balancer need exactly "is the app
// process serving requests" — nothing else.
// No version, no env, no dependencies checked: a body beyond { ok: true }
// would turn a liveness probe into an information-disclosure surface.

// A liveness probe has to be answered by the running process, so it must never be prerendered: a GET handler that
// reads no request data is prerendered at build time under Cache Components (measured 10.11.2026: the route
// showed as static). connection() makes it request-time.
export async function GET() {
  await connection();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
