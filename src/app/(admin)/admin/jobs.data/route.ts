import type { NextRequest } from 'next/server';

import { BASE_PATH, proxyToDashboard } from '@/lib/pgboss/dashboard-proxy';

// The pg-boss dashboard's INDEX route data request.
//
// React Router asks for a route's data at `<route path>.data`. For the index
// route, whose path IS the base path, that is `/admin/jobs.data` — a sibling of
// the `/admin/jobs` segment, so `admin/jobs/[[...path]]` cannot match it and
// Next answered with its own 404 page. React Router then rendered its 404
// boundary inside the layout, which is why Overview showed a full sidebar with
// "404 The requested page could not be found" while every other tab worked.
//
// A literal directory segment containing a dot is the documented way to serve
// such a path from the App Router (same shape as `app/robots.txt/route.ts`).
//
// GET/HEAD only: this URL is a data read. The catch-all next door keeps the
// full method set for the dashboard's own mutations, which all live under
// /admin/jobs/**.

export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest): Promise<Response> {
  return proxyToDashboard(request, `${BASE_PATH}.data`);
}

export { proxy as GET, proxy as HEAD };
