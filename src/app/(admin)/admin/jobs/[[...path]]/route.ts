import type { NextRequest } from 'next/server';

import { BASE_PATH, proxyToDashboard } from '@/lib/pgboss/dashboard-proxy';

// Authenticated reverse-proxy for the pg-boss ops dashboard: everything AT and
// UNDER /admin/jobs. The index route's data request (/admin/jobs.data) is a
// sibling of this segment, not a child, so it has its own route file next to
// this one — see src/lib/pgboss/dashboard-proxy.ts for why.
//
// The (admin) layout does NOT wrap route handlers, so the admin check lives in
// the shared proxy. The dashboard is pure HTTP (SSR + polling, no WebSocket or
// SSE), so a streaming Response proxy is sufficient.

export const dynamic = 'force-dynamic';

async function proxy(
  request: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join('/')}` : '';
  return proxyToDashboard(request, `${BASE_PATH}${suffix}`);
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
