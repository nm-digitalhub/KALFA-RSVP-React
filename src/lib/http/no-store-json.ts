import { NextResponse } from 'next/server';

// The JSON answer of every API route whose response must never be cached: agent-console (Bearer) routes, live-call
// commands, one-time-key signing. One definition so a route cannot forget the header.

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export function noStoreJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}
