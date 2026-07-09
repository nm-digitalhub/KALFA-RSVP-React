import 'server-only';

import type { NextRequest } from 'next/server';

// Shared CSRF origin check for the payment/messaging Route Handlers
// (campaigns/authorize, campaigns/close-charge,
// campaigns/whatsapp-send, admin/sumit-test). Extracted verbatim from those
// five routes, which were verified identical (docs/audit-fix-sweep-2026-07-02-pending-approval.md #2).
//
// APP_ORIGIN is a server-only env var — never NEXT_PUBLIC_.
// localhost:3002 is added ONLY in development — never in production.
export function isAllowedOrigin(request: NextRequest): boolean {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error('APP_ORIGIN env var is not configured');
  const allowed = new Set([appOrigin]);
  if (process.env.NODE_ENV === 'development') allowed.add('http://localhost:3002');

  const origin = request.headers.get('origin');
  if (origin) return allowed.has(origin);

  // Fallback: extract origin from Referer (browser sends this even without Origin).
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch { return false; }
  }

  // Both absent — deny. OWASP recommends fail-closed.
  return false;
}
